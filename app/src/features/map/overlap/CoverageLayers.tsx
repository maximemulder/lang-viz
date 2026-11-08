import { Fragment, useMemo } from 'react'
import { Layer, Source } from 'react-map-gl/maplibre'
import type { GeometryVariant } from '../../../domain/atlas'
import { blendedFace } from './blending'
import type { HatchingState } from './controller'
import { COVERAGE_LAYER } from './delivery'
import { blendLayerId } from './layerIds'
import {
  BUFFERS,
  coverageSourceId,
  fallbackLayerId,
  solidLayerId,
  stripeLayerId,
} from './mapResources'

/** Render coverage snapshots independently of worker and publication lifecycles. */
export const CoverageLayers = ({
  snapshots,
  activeBuffer,
  variants,
  colors,
  sourceLayer,
  sourceVariantIds,
  sourceColors,
  sourcePriorities,
  mode,
  opacity,
  coverageReady,
}: {
  readonly snapshots: HatchingState['snapshots']
  readonly activeBuffer: HatchingState['activeBuffer']
  readonly variants: readonly Pick<GeometryVariant, 'id' | 'color'>[]
  readonly colors: ReadonlyMap<string, string>
  readonly sourceLayer: string
  readonly sourceVariantIds: readonly string[]
  readonly sourceColors: Readonly<Record<string, string>>
  readonly sourcePriorities: Readonly<Record<string, number>>
  readonly mode: 'hatching' | 'blending'
  readonly opacity: number
  readonly coverageReady: boolean
}) => {
  const blendStyles = useMemo(() => {
    const order = new Map(variants.map((variant, index) => [variant.id, index]))
    return snapshots.map((snapshot) =>
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
  }, [snapshots, variants, colors, opacity])
  return (
    <>
      {BUFFERS.map((buffer) => {
        const snapshot = snapshots[buffer]
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
                          coverageReady && activeBuffer === buffer ? opacity : 0,
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
                          coverageReady && activeBuffer === buffer ? opacity : 0,
                        'fill-layer-opacity-transition': { duration: 0 },
                        'fill-antialias': true,
                      }}
                    />
                  </>
                )}
                <Layer
                  id={fallbackLayerId(buffer)}
                  source-layer={sourceLayer}
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
                    'fill-layer-opacity': coverageReady && activeBuffer === buffer ? opacity : 0,
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
                      'fill-layer-opacity': coverageReady && activeBuffer === buffer ? 1 : 0,
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
