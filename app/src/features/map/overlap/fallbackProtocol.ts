import { addProtocol } from 'maplibre-gl'
import { diagnosticsEnabled } from './diagnostics.ts'
import type { FallbackRequest } from './fallback.worker.ts'
import type { FallbackMetrics } from './fallbackCache.ts'
import { serviceDiagnostics } from './serviceDiagnostics.ts'
import type { TileCoordinate } from './types.ts'

export const fallbackTilesUrl = (archiveUrl: string, coverage: readonly TileCoordinate[]) =>
  `language-fallback://${encodeURIComponent(archiveUrl.replace(/^pmtiles:\/\//, ''))}/${encodeURIComponent(JSON.stringify(coverage))}/{z}/{x}/{y}`

let worker: Worker | undefined
let nextId = 0
const pending = new Map<
  number,
  { resolve: (data: Uint8Array) => void; reject: (error: Error) => void }
>()

addProtocol('language-fallback', async ({ url }, controller) => {
  if (!worker) {
    worker = new Worker(new URL('./fallback.worker.ts', import.meta.url), { type: 'module' })
    const currentWorker = worker
    worker.onmessage = ({
      data,
    }: MessageEvent<{
      id: number
      data: Uint8Array
      error?: string
      metrics?: FallbackMetrics
    }>) => {
      if (worker !== currentWorker) return
      if (diagnosticsEnabled && data.metrics) serviceDiagnostics.fallback = data.metrics
      const request = pending.get(data.id)
      pending.delete(data.id)
      if (data.error) request?.reject(new Error(data.error))
      else request?.resolve(data.data)
    }
    worker.onerror = () => {
      if (worker !== currentWorker) return
      for (const request of pending.values())
        request.reject(new Error('Could not load fallback language colors.'))
      pending.clear()
      worker?.terminate()
      worker = undefined
    }
  }
  const [archive, coverage, z, x, y] = url.slice('language-fallback://'.length).split('/')
  if (!archive || !coverage) throw new Error('Invalid fallback tile URL')
  const id = ++nextId
  const currentWorker = worker
  const request: FallbackRequest = {
    id,
    archiveUrl: decodeURIComponent(archive),
    coverage: JSON.parse(decodeURIComponent(coverage)),
    tile: { z: Number(z), x: Number(x), y: Number(y) },
  }
  const abort = () => {
    pending.get(id)?.reject(new DOMException('Tile request aborted', 'AbortError'))
    pending.delete(id)
    worker?.postMessage({ cancel: id })
  }
  controller.signal.throwIfAborted()
  controller.signal.addEventListener('abort', abort, { once: true })
  try {
    const data = await new Promise<Uint8Array>((resolve, reject) => {
      pending.set(id, { resolve, reject })
      currentWorker.postMessage(request)
    })
    return { data }
  } finally {
    controller.signal.removeEventListener('abort', abort)
  }
})

if (import.meta.hot)
  import.meta.hot.dispose(() => {
    worker?.terminate()
    for (const request of pending.values()) request.reject(new Error('Fallback worker reloaded'))
    pending.clear()
  })
