import type { ExpressionSpecification, Map as MapLibreMap } from 'maplibre-gl'
import { BOUNDARY_LAYER, boundaryFilter, FALLBACK_BOUNDARY_LAYER } from '../geometryBoundaries.ts'

export const inspectionLayerId = (source: string) => `language-inspection-${source}`
export const inspectionLineOpacity: ExpressionSpecification = [
  'case',
  ['boolean', ['feature-state', 'inspected'], false],
  0.95,
  0,
]

/** Keep every boundary resident. Hover changes paint state, never source filters.
 * Promoted adjacency IDs share state across tiles, including newly loaded tiles.
 */
export const createBoundaryInspection = (
  map: Pick<
    MapLibreMap,
    | 'getSource'
    | 'querySourceFeatures'
    | 'getFeatureState'
    | 'setFeatureState'
    | 'removeFeatureState'
    | 'on'
    | 'off'
  >,
  source: string,
) => {
  let currentSource: unknown
  let groups: readonly (readonly string[])[] = []
  const applied = new Map<string, Set<string | number>>()
  const sync = () => {
    const nextSource = map.getSource(source)
    if (nextSource !== currentSource) {
      currentSource = nextSource
      applied.clear()
    }
    if (!currentSource) return
    for (const sourceLayer of [BOUNDARY_LAYER, FALLBACK_BOUNDARY_LAYER]) {
      const desired = new Set(
        groups.some((group) => group.length)
          ? map
              .querySourceFeatures(source, { sourceLayer, filter: boundaryFilter(groups) })
              .flatMap((feature) => (feature.id === undefined ? [] : [feature.id]))
          : [],
      )
      const previous = applied.get(sourceLayer) ?? new Set()
      for (const id of previous)
        if (!desired.has(id)) map.removeFeatureState({ source, sourceLayer, id }, 'inspected')
      for (const id of desired) {
        const target = { source, sourceLayer, id }
        // Source identity alone cannot establish that cached paint state is
        // still applied, for example after an explicit state reset.
        if (!previous.has(id) || map.getFeatureState(target).inspected !== true)
          map.setFeatureState(target, { inspected: true })
      }
      applied.set(sourceLayer, desired)
    }
  }
  const onData = (event: { sourceId?: string }) => {
    // Individual tile completions need not carry sourceDataType: 'content'.
    if (event.sourceId === source) sync()
  }
  map.on('sourcedata', onData)
  map.on('styledata', sync)
  return {
    set(next: readonly (readonly string[])[]) {
      groups = next
      sync()
    },
    dispose() {
      map.off('sourcedata', onData)
      map.off('styledata', sync)
      groups = []
      sync()
    },
  }
}
