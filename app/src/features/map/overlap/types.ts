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
  /** Tile interiors replaced by this complete partition, including empty tiles. */
  readonly coverageTiles?: readonly TileCoordinate[]
}

export interface OverlapRequest {
  readonly profile?: boolean
  readonly requestId: number
  readonly archiveUrl: string
  readonly sourceLayer: string
  readonly variantIds: readonly string[]
  readonly tiles: readonly TileCoordinate[]
}

export interface OverlapMetrics {
  fetchMs: number
  decodeMs: number
  initializeMs: number
  partitionMs: number
  outputMs: number
  decodedCacheHits: number
  partitionCacheHits: number
  inputVertices: number
  outputVertices: number
  completedTiles: number
}

export type OverlapResponse =
  | {
      readonly requestId: number
      readonly collection: OverlapCollection
      readonly durationMs: number
      readonly tileCount: number
      readonly metrics?: OverlapMetrics
    }
  | {
      readonly requestId: number
      readonly error: string
      readonly failure: string
      readonly durationMs: number
      readonly metrics?: OverlapMetrics
    }

export const EMPTY_OVERLAPS: OverlapCollection = { type: 'FeatureCollection', features: [] }

export const patternId = (variantIds: readonly string[]) => `overlap:${variantIds.join('|')}`
