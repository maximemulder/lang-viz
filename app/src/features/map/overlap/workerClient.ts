import type { OverlapRequest, OverlapResponse } from './types.ts'

export const CANCELLATION_GRACE_MS = 150
export const REQUEST_TIMEOUT_MS = 8_000
export const PUBLICATION_TIMEOUT_MS = 12_000

export type WorkerInput = OverlapRequest | { cancel: number }
export type WorkerOutput =
  | OverlapResponse
  | { requestId: number; cancelled: true }
  | { requestId: number; started: true }

interface WorkerHandle {
  postMessage(request: WorkerInput): void
  terminate(): void
  onmessage: ((event: MessageEvent<WorkerOutput>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
}

/** Keep caches when cooperative cancellation works; terminate blocked WASM jobs.
 * Timers run on the UI thread, independent of a synchronous geometry operation.
 */
export class OverlapWorkerClient {
  onmessage: ((event: MessageEvent<OverlapResponse>) => void) | null = null
  onerror: (() => void) | null = null
  restarts = 0
  private worker: WorkerHandle | undefined
  private request: OverlapRequest | undefined
  private busyId: number | undefined
  private startedAt = 0
  private cancellation: ReturnType<typeof setTimeout> | undefined
  private deadline: ReturnType<typeof setTimeout> | undefined
  private readonly createWorker: () => WorkerHandle

  constructor(createWorker: () => WorkerHandle) {
    this.createWorker = createWorker
  }

  private clearCancellation() {
    clearTimeout(this.cancellation)
    this.cancellation = undefined
  }

  private startWorker() {
    const worker = this.createWorker()
    this.worker = worker
    worker.onmessage = (event) => {
      if (worker !== this.worker) return
      const response = event.data
      if ('cancelled' in response) {
        if (response.requestId === this.busyId) {
          this.busyId = undefined
          this.clearCancellation()
        }
        return
      }
      if (response.requestId !== this.request?.requestId) return
      this.clearCancellation()
      this.busyId = response.requestId
      if ('started' in response) return
      if (!('tile' in response)) {
        this.busyId = undefined
        this.request = undefined
        clearTimeout(this.deadline)
      }
      this.onmessage?.({ data: response } as MessageEvent<OverlapResponse>)
    }
    worker.onerror = () => {
      if (worker !== this.worker) return
      this.terminate()
      this.onerror?.()
    }
    return worker
  }

  private abandonBlockedWorker() {
    clearTimeout(this.cancellation)
    this.cancellation = setTimeout(() => {
      this.cancellation = undefined
      this.worker?.terminate()
      this.worker = undefined
      this.busyId = undefined
      this.restarts++
      if (this.request) {
        this.busyId = this.request.requestId
        this.startWorker().postMessage(this.request)
      }
    }, CANCELLATION_GRACE_MS)
  }

  postMessage(request: OverlapRequest) {
    if (this.busyId !== undefined && this.cancellation === undefined) this.abandonBlockedWorker()
    this.request = request
    this.startedAt = performance.now()
    clearTimeout(this.deadline)
    this.deadline = setTimeout(() => {
      if (this.request?.requestId !== request.requestId) return
      const durationMs = performance.now() - this.startedAt
      this.terminate()
      this.restarts++
      this.onmessage?.({
        data: {
          requestId: request.requestId,
          failure: 'request-deadline',
          durationMs,
          error: 'Overlap calculation exceeded its time budget. Zoom in or select fewer languages.',
        },
      } as MessageEvent<OverlapResponse>)
    }, REQUEST_TIMEOUT_MS)
    const worker = this.worker ?? this.startWorker()
    this.busyId = request.requestId
    worker.postMessage(request)
  }

  cancel() {
    const id = this.busyId
    this.request = undefined
    clearTimeout(this.deadline)
    if (id === undefined) return
    this.worker?.postMessage({ cancel: id })
    if (this.cancellation === undefined) this.abandonBlockedWorker()
  }

  terminate() {
    this.clearCancellation()
    clearTimeout(this.deadline)
    this.worker?.terminate()
    this.worker = undefined
    this.request = undefined
    this.busyId = undefined
  }
}
