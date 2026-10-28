import { ByteCache } from './byteCache.ts'
import { type DeliveryTile, deliveryTile, tileKey } from './delivery.ts'
import type { TileCoordinate } from './types.ts'

export interface DeliveryMetrics {
  parentRequests: number
  parentCacheHits: number
  assemblyMs: number
  nativeBytes: number
  parentBytes: number
  parentEntries: number
  snapshots: number
  tiles: number
}

/** Worker-owned snapshot references and bounded, reusable ancestor tile payloads. */
export class DeliveryStore {
  private readonly tiles = new Map<number, DeliveryTile>()
  private readonly snapshots = new Map<number, readonly number[]>()
  private readonly parents = new ByteCache(48, 8 * 1024 * 1024)
  private parentRequests = 0
  private parentCacheHits = 0
  private assemblyMs = 0

  register(id: number, ids: readonly number[], additions: readonly [number, DeliveryTile][]) {
    for (const [key, tile] of additions) this.tiles.set(key, tile)
    this.snapshots.set(id, ids)
  }

  release(id: number) {
    this.snapshots.delete(id)
    const used = new Set([...this.snapshots.values()].flat())
    for (const key of this.tiles.keys()) if (!used.has(key)) this.tiles.delete(key)
  }

  stats(): DeliveryMetrics {
    return {
      parentRequests: this.parentRequests,
      parentCacheHits: this.parentCacheHits,
      assemblyMs: this.assemblyMs,
      nativeBytes: [...this.tiles.values()].reduce((sum, tile) => sum + tile.data.byteLength, 0),
      parentBytes: this.parents.bytes,
      parentEntries: this.parents.size,
      snapshots: this.snapshots.size,
      tiles: this.tiles.size,
    }
  }

  get(id: number, target: TileCoordinate) {
    this.parentRequests++
    const ids = (this.snapshots.get(id) ?? []).filter((key) => {
      const source = this.tiles.get(key)?.tile
      if (!source) return false
      const scale = 2 ** (source.z - target.z)
      return (
        scale >= 1 &&
        Math.floor(source.x / scale) === target.x &&
        Math.floor(source.y / scale) === target.y
      )
    })
    // Unrelated additions to a snapshot don't invalidate this parent tile.
    const key = `${tileKey(target)}:${ids.sort((a, b) => a - b).join(',')}`
    const cached = this.parents.get(key)
    if (cached) {
      this.parentCacheHits++
      return cached
    }
    const started = performance.now()
    const tiles = new Map<string, DeliveryTile>()
    for (const id of ids) {
      const tile = this.tiles.get(id)
      if (tile) tiles.set(tileKey(tile.tile), tile)
    }
    const data = deliveryTile(tiles, target)
    this.assemblyMs += performance.now() - started
    this.parents.set(key, data)
    return data
  }
}

export type DeliveryRequest =
  | { register: number; ids: readonly number[]; additions: readonly [number, DeliveryTile][] }
  | { release: number }
  | { request: number; snapshot: number; tile: TileCoordinate }

export interface DeliveryResponse {
  readonly request: number
  readonly data?: Uint8Array
  readonly error?: string
  readonly metrics: DeliveryMetrics
}
