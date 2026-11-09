import type { Map as MapLibreMap } from 'maplibre-gl'

/** Keep outline geometry resident; only changed features need paint updates. */
export const createInspectionHighlight = (
  map: Pick<MapLibreMap, 'getSource' | 'setFeatureState' | 'removeFeatureState' | 'on' | 'off'>,
  sourceId: string,
  sourceLayer: string,
) => {
  let source: unknown
  let desired = new Set<string>()
  let applied = new Set<string>()
  const target = (id: string) => ({ source: sourceId, sourceLayer, id })
  const sync = () => {
    const currentSource = map.getSource(sourceId)
    if (source !== currentSource) {
      source = currentSource
      applied = new Set()
    }
    if (!source) return
    for (const id of applied) if (!desired.has(id)) map.removeFeatureState(target(id), 'inspected')
    for (const id of desired)
      if (!applied.has(id)) map.setFeatureState(target(id), { inspected: true })
    applied = desired
  }
  // Source/style replacement loses feature state. Newly loaded tiles in the
  // same source inherit it automatically, without another hover query.
  map.on('styledata', sync)
  return {
    set(ids: readonly string[]) {
      desired = new Set(ids)
      sync()
    },
    dispose() {
      map.off('styledata', sync)
      desired = new Set()
      sync()
    },
  }
}
