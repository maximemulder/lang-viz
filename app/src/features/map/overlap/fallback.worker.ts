import { PMTiles } from 'pmtiles'
import { FallbackCache } from './fallbackCache.ts'
import type { TileCoordinate } from './types.ts'

export interface FallbackRequest {
  readonly id: number
  readonly archiveUrl: string
  readonly tile: TileCoordinate
  readonly coverage: readonly TileCoordinate[]
}

let archiveUrl = ''
let archive: PMTiles
const controllers = new Map<number, AbortController>()
const cache = new FallbackCache()

self.onmessage = async ({ data }: MessageEvent<FallbackRequest | { cancel: number }>) => {
  if ('cancel' in data) {
    controllers.get(data.cancel)?.abort()
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
    self.postMessage({ id: data.id, data: result, metrics: cache.stats() })
  } catch (error) {
    if (!controller.signal.aborted)
      self.postMessage({
        id: data.id,
        error: error instanceof Error ? error.message : String(error),
      })
  } finally {
    controllers.delete(data.id)
  }
}
