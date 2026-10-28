import { PMTiles } from 'pmtiles'
import { OverlapComputer } from './compute.ts'
import { OverlapBudgetError } from './geometry.ts'
import type { OverlapRequest, OverlapResponse } from './types.ts'

let latestRequestId = 0
let archiveUrl = ''
let archive: PMTiles
let computer = new OverlapComputer()

self.onmessage = async ({ data: request }: MessageEvent<OverlapRequest>) => {
  latestRequestId = request.requestId
  const started = performance.now()
  const isCurrent = () => latestRequestId === request.requestId
  try {
    if (archiveUrl !== request.archiveUrl) {
      archiveUrl = request.archiveUrl
      archive = new PMTiles(archiveUrl)
      computer = new OverlapComputer()
    }
    const collection = await computer.compute(archive, request, isCurrent)
    if (!collection || !isCurrent()) return
    const response: OverlapResponse = {
      requestId: request.requestId,
      collection,
      durationMs: Math.round(performance.now() - started),
      tileCount: request.tiles.length,
    }
    self.postMessage(response)
  } catch (error) {
    if (!isCurrent()) return
    if (import.meta.env.DEV) console.warn('Overlap calculation failed', error)
    const response: OverlapResponse = {
      requestId: request.requestId,
      error:
        error instanceof OverlapBudgetError
          ? error.message
          : 'Overlap stripes are unavailable in this view. Try zooming in or selecting fewer languages.',
    }
    self.postMessage(response)
  }
}
