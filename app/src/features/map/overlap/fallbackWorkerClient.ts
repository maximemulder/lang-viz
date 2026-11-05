import type { FallbackMetrics } from './fallbackCache.ts'
import type { TileCoordinate } from './types.ts'
import { CANCELLATION_GRACE_MS, REQUEST_TIMEOUT_MS } from './workerClient.ts'

export interface FallbackRequest {
  readonly id: number
  readonly archiveUrl: string
  readonly tile: TileCoordinate
  readonly coverage: readonly TileCoordinate[]
}

export type FallbackInput = FallbackRequest | { cancel: number }
export type FallbackOutput =
  | { id: number; cancelled: true }
  | {
      id: number
      data?: Uint8Array
      error?: string
      failure?: 'initialization-error'
      metrics?: FallbackMetrics
    }

interface WorkerHandle {
  postMessage(request: FallbackInput): void
  terminate(): void
  onmessage: ((event: MessageEvent<FallbackOutput>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
}

interface PendingRequest {
  readonly input: FallbackRequest
  resolve(data: Uint8Array): void
  reject(error: Error): void
  cleanup(): void
}

/** Supervise concurrent tile requests from the UI thread, including blocked WASM calls. */
export class FallbackWorkerClient {
  private worker: WorkerHandle | undefined
  private nextId = 0
  private readonly pending = new Map<number, PendingRequest>()
  private readonly cancellations = new Map<number, ReturnType<typeof setTimeout>>()
  private readonly createWorker: () => WorkerHandle
  private readonly onMetrics: ((metrics: FallbackMetrics) => void) | undefined

  constructor(createWorker: () => WorkerHandle, onMetrics?: (metrics: FallbackMetrics) => void) {
    this.createWorker = createWorker
    this.onMetrics = onMetrics
  }

  private startWorker() {
    if (this.worker) return this.worker
    const worker = this.createWorker()
    this.worker = worker
    worker.onmessage = ({ data }) => {
      if (worker !== this.worker) return
      // A completed response also proves that an aborted job has unwound.
      clearTimeout(this.cancellations.get(data.id))
      this.cancellations.delete(data.id)
      if ('cancelled' in data) return
      if (data.metrics) this.onMetrics?.(data.metrics)
      if (data.failure === 'initialization-error') {
        this.terminate(
          new Error(data.error ?? 'Could not initialize fallback geometry. Try again.'),
        )
        return
      }
      const request = this.pending.get(data.id)
      this.pending.delete(data.id)
      request?.cleanup()
      if (data.error) request?.reject(new Error(data.error))
      else request?.resolve(data.data ?? new Uint8Array())
    }
    worker.onerror = () => {
      if (worker === this.worker)
        this.terminate(new Error('Could not load fallback language colors.'))
    }
    return worker
  }

  private restartCancelledWorker() {
    this.worker?.terminate()
    this.worker = undefined
    for (const timer of this.cancellations.values()) clearTimeout(timer)
    this.cancellations.clear()
    if (!this.pending.size) return
    try {
      const worker = this.startWorker()
      // Aborted tiles are gone from pending. Replay useful work without resetting
      // its deadlines or exposing an unrelated tile's cancellation as a map error.
      for (const request of this.pending.values()) worker.postMessage(request.input)
    } catch {
      this.terminate(new Error('Could not restart fallback clipping. Try again.'))
    }
  }

  async request(input: Omit<FallbackRequest, 'id'>, signal: AbortSignal): Promise<Uint8Array> {
    signal.throwIfAborted()
    const worker = this.startWorker()
    const id = ++this.nextId
    return new Promise<Uint8Array>((resolve, reject) => {
      const abort = () => {
        const request = this.pending.get(id)
        if (!request) return
        this.pending.delete(id)
        request.cleanup()
        reject(new DOMException('Tile request aborted', 'AbortError'))
        // Keep caches if the worker responds; restart it if native work prevents acknowledgement.
        this.cancellations.set(
          id,
          setTimeout(() => this.restartCancelledWorker(), CANCELLATION_GRACE_MS),
        )
        try {
          worker.postMessage({ cancel: id })
        } catch {
          this.terminate(new Error('Could not cancel fallback clipping. Try again.'))
        }
      }
      const deadline = setTimeout(() => {
        this.terminate(new Error('Fallback language colors took too long to load. Try again.'))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, {
        input: { ...input, id },
        resolve,
        reject,
        cleanup: () => {
          clearTimeout(deadline)
          signal.removeEventListener('abort', abort)
        },
      })
      signal.addEventListener('abort', abort, { once: true })
      try {
        worker.postMessage({ ...input, id })
      } catch {
        this.terminate(new Error('Could not request fallback language colors. Try again.'))
      }
    })
  }

  terminate(error = new Error('Fallback tile service stopped.')) {
    this.worker?.terminate()
    this.worker = undefined
    for (const timer of this.cancellations.values()) clearTimeout(timer)
    this.cancellations.clear()
    const requests = [...this.pending.values()]
    this.pending.clear()
    for (const request of requests) {
      request.cleanup()
      request.reject(error)
    }
  }
}
