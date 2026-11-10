import { addProtocol } from 'maplibre-gl'
import type { FallbackGeometry } from '../geometry/fallbackGeometry.ts'
import { geometryService } from '../geometry/geometryService.ts'
import { combineTileLayers, type DeliveryTile, isTileDescendant, tileKey } from './delivery.ts'
import { checkTileTestFailure, delayTileTest, diagnosticsEnabled } from './diagnostics.ts'
import { requestFallbackTile } from './fallbackProtocol.ts'
import { serviceDiagnostics } from './serviceDiagnostics.ts'
import type { OverlapProperties, TileCoordinate } from './types.ts'

let nextId = 0
const snapshots = new Map<number, ReadonlyMap<string, DeliveryTile>>()
const fallbacks = new Map<number, FallbackGeometry>()
const recordSnapshots = () => {
  if (!diagnosticsEnabled) return
  const tiles = new Set([...snapshots.values()].flatMap((snapshot) => [...snapshot.values()]))
  const bytes = [...tiles].reduce(
    (sum, tile) => sum + tile.data.byteLength + tile.renderData.byteLength,
    0,
  )
  serviceDiagnostics.receiver = {
    snapshots: snapshots.size,
    tiles: tiles.size,
    bytes,
    peakBytes: Math.max(serviceDiagnostics.receiver?.peakBytes ?? 0, bytes),
  }
}

export interface CoverageSnapshot {
  readonly id: number
  readonly url: string
  readonly coverageTiles: readonly TileCoordinate[]
  readonly maxzoom: number
  readonly patterns?: readonly OverlapProperties[]
  readonly composed?: boolean
}

/** Snapshots share immutable encoded tile buffers; they never copy the geometry. */
export const registerCoverage = (
  tiles: ReadonlyMap<string, DeliveryTile>,
  archiveUrl: string,
  fallback?: FallbackGeometry,
): CoverageSnapshot => {
  const id = ++nextId
  snapshots.set(id, new Map(tiles))
  if (fallback) fallbacks.set(id, fallback)
  recordSnapshots()
  geometryService.register(id, [...tiles.values()])
  return {
    id,
    url: `language-overlap://${id}/{z}/{x}/{y}?archive=${encodeURIComponent(archiveUrl.replace(/^pmtiles:\/\//, ''))}&fallback=${fallback ? 1 : 0}`,
    coverageTiles: [...tiles.values()].map(({ tile }) => tile),
    composed: [...tiles.values()].every((tile) => !tile.fallback),
    maxzoom: tiles.values().next().value?.tile.z ?? 0,
    patterns: [
      ...new Map(
        [...tiles.values()].flatMap((tile) => tile.patterns).map((p) => [p.pattern, p]),
      ).values(),
    ],
  }
}

export const releaseCoverage = (snapshot: CoverageSnapshot) => {
  snapshots.delete(snapshot.id)
  fallbacks.delete(snapshot.id)
  recordSnapshots()
  geometryService.release(snapshot.id)
}

const requestCoverageTile = async (id: number, target: TileCoordinate, signal: AbortSignal) => {
  await delayTileTest('coverage', signal)
  signal.throwIfAborted()
  const tiles = snapshots.get(id)
  checkTileTestFailure('coverage', id)
  const native = tiles?.get(tileKey(target))
  if (
    native ||
    !tiles ||
    ![...tiles.values()].some((tile) => tile.data.length && isTileDescendant(tile.tile, target))
  ) {
    if (diagnosticsEnabled) serviceDiagnostics.nativeRequests++
    return native?.renderData ?? new Uint8Array()
  }
  const result = await geometryService.request(
    { kind: 'delivery', snapshot: id, tile: target },
    signal,
  )
  if (result.kind !== 'delivery') throw new Error('Invalid geometry delivery')
  if (diagnosticsEnabled) serviceDiagnostics.delivery = result.metrics
  return result.data
}

addProtocol('language-overlap', async ({ url }, controller) => {
  controller.signal.throwIfAborted()
  const [path = '', query] = url.split('?')
  const [id, z, x, y] = path.slice('language-overlap://'.length).split('/').map(Number)
  const archiveUrl = new URLSearchParams(query).get('archive')
  const needsFallback = new URLSearchParams(query).get('fallback') !== '0'
  if (
    id === undefined ||
    z === undefined ||
    x === undefined ||
    y === undefined ||
    ![id, z, x, y].every(Number.isInteger) ||
    !archiveUrl
  )
    throw new Error('Invalid overlap tile URL')
  const tiles = snapshots.get(id)
  // Removed sources can finish already scheduled requests; they no longer draw.
  if (!tiles) return { data: new ArrayBuffer(0) }
  const cancellation = new AbortController()
  const abort = () => cancellation.abort()
  controller.signal.addEventListener('abort', abort, { once: true })
  try {
    const target = { z, x, y }
    const [coverage, fallback] = await Promise.all([
      requestCoverageTile(id, target, cancellation.signal),
      needsFallback
        ? requestFallbackTile(
            archiveUrl,
            [...tiles.values()].filter((tile) => !tile.fallback).map(({ tile }) => tile),
            target,
            id,
            cancellation.signal,
            fallbacks.get(id),
          )
        : Promise.resolve(new Uint8Array()),
    ])
    controller.signal.throwIfAborted()
    // One source owns both sides of the partition. Tile retention and stencil
    // clipping cannot select a fallback mask without its coverage geometry.
    return { data: combineTileLayers(coverage, new Uint8Array(fallback)).buffer as ArrayBuffer }
  } finally {
    cancellation.abort()
    controller.signal.removeEventListener('abort', abort)
  }
})

if (import.meta.hot)
  import.meta.hot.dispose(() => {
    for (const id of snapshots.keys()) geometryService.release(id)
    snapshots.clear()
    fallbacks.clear()
  })
