import { PMTiles } from 'pmtiles'
import { FallbackCache } from './fallbackCache.ts'
import type { FallbackInput, FallbackOutput } from './fallbackWorkerClient.ts'
import { OverlapInitializationError } from './geometry.ts'

let archiveUrl = ''
let archive: PMTiles
const controllers = new Map<number, AbortController>()
const cache = new FallbackCache()

self.onmessage = async ({ data }: MessageEvent<FallbackInput>) => {
  if ('cancel' in data) {
    controllers.get(data.cancel)?.abort()
    self.postMessage({ id: data.cancel, cancelled: true } satisfies FallbackOutput)
    return
  }
  const controller = new AbortController()
  controllers.set(data.id, controller)
  try {
    if (archiveUrl !== data.archiveUrl) {
      archiveUrl = data.archiveUrl
      archive = new PMTiles(archiveUrl)
    }
    const result = await cache.get(
      archive,
      data.archiveUrl,
      data.tile,
      data.coverage,
      controller.signal,
    )
    controller.signal.throwIfAborted()
    self.postMessage({ id: data.id, data: result, metrics: cache.stats() } satisfies FallbackOutput)
  } catch (error) {
    if (!controller.signal.aborted)
      self.postMessage({
        id: data.id,
        error: error instanceof Error ? error.message : String(error),
        ...(error instanceof OverlapInitializationError
          ? { failure: 'initialization-error' as const }
          : {}),
      } satisfies FallbackOutput)
  } finally {
    controllers.delete(data.id)
  }
}
