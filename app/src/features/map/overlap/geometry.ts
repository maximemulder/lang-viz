import type { MultiPolygon, Polygon } from 'polygon-clipping'
import polygonClipping from 'polygon-clipping'
import RBush from 'rbush'

export interface CoverageInput {
  readonly id: string
  readonly geometry: MultiPolygon
}

export interface CoverageRegion {
  readonly members: readonly string[]
  readonly geometry: MultiPolygon
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
}

export class OverlapBudgetError extends Error {
  constructor() {
    super('This area is too complex for live hatching. Zoom in or select fewer languages.')
  }
}

const boundsForPolygon = (polygon: Polygon) => {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const ring of polygon) {
    for (const [x, y] of ring) {
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  return { minX, minY, maxX, maxY }
}

/**
 * Build disjoint faces with complete memberships, rather than stacking pairwise
 * intersections (which gives incorrect colors in triple overlaps). Coordinates
 * are local vector-tile integers, so no longitude wrapping enters the overlay.
 */
export const partitionCoverage = (
  inputs: readonly CoverageInput[],
  extent: number,
  options: {
    readonly maxRegions?: number
    readonly deadline?: number
    readonly includeSingles?: boolean
  } = {},
): CoverageRegion[] => {
  const index = new RBush<CoverageRegion>()
  const maxRegions = options.maxRegions ?? 12_000
  const deadline = options.deadline ?? Number.POSITIVE_INFINITY
  let regionCount = 0
  const checkBudget = () => {
    if (regionCount > maxRegions || performance.now() > deadline) throw new OverlapBudgetError()
  }
  const insert = (geometry: MultiPolygon, members: readonly string[]) => {
    for (const polygon of geometry) {
      index.insert({ geometry: [polygon], members, ...boundsForPolygon(polygon) })
      regionCount++
    }
    checkBudget()
  }
  const tileBoundary: Polygon = [
    [
      [0, 0],
      [extent, 0],
      [extent, extent],
      [0, extent],
      [0, 0],
    ],
  ]

  // Union duplicate fragments before partitioning, so one language cannot
  // overlap itself. Sorting also makes memberships and stripe order stable.
  const grouped = new Map<string, MultiPolygon[]>()
  for (const input of inputs) {
    const fragments = grouped.get(input.id) ?? []
    fragments.push(input.geometry)
    grouped.set(input.id, fragments)
  }
  for (const [id, fragments] of [...grouped].sort(([a], [b]) => a.localeCompare(b))) {
    checkBudget()
    const [first, ...rest] = fragments
    if (!first) continue
    const merged = rest.length ? polygonClipping.union(first, ...rest) : first
    const clipped = polygonClipping.intersection(merged, tileBoundary)
    for (const polygon of clipped) {
      let remaining: MultiPolygon = [polygon]
      const candidates = index.search(boundsForPolygon(polygon))
      for (const region of candidates) {
        checkBudget()
        const shared = polygonClipping.intersection(region.geometry, [polygon])
        if (shared.length === 0) continue
        index.remove(region)
        regionCount--
        insert(polygonClipping.difference(region.geometry, [polygon]), region.members)
        insert(shared, [...region.members, id])
        remaining = polygonClipping.difference(remaining, region.geometry)
      }
      insert(remaining, [id])
    }
  }
  return index.all().filter((region) => options.includeSingles || region.members.length > 1)
}
