import type { DeliveryTile } from '../overlap/delivery.ts'
import { CANCELLATION_GRACE_MS, REQUEST_TIMEOUT_MS } from './limits.ts'
import type { GeometryInput, GeometryJob, GeometryOutput, GeometryResult } from './serviceTypes.ts'

export interface GeometryWorker {
  postMessage(input: GeometryInput): void
  terminate(): void
  onmessage: ((event: MessageEvent<GeometryOutput>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
}
interface Pending {
  readonly job: GeometryJob
  readonly receive: (result: GeometryResult) => void
  readonly fail: (error: Error) => void
  readonly cleanup: () => void
}

/** Shared ownership, cancellation and restart for every geometry consumer.
 * A blocked native call restarts the worker and replays only still-useful work,
 * preserving original deadlines and the committed snapshot registrations.
 */
export class GeometryService {
  private readonly createWorker: () => GeometryWorker
  private worker: GeometryWorker | undefined
  private nextId = 0
  private readonly pending = new Map<number, Pending>()
  private readonly cancellations = new Map<number, ReturnType<typeof setTimeout>>()
  private readonly snapshots = new Map<number, readonly DeliveryTile[]>()
  private readonly tileIds = new WeakMap<DeliveryTile, number>()
  private readonly sent = new Set<number>()
  private nextTileId = 0
  restarts = 0

  constructor(createWorker: () => GeometryWorker) {
    this.createWorker = createWorker
  }

  private start() {
    if (this.worker) return this.worker
    const worker = this.createWorker()
    this.worker = worker
    this.sent.clear()
    for (const [register, tiles] of this.snapshots) this.postRegistration(register, tiles)
    worker.onmessage = ({ data }) => {
      if (this.worker !== worker) return
      clearTimeout(this.cancellations.get(data.id))
      this.cancellations.delete(data.id)
      if ('cancelled' in data) return
      const request = this.pending.get(data.id)
      if (!request) return
      if ('error' in data || data.complete) {
        this.pending.delete(data.id)
        request.cleanup()
      }
      if ('error' in data) {
        request.fail(new Error(data.error))
        if (data.initialization) this.restart()
      } else request.receive(data.result)
    }
    worker.onerror = () => {
      if (this.worker !== worker) return
      // A loading failure must surface once, rather than retrying indefinitely.
      this.dispose(new Error('Could not load map geometry. Try again.'))
    }
    return worker
  }

  private restart() {
    this.worker?.terminate()
    this.worker = undefined
    this.restarts++
    for (const timer of this.cancellations.values()) clearTimeout(timer)
    this.cancellations.clear()
    if (!this.pending.size) return
    try {
      const worker = this.start()
      for (const [id, request] of this.pending) worker.postMessage({ id, job: request.job })
    } catch {
      this.dispose(new Error('Could not restart map geometry. Try again.'))
    }
  }

  submit(
    job: GeometryJob,
    signal: AbortSignal,
    receive: Pending['receive'],
    fail: Pending['fail'],
  ) {
    signal.throwIfAborted()
    const id = ++this.nextId
    const worker = this.start()
    const cancel = () => {
      const request = this.pending.get(id)
      if (!request) return
      this.pending.delete(id)
      request.cleanup()
      this.cancellations.set(
        id,
        setTimeout(() => this.restart(), CANCELLATION_GRACE_MS),
      )
      this.worker?.postMessage({ cancel: id })
      request.fail(new DOMException('Geometry request aborted', 'AbortError'))
    }
    const deadline = setTimeout(() => {
      const request = this.pending.get(id)
      if (!request) return
      this.pending.delete(id)
      request.cleanup()
      request.fail(
        new Error('Map geometry exceeded its time budget. Zoom in or select fewer languages.'),
      )
      this.restart()
    }, REQUEST_TIMEOUT_MS)
    this.pending.set(id, {
      job,
      receive,
      fail,
      cleanup: () => {
        clearTimeout(deadline)
        signal.removeEventListener('abort', cancel)
      },
    })
    signal.addEventListener('abort', cancel, { once: true })
    try {
      worker.postMessage({ id, job })
    } catch (error) {
      this.pending.get(id)?.cleanup()
      this.pending.delete(id)
      fail(error instanceof Error ? error : new Error(String(error)))
    }
  }

  request(
    job: Exclude<GeometryJob, { kind: 'coverage' }>,
    signal: AbortSignal,
  ): Promise<GeometryResult> {
    return new Promise((resolve, reject) => this.submit(job, signal, resolve, reject))
  }

  register(register: number, tiles: readonly DeliveryTile[]) {
    this.snapshots.set(register, tiles)
    if (this.worker) this.postRegistration(register, tiles)
  }
  private postRegistration(register: number, tiles: readonly DeliveryTile[]) {
    const additions: [number, DeliveryTile][] = []
    const ids = tiles.map((tile) => {
      let id = this.tileIds.get(tile)
      if (id === undefined) {
        id = ++this.nextTileId
        this.tileIds.set(tile, id)
      }
      if (!this.sent.has(id)) {
        this.sent.add(id)
        additions.push([id, tile])
      }
      return id
    })
    this.worker?.postMessage({ register, ids, additions })
  }
  release(release: number) {
    this.snapshots.delete(release)
    this.worker?.postMessage({ release })
    const used = new Set(
      [...this.snapshots.values()].flatMap((tiles) => tiles.map((tile) => this.tileIds.get(tile))),
    )
    for (const id of this.sent) if (!used.has(id)) this.sent.delete(id)
  }
  dispose(error = new Error('Map geometry stopped.')) {
    this.worker?.terminate()
    this.worker = undefined
    for (const timer of this.cancellations.values()) clearTimeout(timer)
    this.cancellations.clear()
    for (const request of this.pending.values()) {
      request.cleanup()
      request.fail(error)
    }
    this.pending.clear()
  }
}
