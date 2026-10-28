import type { FeatureCollection, MultiPolygon } from 'geojson'
import type { DeliveryTile } from './delivery.ts'

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
  /** Request identity for the GeoJSON diagnostic/test adapter. */
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
  /** Tiles retained by the receiver for this same selection; send only additions. */
  readonly knownTiles?: readonly string[]
}

export interface OverlapMetrics {
  cache?: {
    decodedEntries: number
    decodedBytes: number
    partitionEntries: number
    partitionVertices: number
    indexedFeatures: number
  }
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
      readonly tile: DeliveryTile
      readonly durationMs: number
    }
  | {
      readonly requestId: number
      readonly complete: true
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

export const patternId = (variantIds: readonly string[]) => `overlap:${variantIds.join('|')}`
