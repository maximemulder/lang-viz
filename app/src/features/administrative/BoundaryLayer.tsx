import type { FeatureCollection } from 'geojson'
import { useAtomValue, useSetAtom, useStore } from 'jotai'
import { useEffect, useMemo, useState } from 'react'
import { Layer, Popup, Source, useMap } from 'react-map-gl/maplibre'
import { mapCameraIntentAtom } from '../../state/mapCameraIntent.ts'
import {
  INSPECTION_LINE_COLOR,
  INSPECTION_LINE_OPACITY,
  INSPECTION_LINE_WIDTH,
} from '../map/geometry/boundaryInspection.ts'
import { AREA_POINT_LAYER, AREA_POLYGON_LAYER } from './boundaryLayers.ts'
import {
  type BoundaryIndex,
  loadBoundaryGeometry,
  loadBoundaryIndex,
} from './boundaryRepository.ts'
import { selectTerritoryMetric } from './selectors.ts'
import {
  administrativeCameraRequestAtom,
  administrativeRepositoryAtom,
  administrativeSessionAtom,
  boundaryIndexAtom,
  boundaryPresentationAtom,
  hoveredAdministrativeAreaAtom,
} from './state.ts'

const label = (code: string) => {
  try {
    return new Intl.DisplayNames(undefined, { type: 'region' }).of(code) ?? code
  } catch {
    return code
  }
}

export default function BoundaryLayer({ administrative }: { readonly administrative: boolean }) {
  const presentation = useAtomValue(boundaryPresentationAtom)
  const session = useAtomValue(administrativeSessionAtom)
  const repository = useAtomValue(administrativeRepositoryAtom)
  const hovered = useAtomValue(hoveredAdministrativeAreaAtom)
  const request = useAtomValue(administrativeCameraRequestAtom)
  const intent = useAtomValue(mapCameraIntentAtom)
  const store = useStore()
  const publishIndex = useSetAtom(boundaryIndexAtom)
  const { current } = useMap()
  const [index, setIndex] = useState<BoundaryIndex | null>(null)
  const [geometry, setGeometry] = useState<FeatureCollection | null>(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const areaMode = presentation.hover === 'area'
  const showPoints = administrative || areaMode
  const showGeometry = presentation.borders || areaMode
  useEffect(() => {
    if (!showPoints && !presentation.borders) return
    if (retry) setError('')
    let active = true
    void loadBoundaryIndex()
      .then((result) => {
        if (active) {
          setIndex(result)
          publishIndex(result)
          setError('')
        }
      })
      .catch((failure: unknown) => {
        if (active)
          setError(failure instanceof Error ? failure.message : 'Boundary index unavailable.')
      })
    return () => {
      active = false
    }
  }, [showPoints, presentation.borders, retry, publishIndex])
  useEffect(() => {
    if (!showGeometry || !index) return
    if (retry) setError('')
    let active = true
    void loadBoundaryGeometry(index)
      .then((result) => {
        if (active) {
          setGeometry(result)
          setError('')
        }
      })
      .catch((failure: unknown) => {
        if (active)
          setError(failure instanceof Error ? failure.message : 'Boundary geometry unavailable.')
      })
    return () => {
      active = false
    }
  }, [showGeometry, index, retry])
  useEffect(() => {
    if (!request || intent !== request || !index) return
    const association = index.associations.get(request.territoryCode)
    const point = index.features.find((feature) =>
      association?.featureIds.includes(feature.featureId),
    )?.point
    const map = current?.getMap()
    if (!point || !map || store.get(mapCameraIntentAtom) !== request) return
    map.easeTo({
      center: [point[0], point[1]],
      zoom: Math.max(map.getZoom(), 3),
      duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 450,
    })
  }, [request, intent, index, current, store])

  const selectedCode = session.selection?.kind === 'territory' ? session.selection.id : null
  const hoveredCode = areaMode ? hovered?.code : null
  const selectedAssociation = selectedCode ? index?.associations.get(selectedCode) : null
  const values = useMemo(() => {
    const result: Record<string, number> = {}
    if (!repository || !session.metric || !index) return result
    for (const association of index.associations.values()) {
      if (association.status !== 'matched') continue
      const value = selectTerritoryMetric(repository, association.code, session.metric)
      if (value !== null) result[association.code] = value
    }
    return result
  }, [repository, session.metric, index])
  const maxValue = Math.max(...Object.values(values), 1)
  const metricLabel =
    session.metric?.kind === 'territory-population'
      ? 'Reported territory population'
      : session.metric?.kind === 'territory-literacy'
        ? 'Territory literacy'
        : session.metric?.kind === 'language-estimate'
          ? `${repository?.languageByCode.get(session.metric.sourceLanguageCode)?.name ?? session.metric.sourceLanguageCode} speaker estimate`
          : session.metric?.kind === 'family-estimate'
            ? `${repository?.familyById.get(session.metric.familyId)?.name ?? session.metric.familyId} estimate sum`
            : null
  const filledGeometry = useMemo<FeatureCollection | null>(() => {
    if (!geometry) return null
    return {
      ...geometry,
      features: geometry.features.map((feature) => {
        const code = feature.properties?.territoryCode
        const value = typeof code === 'string' ? values[code] : undefined
        return {
          ...feature,
          properties: {
            ...feature.properties,
            ...(value === undefined
              ? {}
              : { metricValue: value, metricFraction: Math.sqrt(value / maxValue) }),
          },
        }
      }),
    }
  }, [geometry, values, maxValue])

  return (
    <>
      {showGeometry && filledGeometry && (
        <Source
          id="administrative-boundaries"
          type="geojson"
          data={filledGeometry}
          attribution="Administrative boundary view: Natural Earth 4.1.0 / world-atlas 2.0.2 (source viewpoint)"
        >
          {presentation.borders && session.metric && (
            <Layer
              id="administrative-metric-fill"
              type="fill"
              filter={['has', 'metricValue']}
              paint={{
                'fill-color': [
                  'interpolate',
                  ['linear'],
                  ['get', 'metricFraction'],
                  0,
                  '#e5f0ec',
                  1,
                  '#126a70',
                ],
                'fill-opacity': 0.36,
              }}
            />
          )}
          {presentation.borders && selectedCode && (
            <Layer
              id="administrative-selected-area"
              type="fill"
              filter={['==', ['get', 'territoryCode'], selectedCode]}
              paint={{ 'fill-color': '#eca647', 'fill-opacity': 0.25 }}
            />
          )}
          {presentation.borders && (
            <Layer
              id="administrative-boundary-lines"
              type="line"
              paint={{
                'line-color': '#566b66',
                'line-width': 0.8,
                'line-opacity': 0.78,
              }}
            />
          )}
          {hoveredCode && (
            <Layer
              id="administrative-hover-outline"
              source="administrative-boundaries"
              type="line"
              filter={['==', ['get', 'territoryCode'], hoveredCode]}
              paint={{
                'line-color': INSPECTION_LINE_COLOR,
                'line-width': INSPECTION_LINE_WIDTH,
                'line-opacity': INSPECTION_LINE_OPACITY,
                'line-opacity-transition': { duration: 0 },
              }}
            />
          )}
          {areaMode && (
            <Layer
              id={AREA_POLYGON_LAYER}
              type="fill"
              filter={['has', 'territoryCode']}
              paint={{ 'fill-color': '#000000', 'fill-opacity': 0 }}
            />
          )}
        </Source>
      )}
      {showPoints && index && (
        <Source id="administrative-points" type="geojson" data={index.points}>
          <Layer
            id={AREA_POINT_LAYER}
            type="circle"
            paint={{
              'circle-radius': [
                'case',
                ['==', ['get', 'territoryCode'], selectedCode ?? ''],
                6,
                3.4,
              ],
              'circle-color': [
                'case',
                ['==', ['get', 'territoryCode'], selectedCode ?? ''],
                '#e99a35',
                '#196c70',
              ],
              'circle-stroke-color': '#fffdf6',
              'circle-stroke-width': 1.5,
              'circle-opacity': 0.9,
            }}
          />
        </Source>
      )}
      {areaMode && hovered && (
        <Popup
          longitude={hovered.longitude}
          latitude={hovered.latitude}
          closeButton={false}
          closeOnClick={false}
          anchor="bottom"
          offset={12}
        >
          <strong>{label(hovered.code)}</strong> <span>{hovered.code}</span>
        </Popup>
      )}
      {(presentation.borders || showPoints) && (
        <div className="administrative-map-legend" role="status">
          <strong>Administrative areas</strong>
          {presentation.borders ? (
            <>
              {!filledGeometry && !error && <span>Loading boundary geometry…</span>}
              <span>Natural Earth 4.1.0 / world-atlas 2.0.2 boundaries · source viewpoint</span>
              <span>
                Boundaries reflect this source's viewpoint. Some shapes have no matched CLDR area.
              </span>
              {metricLabel && (
                <span>
                  Teal fill: {metricLabel}, relative to the largest matched value (
                  {new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(maxValue)}
                  ). No fill means no reported value or no reviewed match.
                </span>
              )}
            </>
          ) : (
            <span>
              Points identify source geometries, not speaker locations. Borders are off.
              {areaMode && ' Hover an area to outline its boundary.'}
            </span>
          )}
          {presentation.hover === 'language' && (
            <span>Choose Administrative area in Hover to inspect areas on the map.</span>
          )}
          {selectedCode && selectedAssociation && selectedAssociation.status !== 'matched' && (
            <span>
              {label(selectedCode)} ({selectedCode}) has no matched polygon in this view.
            </span>
          )}
          {selectedCode && selectedAssociation?.viewpointSensitive && (
            <span>
              {label(selectedCode)} ({selectedCode}): {selectedAssociation.note}
            </span>
          )}
          {error && (
            <span role="alert">
              {error}{' '}
              <button
                type="button"
                onClick={() => {
                  setError('')
                  setRetry((value) => value + 1)
                }}
              >
                Retry
              </button>
            </span>
          )}
        </div>
      )}
    </>
  )
}
