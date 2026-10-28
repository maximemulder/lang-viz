import type { PMTiles } from 'pmtiles'
import { ByteCache } from './byteCache.ts'
import { clipFallbackTile, type FallbackClipMetrics } from './fallback.ts'
import { coverageRectangles } from './tiles.ts'
import type { TileCoordinate } from './types.ts'

export interface FallbackMetrics extends FallbackClipMetrics {
  requests: number
  cacheHits: number
  rawCacheHits: number
  fetchMs: number
  clipMs: number
  rawBytes: number
  resultBytes: number
  rawEntries: number
  resultEntries: number
}

/** Key only the mask inside this tile, independent of unrelated snapshot changes. */
export const fallbackMaskKey = (tile: TileCoordinate, coverage: readonly TileCoordinate[]) =>
  JSON.stringify(
    coverageRectangles(tile, coverage, 1).sort(
      (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3],
    ),
  )

export class FallbackCache {
  private readonly raw = new ByteCache(48, 16 * 1024 * 1024)
  private readonly results = new ByteCache(96, 16 * 1024 * 1024)
  private readonly metrics: FallbackMetrics = {
    features: 0,
    clippedFeatures: 0,
    untouchedFeatures: 0,
    coveredFeatures: 0,
    decodeMs: 0,
    initializeMs: 0,
    overlayMs: 0,
    encodeMs: 0,
    requests: 0,
    cacheHits: 0,
    rawCacheHits: 0,
    fetchMs: 0,
    clipMs: 0,
    rawBytes: 0,
    resultBytes: 0,
    rawEntries: 0,
    resultEntries: 0,
  }

  stats(): FallbackMetrics {
    return {
      ...this.metrics,
      rawBytes: this.raw.bytes,
      resultBytes: this.results.bytes,
      rawEntries: this.raw.size,
      resultEntries: this.results.size,
    }
  }

  async get(
    archive: Pick<PMTiles, 'getZxy'>,
    archiveUrl: string,
    tile: TileCoordinate,
    coverage: readonly TileCoordinate[],
    signal: AbortSignal,
  ) {
    signal.throwIfAborted()
    this.metrics.requests++
    const rects = coverageRectangles(tile, coverage, 1)
    // No cache entry or archive read is necessary for wholly covered tiles.
    if (rects.some(([l, t, r, b]) => l === 0 && t === 0 && r === 1 && b === 1))
      return new Uint8Array()
    const rawKey = JSON.stringify([archiveUrl, tile.z, tile.x, tile.y])
    const resultKey = `${rawKey}:${fallbackMaskKey(tile, coverage)}`
    const cached = this.results.get(resultKey)
    if (cached) {
      this.metrics.cacheHits++
      return cached
    }
    let data = this.raw.get(rawKey)
    if (data) this.metrics.rawCacheHits++
    else {
      const started = performance.now()
      const response = await archive.getZxy(tile.z, tile.x, tile.y, signal)
      this.metrics.fetchMs += performance.now() - started
      signal.throwIfAborted()
      data = response ? new Uint8Array(response.data) : new Uint8Array()
      this.raw.set(rawKey, data)
    }
    // Uncovered pass-through results already live in the raw cache.
    if (!rects.length) return data
    const started = performance.now()
    const result = await clipFallbackTile(data, tile, coverage, this.metrics)
    this.metrics.clipMs += performance.now() - started
    signal.throwIfAborted()
    this.results.set(resultKey, result)
    return result
  }
}
