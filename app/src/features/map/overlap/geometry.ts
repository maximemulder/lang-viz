import { lazyResource } from './lazyResource.ts'

// Keep the worker/cache contract independent of the geometry engine.
export type Position = [number, number]
export type Polygon = Position[][]
export type MultiPolygon = Polygon[]

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

export interface PartitionOptions {
  readonly maxRegions?: number
  /** Absolute time, checked between synchronous operations; excludes initialization. */
  readonly deadline?: number
  readonly includeSingles?: boolean
}

export type CoveragePartition = (
  inputs: readonly CoverageInput[],
  extent: number,
  options?: PartitionOptions,
) => CoverageRegion[]

export class OverlapBudgetError extends Error {
  readonly reason: string

  constructor(reason = 'geometry-budget') {
    super('This area is too complex for live hatching. Zoom in or select fewer languages.')
    this.reason = reason
  }
}

export class OverlapGeometryError extends Error {}

export class OverlapInitializationError extends Error {
  constructor(cause: unknown) {
    super('Could not initialize overlap geometry. Try again.', { cause })
  }
}

/** Load/initialize WASM once, on the first uncached computation in this worker. */
export const loadCoveragePartition = lazyResource<CoveragePartition>(() =>
  import('./geos.ts')
    .then(({ createGeosPartition }) => createGeosPartition())
    .catch((error: unknown) => {
      throw new OverlapInitializationError(error)
    }),
)
