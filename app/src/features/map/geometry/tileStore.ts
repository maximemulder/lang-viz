import type { PMTiles } from 'pmtiles'
import { openGeometryArchive } from '../../../data/geometryArchives.ts'
import { ByteCache } from '../overlap/byteCache.ts'
import type { TileCoordinate } from '../overlap/types.ts'

/** One archive/tile read shared by composition, source rendering and previews.
 * Cancelling a consumer releases its interest; other consumers keep their read.
 */
export class GeometryTileStore {
  private readonly open: (url: string) => Pick<PMTiles, 'getZxy'>
  constructor(open: (url: string) => Pick<PMTiles, 'getZxy'> = openGeometryArchive) {
    this.open = open
  }
  private readonly bytes = new ByteCache(96, 32 * 1024 * 1024)
  private hits = 0
  stats() {
    return { rawBytes: this.bytes.bytes, rawEntries: this.bytes.size, rawCacheHits: this.hits }
  }
  private readonly pending = new Map<
    string,
    {
      controller: AbortController
      promise: Promise<Uint8Array>
      users: number
    }
  >()

  archive(url: string) {
    return {
      getZxy: async (z: number, x: number, y: number, signal?: AbortSignal) => {
        const data = await this.read(url, { z, x, y }, signal)
        return data.length ? { data: data.buffer as ArrayBuffer } : undefined
      },
    }
  }

  async read(url: string, tile: TileCoordinate, signal?: AbortSignal): Promise<Uint8Array> {
    return this.load(
      JSON.stringify([url, tile.z, tile.x, tile.y]),
      async (signal) => {
        const reader = openGeometryArchive(url, (source) =>
          source === url ? this.open(source) : this.archive(source),
        )
        const result = await reader.getZxy(tile.z, tile.x, tile.y, signal)
        return result ? new Uint8Array(result.data) : new Uint8Array()
      },
      signal,
    )
  }

  readonly fetch = async (url: string, options?: { signal?: AbortSignal }): Promise<Response> => {
    const bytes = await this.load(
      url,
      async (signal) => {
        const response = await fetch(url, { signal })
        if (!response.ok) throw new Error(`Geometry HTTP ${response.status}`)
        return new Uint8Array(await response.arrayBuffer())
      },
      options?.signal,
    )
    return new Response(bytes.slice().buffer)
  }

  private async load(
    key: string,
    load: (signal: AbortSignal) => Promise<Uint8Array>,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    signal?.throwIfAborted()
    const cached = this.bytes.get(key)
    if (cached) {
      this.hits++
      return cached
    }
    let entry = this.pending.get(key)
    if (!entry) {
      const controller = new AbortController()
      const promise = load(controller.signal).then((bytes) => {
        controller.signal.throwIfAborted()
        this.bytes.set(key, bytes)
        return bytes
      })
      entry = { controller, promise, users: 0 }
      this.pending.set(key, entry)
      const current = entry
      void promise
        .finally(() => {
          if (this.pending.get(key) === current) this.pending.delete(key)
        })
        .catch(() => {})
    }
    const current = entry
    current.users++
    return new Promise((resolve, reject) => {
      let finished = false
      const finish = () => {
        if (finished) return false
        finished = true
        signal?.removeEventListener('abort', abort)
        if (--current.users === 0 && this.pending.get(key) === current) {
          this.pending.delete(key)
          current.controller.abort()
        }
        return true
      }
      const abort = () => {
        if (finish()) reject(new DOMException('Geometry request aborted', 'AbortError'))
      }
      signal?.addEventListener('abort', abort, { once: true })
      current.promise.then(
        (value) => {
          if (finish()) resolve(value)
        },
        (error) => {
          if (finish()) reject(error)
        },
      )
    })
  }
}
