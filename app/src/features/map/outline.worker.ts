import { openGeometryArchive } from '../../data/geometryArchives.ts'
import { dissolveOutlineTile } from './outlineGeometry.ts'
import { outlineGroupsKey } from './outlineSelection.ts'
import { ByteCache } from './overlap/byteCache.ts'
import { FallbackCache } from './overlap/fallbackCache.ts'
import type { FallbackInput, FallbackOutput } from './overlap/fallbackWorkerClient.ts'
import { OverlapInitializationError } from './overlap/geometry.ts'

// Isolated from selected coverage/fallback work, including cancellation of a slow union.
const raw = new FallbackCache()
const results = new ByteCache(128, 16 * 1024 * 1024)
const controllers = new Map<number, AbortController>()
self.onmessage = async ({ data }: MessageEvent<FallbackInput>) => {
  if ('cancel' in data) {
    controllers.get(data.cancel)?.abort()
    self.postMessage({ id: data.cancel, cancelled: true } satisfies FallbackOutput)
    return
  }
  const controller = new AbortController()
  controllers.set(data.id, controller)
  try {
    if (!data.outline) throw new Error('Missing outline selection')
    const { sourceLayer, groups } = data.outline
    const { z, x, y } = data.tile
    const key = JSON.stringify([data.archiveUrl, z, x, y, sourceLayer, outlineGroupsKey(groups)])
    let result = results.get(key)
    if (!result) {
      const bytes = await raw.get(
        openGeometryArchive(data.archiveUrl),
        data.archiveUrl,
        data.tile,
        [],
        controller.signal,
      )
      result = await dissolveOutlineTile(bytes, sourceLayer, groups, controller.signal)
      controller.signal.throwIfAborted()
      results.set(key, result)
    }
    controller.signal.throwIfAborted()
    self.postMessage({ id: data.id, data: result } satisfies FallbackOutput)
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
