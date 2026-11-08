import { useAtomValue, useSetAtom } from 'jotai'
import { Fragment, lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Layer, Source, useMap } from 'react-map-gl/maplibre'
import { languageArchiveUrl } from '../../../data/atlasRepository'
import type { GeometryVariant } from '../../../domain/atlas'
import {
  atlasDataAtom,
  languageColorsAtom,
  languageOpacityAtom,
  overlapModeAtom,
  overlapStatusAtom,
} from '../../../state/atlasState'
import { blendedFace } from './blending'
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
  sourcePriorities,
  selectionKey,
  coverageReady,
  onCoverageReady,
}: {
  readonly variants: readonly Pick<GeometryVariant, 'id' | 'color'>[]
  readonly sourceVariantIds: readonly string[]
  readonly sourceColors: Readonly<Record<string, string>>
  readonly sourcePriorities: Readonly<Record<string, number>>
  readonly selectionKey: string
  readonly coverageReady: boolean
  readonly onCoverageReady: (key: string | null) => void
}) => {
  const { current } = useMap()
  const map = current?.getMap()
  const data = useAtomValue(atlasDataAtom)
  const languageColors = useAtomValue(languageColorsAtom)
  const mode = useAtomValue(overlapModeAtom)
  const opacity = useAtomValue(languageOpacityAtom)
  const setOverlapStatus = useSetAtom(overlapStatusAtom)
  const [state, setState] = useState<HatchingState>(idleHatchingState)
  const colors = useMemo(() => {
    const colors = new Map(
      data.variants.map(({ id, languageId }) => [id, languageColors.get(languageId) ?? '#777777']),
    )
    for (const { id, color } of variants) colors.set(id, color)
    return colors
  }, [data, languageColors, variants])
  const colorsRef = useRef(colors)
  const blendStyles = useMemo(() => {
    const order = new Map(variants.map((variant, index) => [variant.id, index]))
    return state.snapshots.map((snapshot) =>
      Object.fromEntries(
        (snapshot?.patterns ?? []).map((pattern) => [
          pattern.pattern,
          blendedFace(
            [...pattern.variantIds]
              .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
              .map((id) => colors.get(id) ?? '#777777'),
            opacity,
          ),
        ]),
      ),
    )
  }, [state.snapshots, variants, colors, opacity])
  const resourcesRef = useRef<ReturnType<typeof createMapResources> | null>(null)
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
      colorsRef.current,
      (id) => controller.sourceFailed(id),
      () => configRef.current.mode === 'hatching',
    )
    resourcesRef.current = resources
    const controller = createOverlapController({
      worker,
      resources,
      archiveUrl: languageArchiveUrl().replace(/^pmtiles:\/\//, ''),
      sourceLayer: data.manifest.vectorLayer,
      onChange: setState,
      onCoverageReady,
      ...(data.manifest.branchCoverage ? { precomputed: data.manifest.branchCoverage } : {}),
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
      resourcesRef.current = null
    }
  }, [map, data, onCoverageReady])

  useEffect(() => {
    colorsRef.current = colors
    resourcesRef.current?.updateColors(colors)
  }, [colors])

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
                  layout={{
                    'fill-sort-key': [
                      'coalesce',
                      ['get', ['get', 'variant_id'], ['literal', sourcePriorities]],
                      0,
                    ],
                  }}
                  paint={{
                    'fill-color': [
                      'coalesce',
                      ['get', ['get', 'variant_id'], ['literal', sourceColors]],
                      '#777777',
                    ],
                    'fill-opacity': 1,
                    'fill-layer-opacity':
                      coverageReady && state.activeBuffer === buffer ? opacity : 0,
                    'fill-layer-opacity-transition': { duration: 0 },
                    'fill-antialias': false,
                  }}
                />
                {mode === 'blending' && (
                  <Layer
                    id={blendLayerId(buffer, 0)}
                    source={coverageSourceId(buffer)}
                    source-layer={COVERAGE_LAYER}
                    type="fill"
                    paint={{
                      'fill-color': [
                        'get',
                        ['get', 'pattern'],
                        [
                          'literal',
                          Object.fromEntries(
                            Object.entries(blendStyles[buffer] ?? {}).map(([id, style]) => [
                              id,
                              style.color,
                            ]),
                          ),
                        ],
                      ],
                      'fill-opacity': [
                        'get',
                        ['get', 'pattern'],
                        [
                          'literal',
                          Object.fromEntries(
                            Object.entries(blendStyles[buffer] ?? {}).map(([id, style]) => [
                              id,
                              style.opacity,
                            ]),
                          ),
                        ],
                      ],
                      'fill-layer-opacity': coverageReady && state.activeBuffer === buffer ? 1 : 0,
                      'fill-layer-opacity-transition': { duration: 0 },
                      'fill-opacity-transition': { duration: 0 },
                      'fill-antialias': false,
                    }}
                  />
                )}
              </Source>
            </Fragment>
          )
        )
      })}
    </>
  )
}
