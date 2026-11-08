import type { FeatureCollection, MultiPolygon } from 'geojson'
import type { Refinements } from '../../../domain/refinement.ts'
import type { DeliveryTile } from './delivery.ts'
import type { PrecomputedBranches } from './precomputed.ts'

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
  /** Map source polygons to selected representations before union/partition. */
  readonly variantGroups?: Readonly<Record<string, readonly string[]>>
  readonly refinements?: Refinements
  readonly precomputed?: PrecomputedBranches
  readonly parts?: {
    readonly directory: string
    readonly profile: string
    readonly maxZoom: number
    readonly tileIndex?: string
    readonly tiles?: Readonly<Record<string, readonly string[]>>
  }
  readonly tiles: readonly TileCoordinate[]
  /** Tiles retained by the receiver for this same selection; send only additions. */
  readonly knownTiles?: readonly string[]
}

export interface OverlapMetrics {
  precomputedTiles?: number
  partsTiles?: number
  partsCacheHits?: number
  membershipMs?: number
  cache?: {
    decodedEntries: number
    decodedBytes: number
    partitionEntries: number
    partitionVertices: number
    indexedFeatures: number
    partsEntries?: number
    partsBytes?: number
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

export interface OverlapSelection {
  readonly variantIds: readonly string[]
  readonly variantGroups?: Readonly<Record<string, readonly string[]>>
  readonly refinements?: Refinements
}

export const parseOverlapSelection = (key: string): OverlapSelection => {
  const selection = JSON.parse(key)
  return Array.isArray(selection) ? { variantIds: selection } : selection
}
