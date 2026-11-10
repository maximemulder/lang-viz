import { OverlapComputer } from '../overlap/compute.ts'
import { type DeliveryTile, encodeCoverageTile, tileKey } from '../overlap/delivery.ts'
import { DeliveryStore } from '../overlap/deliveryStore.ts'
import { createFallbackMetrics } from '../overlap/fallbackCache.ts'
import { OverlapBudgetError, OverlapInitializationError } from '../overlap/geometry.ts'
import type { OverlapMetrics } from '../overlap/types.ts'
import { fallbackGeometry } from './fallbackGeometry.ts'
import type { GeometryInput, GeometryOutput, GeometryResult } from './serviceTypes.ts'
import { GeometryTileStore } from './tileStore.ts'

const sources = new GeometryTileStore()
const computer = new OverlapComputer(false, sources.fetch)
const fallbackMetrics = createFallbackMetrics()
const delivery = new DeliveryStore()
const controllers = new Map<number, AbortController>()
const encoded = new WeakMap<object, DeliveryTile>()

self.onmessage = async ({ data }: MessageEvent<GeometryInput>) => {
  if ('register' in data) {
    delivery.register(data.register, data.ids, data.additions)
    return
  }
  if ('release' in data) {
    delivery.release(data.release)
    return
  }
  if ('cancel' in data) {
    controllers.get(data.cancel)?.abort()
    self.postMessage({ id: data.cancel, cancelled: true } satisfies GeometryOutput)
    return
  }
  const { id, job } = data
  const controller = new AbortController()
  controllers.set(id, controller)
  const signal = controller.signal
  const respond = (result: GeometryResult, complete = true) => {
    signal.throwIfAborted()
    self.postMessage({ id, result, complete } satisfies GeometryOutput)
  }
  const started = performance.now()
  let metrics: OverlapMetrics | undefined
  try {
    if (job.kind === 'source') {
      const bytes = job.fallback
        ? await fallbackGeometry(
            sources,
            job.archiveUrl,
            job.tile,
            job.coverage,
            job.fallback,
            signal,
            fallbackMetrics,
          )
        : await sources.read(job.archiveUrl, job.tile, signal)
      respond({ kind: 'source', data: bytes, metrics: { ...fallbackMetrics, ...sources.stats() } })
    } else if (job.kind === 'delivery') {
      respond({
        kind: 'delivery',
        data: delivery.get(job.snapshot, job.tile),
        metrics: delivery.stats(),
      })
    } else {
      const request = job.request
      metrics = request.profile
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
      const known = new Set(request.knownTiles)
      for await (const tile of computer.computeTiles(
        sources.archive(request.archiveUrl),
        {
          ...request,
          tiles: request.tiles.filter((tile) => !known.has(tileKey(tile))),
        },
        () => !signal.aborted,
        metrics,
        signal,
      )) {
        signal.throwIfAborted()
        let result = encoded.get(tile.features)
        if (!result) {
          const before = performance.now()
          result = encodeCoverageTile(tile)
          if (metrics) metrics.outputMs += performance.now() - before
          encoded.set(tile.features, result)
        }
        respond(
          {
            kind: 'coverage',
            response: {
              requestId: request.requestId,
              tile: result,
              durationMs: performance.now() - started,
            },
          },
          false,
        )
      }
      if (metrics) metrics.cache = computer.stats()
      respond({
        kind: 'coverage',
        response: {
          requestId: request.requestId,
          complete: true,
          durationMs: performance.now() - started,
          tileCount: request.tiles.length,
          ...(metrics ? { metrics } : {}),
        },
      })
    }
  } catch (error) {
    if (signal.aborted) return
    if (job.kind === 'coverage' && !(error instanceof OverlapInitializationError)) {
      if (metrics) metrics.cache = computer.stats()
      respond({
        kind: 'coverage',
        response: {
          requestId: job.request.requestId,
          durationMs: performance.now() - started,
          failure: error instanceof OverlapBudgetError ? error.reason : 'geometry-error',
          error: error instanceof Error ? error.message : String(error),
          ...(metrics ? { metrics } : {}),
        },
      })
    } else
      self.postMessage({
        id,
        error: error instanceof Error ? error.message : String(error),
        ...(error instanceof OverlapInitializationError ? { initialization: true } : {}),
      } satisfies GeometryOutput)
  } finally {
    controllers.delete(id)
  }
}
