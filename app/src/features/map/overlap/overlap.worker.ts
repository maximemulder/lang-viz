import { PMTiles } from 'pmtiles'
import { OverlapComputer } from './compute.ts'
import { type DeliveryTile, encodeCoverageTile, tileKey } from './delivery.ts'
import { OverlapBudgetError } from './geometry.ts'
import type { OverlapMetrics, OverlapResponse } from './types.ts'
import type { WorkerInput, WorkerOutput } from './workerClient.ts'

let latestRequestId = 0
let archiveUrl = ''
let archive: PMTiles
let computer = new OverlapComputer()
const encoded = new WeakMap<object, DeliveryTile>()
let controller: AbortController | undefined

self.onmessage = async ({ data: request }: MessageEvent<WorkerInput>) => {
  if ('cancel' in request) {
    if (latestRequestId === request.cancel) {
      latestRequestId = 0
      controller?.abort()
    }
    self.postMessage({ requestId: request.cancel, cancelled: true } satisfies WorkerOutput)
    return
  }
  controller?.abort()
  controller = new AbortController()
  const signal = controller.signal
  latestRequestId = request.requestId
  self.postMessage({ requestId: request.requestId, started: true } satisfies WorkerOutput)
  const started = performance.now()
  const isCurrent = () => latestRequestId === request.requestId
  const metrics: OverlapMetrics | undefined = request.profile
    ? {
        fetchMs: 0,
        decodeMs: 0,
        initializeMs: 0,
        partitionMs: 0,
        outputMs: 0,
        decodedCacheHits: 0,
        partitionCacheHits: 0,
        inputVertices: 0,
        outputVertices: 0,
        completedTiles: 0,
      }
    : undefined
  try {
    if (archiveUrl !== request.archiveUrl) {
      archiveUrl = request.archiveUrl
      archive = new PMTiles(archiveUrl)
      computer = new OverlapComputer()
    }
    const known = new Set(request.knownTiles)
    const missing = request.tiles.filter((tile) => !known.has(tileKey(tile)))
    for await (const tile of computer.computeTiles(
      archive,
      { ...request, tiles: missing },
      isCurrent,
      metrics,
      signal,
    )) {
      if (!isCurrent()) return
      let delivery = encoded.get(tile.features)
      if (!delivery) {
        const outputStart = performance.now()
        delivery = encodeCoverageTile(tile)
        if (metrics) metrics.outputMs += performance.now() - outputStart
        encoded.set(tile.features, delivery)
      }
      const response: OverlapResponse = {
        requestId: request.requestId,
        tile: delivery,
        durationMs: performance.now() - started,
      }
      self.postMessage(response)
    }
    if (!isCurrent()) return
    if (metrics) metrics.cache = computer.stats()
    const response: OverlapResponse = {
      requestId: request.requestId,
      complete: true,
      durationMs: Math.round(performance.now() - started),
      tileCount: request.tiles.length,
      ...(metrics ? { metrics } : {}),
    }
    self.postMessage(response)
  } catch (error) {
    if (!isCurrent()) return
    if (metrics) metrics.cache = computer.stats()
    if (import.meta.env.DEV) console.warn('Overlap calculation failed', error)
    const response: OverlapResponse = {
      requestId: request.requestId,
      failure: error instanceof OverlapBudgetError ? error.reason : 'geometry-error',
      durationMs: performance.now() - started,
      ...(metrics ? { metrics } : {}),
      error:
        error instanceof OverlapBudgetError
          ? error.message
          : 'Overlap stripes are unavailable in this view. Try zooming in or selecting fewer languages.',
    }
    self.postMessage(response)
  }
}
