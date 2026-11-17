import type { FeatureCollection } from 'geojson'
import { useAtomValue, useSetAtom, useStore } from 'jotai'
import { useEffect, useMemo, useState } from 'react'
import { Layer, Popup, Source, useMap } from 'react-map-gl/maplibre'
import { combinedBounds } from '../../domain/languageFocus.ts'
import { mapCameraIntentAtom } from '../../state/mapCameraIntent.ts'
import { focusBounds } from '../map/focusBounds.ts'
import {
  INSPECTION_LINE_COLOR,
  INSPECTION_LINE_OPACITY,
  INSPECTION_LINE_WIDTH,
} from '../map/geometry/boundaryInspection.ts'
import { AREA_LABEL_ZOOMS, AREA_POINT_LAYER, AREA_POLYGON_LAYER } from './boundaryLayers.ts'
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
  hoveredAdministrativeAreaAtom,
  languageBordersAtom,
} from './state.ts'

const LABEL_ANCHOR = 'administrative-label-anchor'

const label = (code: string) => {
  try {
    return new Intl.DisplayNames(undefined, { type: 'region' }).of(code) ?? code
  } catch {
    return code
  }
}

export default function BoundaryLayer({ administrative }: { readonly administrative: boolean }) {
  const languageBorders = useAtomValue(languageBordersAtom)
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
  const areaMode = administrative
  const showGeometry = areaMode || languageBorders
  useEffect(() => {
    if (!showGeometry) return
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
  }, [showGeometry, retry, publishIndex])
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
    const bounds = combinedBounds(
      index.features
        .filter((feature) => request.featureIds.includes(feature.featureId))
        .map((feature) => feature.bounds),
    )
    const map = current?.getMap()
    if (!bounds || !map || store.get(mapCameraIntentAtom) !== request) return
    if (focusBounds(map, bounds)) {
      store.set(administrativeCameraRequestAtom, null)
      store.set(mapCameraIntentAtom, null)
    }
  }, [request, intent, index, current, store])

  const selectedCode = session.selection?.kind === 'territory' ? session.selection.id : null
  const selectedShape = session.selection?.kind === 'source-shape' ? session.selection.id : null
  const hoveredFeatureId = areaMode ? hovered?.featureId : null
  const outlinedFeatureIds = hoveredFeatureId
    ? [hoveredFeatureId]
    : selectedShape
      ? [selectedShape]
      : (index?.associations.get(selectedCode ?? '')?.featureIds ?? [])
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
      <Layer id={LABEL_ANCHOR} type="background" paint={{ 'background-opacity': 0 }} />
      {showGeometry && filledGeometry && (
        <Source id="administrative-boundaries" type="geojson" data={filledGeometry}>
          {session.metric && (
            <Layer
              id="administrative-metric-fill"
              type="fill"
              beforeId={LABEL_ANCHOR}
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
          {(selectedCode || selectedShape) && (
            <Layer
              id="administrative-selected-area"
              type="fill"
              beforeId={LABEL_ANCHOR}
              filter={
                selectedShape
                  ? ['==', ['get', 'featureId'], selectedShape]
                  : ['==', ['get', 'territoryCode'], selectedCode]
              }
              paint={{ 'fill-color': '#eca647', 'fill-opacity': 0.25 }}
            />
          )}
          <Layer
            id="administrative-boundary-lines"
            type="line"
            beforeId={LABEL_ANCHOR}
            paint={{
              'line-color': '#566b66',
              'line-width': 0.8,
              'line-opacity': 0.78,
            }}
          />
          {areaMode && outlinedFeatureIds.length > 0 && (
            <Layer
              id="administrative-hover-outline"
              source="administrative-boundaries"
              type="line"
              beforeId={LABEL_ANCHOR}
              filter={['in', ['get', 'featureId'], ['literal', outlinedFeatureIds]]}
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
              beforeId={LABEL_ANCHOR}
              paint={{ 'fill-color': '#000000', 'fill-opacity': 0 }}
            />
          )}
        </Source>
      )}
      {areaMode && index && (
        <Source id="administrative-points" type="geojson" data={index.points}>
          <Layer
            id={AREA_POINT_LAYER}
            type="circle"
            beforeId={LABEL_ANCHOR}
            // A small invisible target keeps tiny source shapes inspectable.
            paint={{
              'circle-radius': 8,
              'circle-opacity': 0,
            }}
          />
        </Source>
      )}
      {areaMode && index && (
        <Source id="administrative-labels" type="geojson" data={index.labels}>
          {AREA_LABEL_ZOOMS.map((zoom) => (
            <Layer
              key={zoom}
              id={`administrative-labels-${zoom}`}
              type="symbol"
              minzoom={zoom}
              filter={[
                'all',
                ['>', ['get', 'minLabel'], zoom - 1],
                ['<=', ['get', 'minLabel'], zoom],
              ]}
              layout={{
                'text-field': ['get', 'labelName'],
                'text-font': ['Arial', 'sans-serif'],
                'text-size': 13,
                'text-max-width': 10,
                'text-padding': 3,
                'symbol-sort-key': ['get', 'labelRank'],
              }}
              paint={{
                'text-color': '#182d31',
                'text-halo-color': '#fffdf6',
                'text-halo-width': 2.1,
                'text-halo-blur': 0.4,
              }}
            />
          ))}
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
          <strong>
            {hovered.territoryCode ? label(hovered.territoryCode) : hovered.sourceName}
          </strong>{' '}
          {hovered.territoryCode ? (
            <span>{hovered.territoryCode}</span>
          ) : (
            <span>No reviewed CLDR match for this shape</span>
          )}
        </Popup>
      )}
      {showGeometry && error ? (
        <div className="administrative-map-status" role="alert">
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
        </div>
      ) : (
        showGeometry &&
        !filledGeometry && (
          <div className="administrative-map-status" role="status">
            Loading boundary geometry…
          </div>
        )
      )}
    </>
  )
}
