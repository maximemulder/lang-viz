import { PMTiles } from 'pmtiles'
import { clipFallbackTile } from './fallback.ts'
import { coverageRectangles } from './tiles.ts'
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
    // Whole covered tiles need neither a fetch nor geometry initialization.
    const rects = coverageRectangles(data.tile, data.coverage, 1)
    const covered = rects.some(([l, t, r, b]) => l === 0 && t === 0 && r === 1 && b === 1)
    const response = covered
      ? undefined
      : await archive.getZxy(data.tile.z, data.tile.x, data.tile.y, controller.signal)
    controller.signal.throwIfAborted()
    const result = await clipFallbackTile(
      response ? new Uint8Array(response.data) : new Uint8Array(),
      data.tile,
      data.coverage,
    )
    controller.signal.throwIfAborted()
    self.postMessage({ id: data.id, data: result })
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
