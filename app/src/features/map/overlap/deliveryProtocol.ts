import { addProtocol } from 'maplibre-gl'
import { type DeliveryTile, isTileDescendant, tileKey } from './delivery.ts'
import type { DeliveryRequest, DeliveryResponse } from './deliveryStore.ts'
import { diagnosticsEnabled } from './diagnostics.ts'
import { serviceDiagnostics } from './serviceDiagnostics.ts'
import type { TileCoordinate } from './types.ts'

let nextId = 0
let nextTileId = 0
let nextRequestId = 0
let worker: Worker | undefined
const tileIds = new WeakMap<DeliveryTile, number>()
const sentIds = new Set<number>()
const pending = new Map<
  number,
  { resolve: (data: Uint8Array) => void; reject: (error: Error) => void }
>()

const postSnapshot = (id: number, tiles: ReadonlyMap<string, DeliveryTile>) => {
  const additions: [number, DeliveryTile][] = []
  const ids = [...tiles.values()].map((tile) => {
    let key = tileIds.get(tile)
    if (key === undefined) {
      key = ++nextTileId
      tileIds.set(tile, key)
    }
    if (!sentIds.has(key)) {
      sentIds.add(key)
      additions.push([key, tile])
    }
    return key
  })
  const request: DeliveryRequest = { register: id, ids, additions }
  worker?.postMessage(request)
}

const ensureWorker = () => {
  if (worker) return worker
  worker = new Worker(new URL('./delivery.worker.ts', import.meta.url), { type: 'module' })
  const currentWorker = worker
  sentIds.clear()
  for (const [id, tiles] of snapshots) postSnapshot(id, tiles)
  worker.onmessage = ({ data }: MessageEvent<DeliveryResponse>) => {
    if (worker !== currentWorker) return
    if (diagnosticsEnabled) serviceDiagnostics.delivery = data.metrics
    const request = pending.get(data.request)
    pending.delete(data.request)
    if (data.error) request?.reject(new Error(data.error))
    else request?.resolve(data.data ?? new Uint8Array())
  }
  worker.onerror = () => {
    if (worker !== currentWorker) return
    for (const request of pending.values())
      request.reject(new Error('Could not assemble overlap tiles.'))
    pending.clear()
    worker?.terminate()
    worker = undefined
  }
  return worker
}
const snapshots = new Map<number, ReadonlyMap<string, DeliveryTile>>()
const recordSnapshots = () => {
  if (!diagnosticsEnabled) return
  const tiles = new Set([...snapshots.values()].flatMap((snapshot) => [...snapshot.values()]))
  const bytes = [...tiles].reduce((sum, tile) => sum + tile.data.byteLength, 0)
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
}

/** Snapshots share immutable encoded tile buffers; they never copy the geometry. */
export const registerCoverage = (tiles: ReadonlyMap<string, DeliveryTile>): CoverageSnapshot => {
  const id = ++nextId
  snapshots.set(id, new Map(tiles))
  recordSnapshots()
  if (worker) postSnapshot(id, tiles)
  return {
    id,
    url: `language-overlap://${id}/{z}/{x}/{y}`,
    coverageTiles: [...tiles.values()].map(({ tile }) => tile),
    maxzoom: tiles.values().next().value?.tile.z ?? 0,
  }
}

export const releaseCoverage = (snapshot: CoverageSnapshot) => {
  snapshots.delete(snapshot.id)
  recordSnapshots()
  worker?.postMessage({ release: snapshot.id } satisfies DeliveryRequest)
  const used = new Set(
    [...snapshots.values()].flatMap((tiles) =>
      [...tiles.values()].map((tile) => tileIds.get(tile)),
    ),
  )
  for (const id of sentIds) if (!used.has(id)) sentIds.delete(id)
}

addProtocol('language-overlap', async ({ url }, controller) => {
  controller.signal.throwIfAborted()
  const [id, z, x, y] = url.slice('language-overlap://'.length).split('/').map(Number)
  if (
    id === undefined ||
    z === undefined ||
    x === undefined ||
    y === undefined ||
    ![id, z, x, y].every(Number.isInteger)
  )
    throw new Error('Invalid overlap tile URL')
  const tiles = snapshots.get(id)
  // A released staging source may finish an already scheduled request. Empty
  // data is safe: the corresponding source is inactive or being removed.
  const native = tiles?.get(tileKey({ z, x, y }))
  if (
    native ||
    !tiles ||
    ![...tiles.values()].some(
      (tile) => tile.data.length && isTileDescendant(tile.tile, { z, x, y }),
    )
  ) {
    if (diagnosticsEnabled) serviceDiagnostics.nativeRequests++
    return { data: (native?.data ?? new Uint8Array()).slice().buffer }
  }
  const request = ++nextRequestId
  const currentWorker = ensureWorker()
  const abort = () => {
    pending.get(request)?.reject(new DOMException('Tile request aborted', 'AbortError'))
    pending.delete(request)
  }
  controller.signal.addEventListener('abort', abort, { once: true })
  let data: Uint8Array
  try {
    data = await new Promise<Uint8Array>((resolve, reject) => {
      pending.set(request, { resolve, reject })
      currentWorker.postMessage({
        request,
        snapshot: id,
        tile: { z, x, y },
      } satisfies DeliveryRequest)
    })
  } finally {
    controller.signal.removeEventListener('abort', abort)
  }
  // The worker transferred a disposable copy, independent of its cached bytes.
  return { data: data.buffer as ArrayBuffer }
})

if (import.meta.hot)
  import.meta.hot.dispose(() => {
    worker?.terminate()
    snapshots.clear()
    for (const request of pending.values()) request.reject(new Error('Overlap delivery reloaded'))
    pending.clear()
  })
