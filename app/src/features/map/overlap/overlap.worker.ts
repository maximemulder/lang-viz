import { PMTiles } from 'pmtiles'
import { OverlapComputer } from './compute.ts'
import { OverlapBudgetError } from './geometry.ts'
import type { OverlapMetrics, OverlapRequest, OverlapResponse } from './types.ts'

let latestRequestId = 0
let archiveUrl = ''
let archive: PMTiles
let computer = new OverlapComputer()

self.onmessage = async ({ data: request }: MessageEvent<OverlapRequest>) => {
  latestRequestId = request.requestId
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
    const collection = await computer.compute(archive, request, isCurrent, metrics)
    if (!collection || !isCurrent()) return
    const response: OverlapResponse = {
      requestId: request.requestId,
      collection,
      durationMs: Math.round(performance.now() - started),
      tileCount: request.tiles.length,
      ...(metrics ? { metrics } : {}),
    }
    self.postMessage(response)
  } catch (error) {
    if (!isCurrent()) return
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
