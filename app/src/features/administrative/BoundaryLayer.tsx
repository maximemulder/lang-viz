import type { FeatureCollection } from 'geojson'
import { useAtomValue, useSetAtom, useStore } from 'jotai'
import { useEffect, useMemo, useState } from 'react'
import { Layer, Popup, Source, useMap } from 'react-map-gl/maplibre'
import { combinedBounds } from '../../domain/languageFocus.ts'
import { mapCameraIntentAtom } from '../../state/mapCameraIntent.ts'
import {
  mapColorsVisibleAtom,
  mapIsolationAtom,
  regionIsolationReadyAtom,
} from '../../state/mapInteraction.ts'
import { focusBounds } from '../map/focusBounds.ts'
import {
  INSPECTION_LINE_COLOR,
  INSPECTION_LINE_OPACITY,
  INSPECTION_LINE_WIDTH,
} from '../map/geometry/boundaryInspection.ts'
import { AdministrativeZoom } from './AdministrativeZoom.tsx'
import { REGION_LABEL_ZOOMS, REGION_POINT_LAYER, REGION_POLYGON_LAYER } from './boundaryLayers.ts'
import {
  type BoundaryIndex,
  loadBoundaryGeometry,
  loadBoundaryIndex,
} from './boundaryRepository.ts'
import { selectTerritoryMetric } from './selectors.ts'
import {
  administrativeCameraRequestAtom,
  administrativeHoverAtom,
  administrativeRepositoryAtom,
  administrativeSessionAtom,
  boundaryIndexAtom,
  hoveredAdministrativeRegionAtom,
  languageBordersAtom,
} from './state.ts'

const LABEL_ANCHOR = 'administrative-label-anchor'

export default function BoundaryLayer({ administrative }: { readonly administrative: boolean }) {
  const isolation = useAtomValue(mapIsolationAtom)
  const colorsVisible = useAtomValue(mapColorsVisibleAtom)
  const setIsolationReady = useSetAtom(regionIsolationReadyAtom)
  const [outsideMask, setOutsideMask] = useState<{ key: string; data: FeatureCollection } | null>(
    null,
  )
  const [maskError, setMaskError] = useState('')
  const hoverPosition = useAtomValue(administrativeHoverAtom)
  const languageBorders = useAtomValue(languageBordersAtom)
  const session = useAtomValue(administrativeSessionAtom)
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

  const maskKey = isolation?.kind === 'region' ? JSON.stringify(isolation.featureIds) : ''
  useEffect(() => {
    setIsolationReady(false)
    setMaskError('')
    if (!maskKey || !geometry) {
      setOutsideMask(null)
      return
    }
    const ids: string[] = JSON.parse(maskKey)
    const worker = new Worker(new URL('./countryMask.worker.ts', import.meta.url), {
      type: 'module',
    })
    worker.onmessage = ({ data }) => {
      if (data.error) {
        setMaskError(data.error)
        return
      }
      setOutsideMask({ key: maskKey, data: data.mask })
    }
    worker.onerror = () =>
      setMaskError('Country isolation could not be prepared. Try selecting the country again.')
    worker.postMessage(
      geometry.features
        .filter((feature) => ids.includes(String(feature.properties?.featureId)))
        .map((feature) => feature.geometry),
    )
    return () => worker.terminate()
  }, [maskKey, geometry, setIsolationReady])

  useEffect(() => {
    const map = current?.getMap()
    if (!map || !outsideMask || outsideMask.key !== maskKey) return
    const ready = () => {
      if (map.getSource('country-outside-mask') && map.isSourceLoaded('country-outside-mask'))
        setIsolationReady(true)
    }
    map.on('sourcedata', ready)
    ready()
    return () => {
      map.off('sourcedata', ready)
    }
  }, [outsideMask, maskKey, current, setIsolationReady])
  const selectedCode = session.selection?.kind === 'territory' ? session.selection.id : null
  const selectedShape = session.selection?.kind === 'source-shape' ? session.selection.id : null
  const hoveredFeatureId = regionMode ? hovered : null
  const selectedFeatureIds = selectedShape
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
          {regionMode && colorsVisible && !isolation && session.metric && (
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
          {regionMode && hoveredFeatureId && (
            <Layer
              id="administrative-hover-outline"
              source="administrative-boundaries"
              type="line"
              beforeId={LABEL_ANCHOR}
              filter={['==', ['get', 'featureId'], hoveredFeatureId]}
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
                'line-color': isolation?.kind === 'region' ? isolation.color : '#e77920',
                'line-width': 3,
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
      {regionMode && outsideMask?.key === maskKey && (
        <Source key={maskKey} id="country-outside-mask" type="geojson" data={outsideMask.data}>
          <Layer
            id="country-outside-mask-fill"
            type="fill"
            beforeId="administrative-boundary-halo"
            paint={{
              'fill-color': '#f3f2ec',
              'fill-opacity': 0.9999,
              'fill-opacity-transition': { duration: 0 },
            }}
          />
        </Source>
      )}
      {regionMode && <AdministrativeZoom />}
      {maskError && (
        <div className="administrative-map-status" role="alert">
          {maskError}
        </div>
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
      {regionMode && index && (
        <Source id="administrative-labels" type="geojson" data={index.labels}>
          {REGION_LABEL_ZOOMS.map((zoom) => (
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
                'text-opacity': ['interpolate', ['linear'], ['zoom'], 5.5, 1, 7, 0],
                'text-halo-color': '#fffdf6',
                'text-halo-width': 2.1,
                'text-halo-blur': 0.4,
              }}
            />
          ))}
        </Source>
      )}
      {regionMode && hoverPosition && (
        <Popup
          longitude={hoverPosition.longitude}
          latitude={hoverPosition.latitude}
          anchor="bottom"
          offset={12}
          closeButton={false}
          closeOnClick={false}
          className="language-inspector"
        >
          <section aria-label="Region preview">
            <article className="language-inspector__entry">
              <span
                className="language-inspector__swatch"
                style={{ backgroundColor: '#8d9a91' }}
                aria-hidden="true"
              />
              <div>
                <strong>{hoverPosition.sourceName}</strong>
                <p className="language-inspector__context">Administrative region</p>
                {hoverPosition.territoryCode &&
                  repository?.observationsByTerritory.has(hoverPosition.territoryCode) && (
                    <p className="language-inspector__context">
                      {repository.observationsByTerritory.get(hoverPosition.territoryCode)?.length}{' '}
                      reported language records
                    </p>
                  )}
                <small>Click for details · double-click to zoom in</small>
              </div>
            </article>
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
