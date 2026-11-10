import type { DeliveryTile } from '../overlap/delivery.ts'
import type { DeliveryMetrics } from '../overlap/deliveryStore.ts'
import type { FallbackMetrics } from '../overlap/fallbackCache.ts'
import type { OverlapRequest, OverlapResponse, TileCoordinate } from '../overlap/types.ts'
import type { FallbackGeometry } from './fallbackGeometry.ts'

export type GeometryJob =
  | { kind: 'coverage'; request: OverlapRequest }
  | {
      kind: 'source'
      archiveUrl: string
      tile: TileCoordinate
      coverage: readonly TileCoordinate[]
      fallback?: FallbackGeometry
    }
  | { kind: 'delivery'; snapshot: number; tile: TileCoordinate }

export type GeometryInput =
  | { id: number; job: GeometryJob }
  | { cancel: number }
  | { register: number; ids: readonly number[]; additions: readonly [number, DeliveryTile][] }
  | { release: number }

export type GeometryResult =
  | { kind: 'coverage'; response: OverlapResponse }
  | { kind: 'source'; data: Uint8Array; metrics: FallbackMetrics }
  | { kind: 'delivery'; data: Uint8Array; metrics: DeliveryMetrics }

export type GeometryOutput =
  | { id: number; cancelled: true }
  | { id: number; error: string; initialization?: boolean }
  | { id: number; result: GeometryResult; complete: boolean }
