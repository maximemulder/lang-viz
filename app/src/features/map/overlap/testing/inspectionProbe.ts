import type { Map as MapLibreMap } from 'maplibre-gl'
import { geometryDisplay } from '../../geometry/display.ts'
import { visibleColorLayers, visibleVariantIds } from '../../inspection.ts'
import { parseOverlapSelection } from '../types.ts'
import { highlightBoundaryEvidence } from './highlightProbe.ts'

export interface InspectionProbe {
  readonly variantIds: readonly string[]
  readonly queryMs: number
  readonly renderedMs: number
  readonly filterUnchanged: boolean
  readonly timedOut: boolean
  readonly sourceReloads: number
}

const coverageFilters = (map: MapLibreMap) =>
  visibleColorLayers(map).map((id) => map.getFilter(id) ?? null)

export const inspectionHighlightState = (map: MapLibreMap, sourceIds: readonly string[]) => {
  const evidence = highlightBoundaryEvidence(map, 'language-inspection')
  const merged = new Set(evidence.variantIds)
  return {
    boundaryFeatures: evidence.boundaryFeatures,
    variantIds: sourceIds.filter((id) => merged.has(id)),
    filter: coverageFilters(map),
  }
}

/** Picking and event-to-render timings; only loaded by the explicit browser test flag. */
export const probeInspection = (
  map: MapLibreMap,
  center: [number, number],
  selectionKey: string,
): Promise<InspectionProbe> => {
  const selection = parseOverlapSelection(selectionKey)
  const point = map.project(center)
  const queryStart = performance.now()
  const variantIds = visibleVariantIds(map, point, selection.refinements, selection.variantGroups)
  const queryMs = performance.now() - queryStart
  const sourceIds = selection.variantGroups
    ? Object.entries(selection.variantGroups)
        .filter(([, groups]) => groups.some((id) => variantIds.includes(id)))
        .map(([id]) => id)
    : variantIds
  const previous = inspectionHighlightState(map, selection.variantIds)
  const candidates = [...new Set([...previous.variantIds, ...sourceIds])]
  const expected = JSON.stringify([...sourceIds].sort())
  const matches = () =>
    JSON.stringify(inspectionHighlightState(map, candidates).variantIds.sort()) === expected
  const unchanged = matches()
  const started = performance.now()
  const source = geometryDisplay(map).getSnapshot().source
  return new Promise((resolve) => {
    let sourceReloads = 0
    const onSourceLoading = (event: { sourceId?: string }) => {
      if (event.sourceId === source) sourceReloads++
    }
    const finish = (timedOut: boolean) => {
      clearTimeout(timer)
      map.off('render', onRender)
      map.off('sourcedataloading', onSourceLoading)
      resolve({
        variantIds,
        queryMs,
        renderedMs: unchanged ? 0 : performance.now() - started,
        filterUnchanged: JSON.stringify(coverageFilters(map)) === JSON.stringify(previous.filter),
        timedOut,
        sourceReloads,
      })
    }
    const onRender = () => {
      if (map.loaded() && matches()) finish(false)
    }
    const timer = setTimeout(() => finish(true), 15_000)
    map.on('render', onRender)
    map.on('sourcedataloading', onSourceLoading)
    map.fire('mousemove', {
      point,
      lngLat: map.unproject(point),
      originalEvent: new MouseEvent('mousemove'),
    })
    // Staying within the same membership needs no new map render.
    if (unchanged) finish(false)
  })
}
