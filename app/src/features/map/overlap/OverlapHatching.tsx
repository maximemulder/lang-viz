import { useAtomValue, useSetAtom } from 'jotai'
import { Fragment, lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Layer, Source, useMap } from 'react-map-gl/maplibre'
import { languageArchiveUrl } from '../../../data/atlasRepository'
import type { GeometryVariant } from '../../../domain/atlas'
import {
  atlasDataAtom,
  languageOpacityAtom,
  overlapModeAtom,
  overlapStatusAtom,
} from '../../../state/atlasState'
import { createOverlapController, type HatchingState, idleHatchingState } from './controller'
import { COVERAGE_LAYER } from './delivery'
import { diagnosticsEnabled, overlapDiagnostics } from './diagnostics'
import { blendLayerId } from './layerIds'
import {
  BUFFERS,
  coverageSourceId,
  createMapResources,
  fallbackLayerId,
  solidLayerId,
  stripeLayerId,
} from './mapResources'
import { tilesForBounds } from './tiles'
import { parseOverlapSelection } from './types'
import { OverlapWorkerClient } from './workerClient'

const OverlapTestControls = lazy(() => import('./testing/OverlapTestControls'))

export const OverlapHatching = ({
  variants,
  sourceVariantIds,
  sourceColors,
  selectionKey,
  coverageReady,
  onCoverageReady,
}: {
  readonly variants: readonly Pick<GeometryVariant, 'id' | 'color'>[]
  readonly sourceVariantIds: readonly string[]
  readonly sourceColors: Readonly<Record<string, string>>
  readonly selectionKey: string
  readonly coverageReady: boolean
  readonly onCoverageReady: (key: string | null) => void
}) => {
  const { current } = useMap()
  const map = current?.getMap()
  const data = useAtomValue(atlasDataAtom)
  const mode = useAtomValue(overlapModeAtom)
  const opacity = useAtomValue(languageOpacityAtom)
  const setOverlapStatus = useSetAtom(overlapStatusAtom)
  const [state, setState] = useState<HatchingState>(idleHatchingState)
  const colors = useMemo(() => new Map(data.variants.map(({ id, color }) => [id, color])), [data])
  useEffect(() => {
    for (const { id, color } of variants) colors.set(id, color)
  }, [colors, variants])
  const configRef = useRef({ selectionKey, mode })
  const controllerRef = useRef<ReturnType<typeof createOverlapController> | null>(null)
  const refreshRef = useRef<(() => void) | null>(null)
  const retryRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    setOverlapStatus({ status: state.status, message: state.message })
  }, [setOverlapStatus, state.status, state.message])

  useEffect(() => {
    if (!map) return
    const worker = new OverlapWorkerClient(
      () => new Worker(new URL('./overlap.worker.ts', import.meta.url), { type: 'module' }),
    )
    const resources = createMapResources(
      map,
      languageArchiveUrl(),
      colors,
      (id) => controller.sourceFailed(id),
      () => configRef.current.mode === 'hatching',
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
    controller.configure(
      configRef.current.selectionKey,
      configRef.current.mode === 'hatching' ||
        Boolean(parseOverlapSelection(configRef.current.selectionKey).variantGroups),
    )
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
  }, [map, data, colors, onCoverageReady])

  useEffect(() => {
    configRef.current = { selectionKey, mode }
    controllerRef.current?.configure(
      selectionKey,
      mode === 'hatching' || Boolean(parseOverlapSelection(selectionKey).variantGroups),
    )
    // Recompute is reserved for benchmarks; selection changes already reset the controller.
    retryRef.current?.()
  }, [selectionKey, mode])

  return (
    <>
      {diagnosticsEnabled && map && (
        <Suspense fallback={null}>
          <OverlapTestControls map={map} configRef={configRef} refreshRef={refreshRef} />
        </Suspense>
      )}
      {(state.status === 'loading' || state.status === 'error') && (
        <div className="overlap-feedback" data-status={state.status} role="status">
          <span>
            {mode === 'blending' && state.status === 'loading'
              ? 'Updating combined areas…'
              : state.message}
          </span>
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
                {mode === 'hatching' && (
                  <>
                    <Layer
                      id={solidLayerId(buffer)}
                      source={coverageSourceId(buffer)}
                      source-layer={COVERAGE_LAYER}
                      type="fill"
                      filter={['has', 'variantId']}
                      paint={{
                        'fill-color': [
                          'get',
                          ['get', 'variantId'],
                          [
                            'literal',
                            Object.fromEntries(variants.map(({ id, color }) => [id, color])),
                          ],
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
                      source={coverageSourceId(buffer)}
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
                  </>
                )}
                <Layer
                  id={fallbackLayerId(buffer)}
                  source-layer={data.manifest.vectorLayer}
                  type="fill"
                  filter={['in', ['get', 'variant_id'], ['literal', sourceVariantIds]]}
                  paint={{
                    'fill-color': ['get', ['get', 'variant_id'], ['literal', sourceColors]],
                    'fill-opacity': 1,
                    'fill-layer-opacity':
                      coverageReady && state.activeBuffer === buffer ? opacity : 0,
                    'fill-layer-opacity-transition': { duration: 0 },
                    'fill-antialias': false,
                  }}
                />
                {mode === 'blending' &&
                  variants.map((variant, index) => (
                    <Layer
                      key={variant.id}
                      id={blendLayerId(buffer, index)}
                      source={coverageSourceId(buffer)}
                      source-layer={COVERAGE_LAYER}
                      type="fill"
                      filter={[
                        'any',
                        ['==', ['get', 'variantId'], variant.id],
                        [
                          'in',
                          JSON.stringify(variant.id),
                          ['coalesce', ['get', 'variantIds'], '[]'],
                        ],
                      ]}
                      paint={{
                        'fill-color': variant.color,
                        'fill-opacity': opacity,
                        'fill-layer-opacity':
                          coverageReady && state.activeBuffer === buffer ? 1 : 0,
                        'fill-layer-opacity-transition': { duration: 0 },
                        'fill-opacity-transition': { duration: 0 },
                        'fill-antialias': false,
                      }}
                    />
                  ))}
              </Source>
            </Fragment>
          )
        )
      })}
    </>
  )
}
