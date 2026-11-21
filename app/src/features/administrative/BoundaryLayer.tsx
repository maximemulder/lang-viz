import type { FeatureCollection } from 'geojson'
import { useAtomValue, useSetAtom, useStore } from 'jotai'
import { useEffect, useMemo, useState } from 'react'
import { Layer, Popup, Source, useMap } from 'react-map-gl/maplibre'
import { combinedBounds } from '../../domain/languageFocus.ts'
import { mapCameraIntentAtom } from '../../state/mapCameraIntent.ts'
import { mapIsolationAtom, mapLabelsVisibleAtom } from '../../state/mapInteraction.ts'
import { focusBounds } from '../map/focusBounds.ts'
import {
  INSPECTION_LINE_COLOR,
  INSPECTION_LINE_OPACITY,
  INSPECTION_LINE_WIDTH,
} from '../map/geometry/boundaryInspection.ts'
import { MapLabelLayer } from '../map/labels/MapLabelLayer.tsx'
import { REGION_LABEL_ZOOMS, REGION_POINT_LAYER, REGION_POLYGON_LAYER } from './boundaryLayers.ts'
import {
  type BoundaryIndex,
  loadBoundaryGeometry,
  loadBoundaryIndex,
} from './boundaryRepository.ts'
import { CountryIsolationMask } from './CountryIsolationMask.tsx'
import { selectTerritoryMetric } from './selectors.ts'
import {
  administrativeCameraRequestAtom,
  administrativeRepositoryAtom,
  administrativeSessionAtom,
  boundaryIndexAtom,
  hoveredAdministrativeRegionAtom,
  languageBordersAtom,
  selectedAdministrativeFeaturesAtom,
} from './state.ts'

const LABEL_ANCHOR = 'administrative-label-anchor'

export default function BoundaryLayer({ administrative }: { readonly administrative: boolean }) {
  const languageBorders = useAtomValue(languageBordersAtom)
  const session = useAtomValue(administrativeSessionAtom)
  const labelsVisible = useAtomValue(mapLabelsVisibleAtom)
  const isolation = useAtomValue(mapIsolationAtom)
  const regionIsolation = isolation?.kind === 'region' ? isolation : null
  const selectionFeatures = useAtomValue(selectedAdministrativeFeaturesAtom)
  const repository = useAtomValue(administrativeRepositoryAtom)
  const hovered = useAtomValue(hoveredAdministrativeRegionAtom)
  const request = useAtomValue(administrativeCameraRequestAtom)
  const intent = useAtomValue(mapCameraIntentAtom)
  const store = useStore()
  const publishIndex = useSetAtom(boundaryIndexAtom)
  const { current } = useMap()
  const [index, setIndex] = useState<BoundaryIndex | null>(null)
  const [geometry, setGeometry] = useState<FeatureCollection | null>(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const regionMode = administrative
  const showGeometry = regionMode || languageBorders
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

  const hoveredFeatureId = regionMode ? hovered?.featureId : null
  const selectedFeatureIds = regionIsolation?.featureIds ?? selectionFeatures
  const hoverRecordCount = hovered?.territoryCode
    ? repository?.observationsByTerritory.get(hovered.territoryCode)?.length
    : undefined
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
          {regionMode && !regionIsolation && session.metric && (
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
          {regionMode && (
            <Layer
              id="administrative-boundary-halo"
              type="line"
              beforeId={LABEL_ANCHOR}
              paint={{
                'line-color': '#fffdf6',
                'line-width': ['interpolate', ['linear'], ['zoom'], 0, 2, 5, 3.5],
                'line-opacity': 0.78,
              }}
            />
          )}
          <Layer
            id="administrative-boundary-lines"
            type="line"
            beforeId={LABEL_ANCHOR}
            paint={{
              'line-color': regionMode ? '#344b4c' : '#566b66',
              'line-width': regionMode
                ? ['interpolate', ['linear'], ['zoom'], 0, 0.8, 5, 1.5]
                : 0.8,
              'line-opacity': regionMode ? 0.95 : 0.78,
            }}
          />
          {regionMode && (
            <Layer
              id="administrative-hover-outline"
              source="administrative-boundaries"
              type="line"
              beforeId={LABEL_ANCHOR}
              filter={['==', ['get', 'featureId'], hoveredFeatureId ?? '']}
              paint={{
                'line-color': INSPECTION_LINE_COLOR,
                'line-width': INSPECTION_LINE_WIDTH,
                'line-opacity': INSPECTION_LINE_OPACITY,
                'line-opacity-transition': { duration: 0 },
              }}
            />
          )}
          {regionMode && selectedFeatureIds.length > 0 && (
            <Layer
              id="administrative-selection-outline"
              type="line"
              beforeId={LABEL_ANCHOR}
              filter={['in', ['get', 'featureId'], ['literal', selectedFeatureIds]]}
              paint={{
                'line-color': '#e77920',
                'line-width': INSPECTION_LINE_WIDTH,
                'line-opacity': INSPECTION_LINE_OPACITY,
                'line-opacity-transition': { duration: 0 },
              }}
            />
          )}
          {regionMode && (
            <Layer
              id={REGION_POLYGON_LAYER}
              type="fill"
              beforeId={LABEL_ANCHOR}
              paint={{ 'fill-color': '#000000', 'fill-opacity': 0 }}
            />
          )}
        </Source>
      )}
      {regionMode && regionIsolation && geometry && (
        <CountryIsolationMask
          key={JSON.stringify(regionIsolation.featureIds)}
          featureIds={regionIsolation.featureIds}
          geometry={geometry}
        />
      )}
      {regionMode && index && (
        <Source id="administrative-points" type="geojson" data={index.points}>
          <Layer
            id={REGION_POINT_LAYER}
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
      {labelsVisible && regionMode && index && (
        <Source id="administrative-labels" type="geojson" data={index.labels}>
          {REGION_LABEL_ZOOMS.map((zoom) => (
            <MapLabelLayer
              key={zoom}
              id={`administrative-labels-${zoom}`}
              minzoom={zoom}
              filter={[
                'all',
                ['>', ['get', 'minLabel'], zoom - 1],
                ['<=', ['get', 'minLabel'], zoom],
              ]}
            />
          ))}
        </Source>
      )}
      {regionMode && hovered && (
        <Popup
          longitude={hovered.longitude}
          latitude={hovered.latitude}
          anchor="bottom"
          offset={12}
          closeButton={false}
          closeOnClick={false}
          className="language-inspector"
        >
          <section aria-label="Region preview" className="language-inspector__entry">
            <span
              className="language-inspector__swatch"
              style={{ backgroundColor: '#344b4c' }}
              aria-hidden="true"
            />
            <div>
              <strong>{hovered.sourceName}</strong>
              {hoverRecordCount !== undefined && (
                <p className="language-inspector__context">
                  {hoverRecordCount.toLocaleString()} reported language records
                </p>
              )}
              <small>Click for details · double-click to focus</small>
            </div>
          </section>
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
