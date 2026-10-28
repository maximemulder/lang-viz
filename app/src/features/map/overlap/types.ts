import type { FeatureCollection, MultiPolygon } from 'geojson'

export interface TileCoordinate {
  readonly z: number
  readonly x: number
  readonly y: number
}

export interface OverlapProperties {
  readonly pattern: string
  readonly variantIds: readonly string[]
}

export type OverlapCollection = FeatureCollection<MultiPolygon, OverlapProperties> & {
  /** Force a fresh source update even when a cached result has identical geometry. */
  readonly revision?: number
}

export interface OverlapRequest {
  readonly requestId: number
  readonly archiveUrl: string
  readonly sourceLayer: string
  readonly variantIds: readonly string[]
  readonly tiles: readonly TileCoordinate[]
}

export type OverlapResponse =
  | {
      readonly requestId: number
      readonly collection: OverlapCollection
      readonly durationMs: number
      readonly tileCount: number
    }
  | { readonly requestId: number; readonly error: string }

export const EMPTY_OVERLAPS: OverlapCollection = { type: 'FeatureCollection', features: [] }

export const patternId = (variantIds: readonly string[]) => `overlap:${variantIds.join('|')}`
