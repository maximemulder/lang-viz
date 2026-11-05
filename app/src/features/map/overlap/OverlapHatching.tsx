import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { Fragment, useEffect, useRef, useState } from 'react'
import { Layer, Source, useMap } from 'react-map-gl/maplibre'
import { languageArchiveUrl } from '../../../data/atlasRepository'
import type { GeometryVariant } from '../../../domain/atlas'
import {
  atlasDataAtom,
  geographyDatasetFilterAtom,
  languageOpacityAtom,
  overlapModeAtom,
  overlapStatusAtom,
  temporalViewAtom,
  visibleLanguageIdsAtom,
} from '../../../state/atlasState'
import { createOverlapController, type HatchingState, idleHatchingState } from './controller'
import { COVERAGE_LAYER } from './delivery'
import { diagnosticsEnabled, overlapDiagnostics } from './diagnostics'
import {
  BUFFERS,
  coverageSourceId,
  createMapResources,
  fallbackLayerId,
  solidLayerId,
  stripeLayerId,
} from './mapResources'
import { installOverlapTestApi } from './testBridge'
import { tilesForBounds } from './tiles'
import { OverlapWorkerClient } from './workerClient'

export const OverlapHatching = ({
  variants,
  selectionKey,
  coverageReady,
  onCoverageReady,
}: {
  readonly variants: readonly GeometryVariant[]
  readonly selectionKey: string
  readonly coverageReady: boolean
  readonly onCoverageReady: (key: string | null) => void
}) => {
  const { current } = useMap()
  const map = current?.getMap()
  const data = useAtomValue(atlasDataAtom)
  const [mode, setMode] = useAtom(overlapModeAtom)
  const opacity = useAtomValue(languageOpacityAtom)
  const setOverlapStatus = useSetAtom(overlapStatusAtom)
  const setVisibleIds = useSetAtom(visibleLanguageIdsAtom)
  const setPeriod = useSetAtom(temporalViewAtom)
  const setDatasetFilter = useSetAtom(geographyDatasetFilterAtom)
  const [state, setState] = useState<HatchingState>(idleHatchingState)
  const configRef = useRef({ selectionKey, mode })
  const controllerRef = useRef<ReturnType<typeof createOverlapController> | null>(null)
  const refreshRef = useRef<(() => void) | null>(null)
  const retryRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    setOverlapStatus({ status: state.status, message: state.message })
  }, [setOverlapStatus, state.status, state.message])

  useEffect(() => {
    if (!diagnosticsEnabled || !map) return
    return installOverlapTestApi(
      map,
      (options) => {
        setPeriod('contemporary')
        setDatasetFilter(['asher2007world'])
        setMode('hatching')
        setVisibleIds(
          options.languageIds === 'all'
            ? [
                ...new Set(
                  data.variants
                    .filter((v) => v.datasetId === 'asher2007world')
                    .map((v) => v.languageId),
                ),
              ]
            : options.languageIds,
        )
        map.jumpTo({ center: options.center, zoom: options.zoom })
      },
      () => refreshRef.current?.(),
      () => configRef.current.selectionKey,
    )
  }, [map, data, setPeriod, setDatasetFilter, setMode, setVisibleIds])

  useEffect(() => {
    if (!map) return
    const worker = new OverlapWorkerClient(
      () => new Worker(new URL('./overlap.worker.ts', import.meta.url), { type: 'module' }),
    )
    const resources = createMapResources(
      map,
      languageArchiveUrl(),
      new Map(data.variants.map(({ id, color }) => [id, color])),
      (id) => controller.sourceFailed(id),
    )
    const controller = createOverlapController({
      worker,
      resources,
      archiveUrl: languageArchiveUrl().replace(/^pmtiles:\/\//, ''),
      sourceLayer: data.manifest.vectorLayer,
      onChange: setState,
      onCoverageReady,
      ...(diagnosticsEnabled ? { diagnostics: overlapDiagnostics } : {}),
    })
    controllerRef.current = controller
    const refresh = () => {
      if (map.isMoving() || !map.getLayer('selected-language-areas')) return
      const bounds = map.getBounds()
      controller.refresh(
        tilesForBounds(
          {
            west: bounds.getWest(),
            east: bounds.getEast(),
            south: bounds.getSouth(),
            north: bounds.getNorth(),
          },
          map.getZoom(),
        ),
      )
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      clearTimeout(timer)
      timer = setTimeout(refresh, 120)
    }
    refreshRef.current = () => {
      controller.recompute()
      schedule()
    }
    retryRef.current = () => {
      controller.retry()
      refresh()
    }
    worker.onmessage = ({ data }) => controller.receive(data)
    worker.onerror = () => controller.workerFailed()
    for (const event of ['load', 'moveend', 'resize', 'idle'] as const) map.on(event, schedule)
    map.on('idle', resources.prune)
    map.on('sourcedata', controller.publish)
    map.on('idle', controller.publish)
    controller.configure(configRef.current.selectionKey, configRef.current.mode === 'hatching')
    schedule()
    return () => {
      clearTimeout(timer)
      refreshRef.current = null
      retryRef.current = null
      controllerRef.current = null
      for (const event of ['load', 'moveend', 'resize', 'idle'] as const) map.off(event, schedule)
      map.off('idle', resources.prune)
      map.off('sourcedata', controller.publish)
      map.off('idle', controller.publish)
      controller.dispose()
      resources.dispose()
    }
  }, [map, data, onCoverageReady])

  useEffect(() => {
    configRef.current = { selectionKey, mode }
    controllerRef.current?.configure(selectionKey, mode === 'hatching')
    // Recompute is reserved for benchmarks; selection changes already reset the controller.
    retryRef.current?.()
  }, [selectionKey, mode])

  return (
    <>
      {mode === 'hatching' && (state.status === 'loading' || state.status === 'error') && (
        <div className="overlap-feedback" data-status={state.status} role="status">
          <span>{state.message}</span>
          {state.status === 'error' && (
            <button type="button" onClick={() => retryRef.current?.()}>
              Retry
            </button>
          )}
        </div>
      )}
      {BUFFERS.map((buffer) => {
        const snapshot = state.snapshots[buffer]
        return (
          snapshot && (
            <Fragment key={buffer}>
              <Source
                key={`${buffer}-${snapshot.maxzoom}`}
                id={coverageSourceId(buffer)}
                type="vector"
                tiles={[snapshot.url]}
                minzoom={0}
                maxzoom={snapshot.maxzoom}
              >
                <Layer
                  id={solidLayerId(buffer)}
                  source-layer={COVERAGE_LAYER}
                  type="fill"
                  filter={['has', 'variantId']}
                  paint={{
                    'fill-color': [
                      'get',
                      ['get', 'variantId'],
                      ['literal', Object.fromEntries(variants.map(({ id, color }) => [id, color]))],
                    ],
                    'fill-opacity': 1,
                    'fill-layer-opacity':
                      coverageReady && state.activeBuffer === buffer ? opacity : 0,
                    'fill-layer-opacity-transition': { duration: 0 },
                    'fill-antialias': true,
                  }}
                />
                <Layer
                  id={stripeLayerId(buffer)}
                  source-layer={COVERAGE_LAYER}
                  type="fill"
                  filter={['!', ['has', 'variantId']]}
                  paint={{
                    'fill-pattern': ['get', 'pattern'],
                    'fill-opacity': 1,
                    'fill-layer-opacity':
                      coverageReady && state.activeBuffer === buffer ? opacity : 0,
                    'fill-layer-opacity-transition': { duration: 0 },
                    'fill-antialias': true,
                  }}
                />
                <Layer
                  id={fallbackLayerId(buffer)}
                  source-layer={data.manifest.vectorLayer}
                  type="fill"
                  filter={['in', ['get', 'variant_id'], ['literal', variants.map(({ id }) => id)]]}
                  paint={{
                    'fill-color': ['get', 'color'],
                    'fill-opacity': 1,
                    'fill-layer-opacity':
                      coverageReady && state.activeBuffer === buffer ? opacity : 0,
                    'fill-layer-opacity-transition': { duration: 0 },
                    'fill-antialias': false,
                  }}
                />
              </Source>
            </Fragment>
          )
        )
      })}
    </>
  )
}
