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
  readonly owner: object | undefined
  readonly receive: (result: GeometryResult) => void
  readonly fail: (error: Error) => void
  readonly cleanup: () => void
}

// Keep delivery and source reads moving even when both coverage slots are busy.
const MAX_DISPATCHED = { coverage: 2, delivery: 2, source: 6 } as const

/** Shared ownership, cancellation and restart for every geometry consumer.
 * A blocked native call restarts the worker and replays only still-useful work,
 * preserving original deadlines and the committed snapshot registrations.
 */
export class GeometryService {
  private readonly createWorker: () => GeometryWorker
  private worker: GeometryWorker | undefined
  private nextId = 0
  private readonly pending = new Map<number, Pending>()
  private readonly dispatched = new Map<
    number,
    { kind: GeometryJob['kind']; owner: object | undefined }
  >()
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
      const terminal = 'cancelled' in data || 'error' in data || data.complete
      if (terminal) {
        clearTimeout(this.cancellations.get(data.id))
        this.cancellations.delete(data.id)
        this.dispatched.delete(data.id)
      }
      const request = this.pending.get(data.id)
      if (request && terminal) {
        this.pending.delete(data.id)
        request.cleanup()
      }
      if ('error' in data) {
        request?.fail(new Error(data.error))
        if (data.initialization) {
          this.restart()
          return
        }
      } else if (!('cancelled' in data)) request?.receive(data.result)
      if (terminal) this.dispatch()
    }
    worker.onerror = () => {
      if (this.worker !== worker) return
      // A loading failure must surface once, rather than retrying indefinitely.
      this.dispose(new Error('Could not load map geometry. Try again.'))
    }
    return worker
  }

  private stop() {
    this.worker?.terminate()
    this.worker = undefined
    for (const timer of this.cancellations.values()) clearTimeout(timer)
    this.cancellations.clear()
    this.dispatched.clear()
  }

  private restart() {
    this.stop()
    this.restarts++
    this.dispatch()
  }

  private dispatch() {
    for (const [id, { job, owner, cleanup, fail }] of this.pending) {
      if (this.dispatched.has(id)) continue
      let used = 0
      let ownerBusy = false
      for (const active of this.dispatched.values()) {
        if (active.kind === job.kind) used++
        if (owner && active.owner === owner) ownerBusy = true
      }
      if (ownerBusy || used >= MAX_DISPATCHED[job.kind]) continue
      let worker: GeometryWorker
      try {
        worker = this.start()
      } catch {
        this.dispose(new Error('Could not start map geometry. Try again.'))
        return
      }
      this.dispatched.set(id, { kind: job.kind, owner })
      try {
        worker.postMessage({ id, job })
      } catch (error) {
        this.dispatched.delete(id)
        this.pending.delete(id)
        cleanup()
        fail(error instanceof Error ? error : new Error(String(error)))
      }
    }
  }

  submit(
    job: GeometryJob,
    signal: AbortSignal,
    receive: Pending['receive'],
    fail: Pending['fail'],
    owner?: object,
  ) {
    signal.throwIfAborted()
    const id = ++this.nextId
    const cancel = () => {
      const request = this.pending.get(id)
      if (!request) return
      this.pending.delete(id)
      request.cleanup()
      if (this.dispatched.has(id)) {
        this.cancellations.set(
          id,
          setTimeout(() => this.restart(), CANCELLATION_GRACE_MS),
        )
        this.worker?.postMessage({ cancel: id })
      }
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
      if (this.dispatched.has(id)) this.restart()
    }, REQUEST_TIMEOUT_MS)
    this.pending.set(id, {
      job,
      owner,
      receive,
      fail,
      cleanup: () => {
        clearTimeout(deadline)
        signal.removeEventListener('abort', cancel)
      },
    })
    signal.addEventListener('abort', cancel, { once: true })
    this.dispatch()
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
    this.stop()
    const pending = [...this.pending.values()]
    this.pending.clear()
    for (const request of pending) {
      request.cleanup()
      request.fail(error)
    }
  }
}
