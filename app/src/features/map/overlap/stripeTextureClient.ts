import type {
  StripeTexture,
  StripeTextureInput,
  StripeTextureOutput,
  StripeTextureTask,
} from './stripeTextureJobs.ts'

export interface StripeTextureWorker {
  postMessage(input: StripeTextureInput): void
  terminate(): void
  onmessage: ((event: MessageEvent<StripeTextureOutput>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
}

/** Coalesce input, cooperatively cancel generation, and interrupt queued uploads.
 * Full results are ready before any existing texture is replaced. Uploads yield
 * too, so new input can stop an obsolete result between small main-thread batches.
 */
export class StripeTextureClient {
  private readonly createWorker: () => StripeTextureWorker
  private readonly apply: (image: StripeTexture) => void
  private readonly onError: (message: string) => void
  private worker: StripeTextureWorker | undefined
  private revision = 0
  private prepare: ReturnType<typeof setTimeout> | undefined
  private upload: ReturnType<typeof setTimeout> | undefined
  private build: (() => StripeTextureTask[]) | undefined
  private disposed = false
  private pending = false
  private completed = 0
  private cancelled = 0
  private applied = 0
  private generatedBeforeCancellation = 0
  private generating: number | undefined
  private lastCancelled: { revision: number; generated: number; total: number } | undefined

  constructor(
    createWorker: () => StripeTextureWorker,
    apply: (image: StripeTexture) => void,
    onError: (message: string) => void,
  ) {
    this.createWorker = createWorker
    this.apply = apply
    this.onError = onError
  }

  state() {
    return {
      revision: this.revision,
      pending: this.pending,
      completed: this.completed,
      cancelled: this.cancelled,
      applied: this.applied,
      generatedBeforeCancellation: this.generatedBeforeCancellation,
      generating: this.generating === this.revision,
      lastCancelled: this.lastCancelled,
    }
  }

  cancel() {
    this.revision++
    clearTimeout(this.prepare)
    clearTimeout(this.upload)
    this.prepare = undefined
    this.upload = undefined
    this.build = undefined
    this.pending = false
    this.generating = undefined
    this.worker?.postMessage({ type: 'cancel', revision: this.revision })
  }

  request(build: () => StripeTextureTask[]) {
    if (this.disposed) return
    this.cancel()
    this.build = build
    this.pending = true
    const revision = this.revision
    this.prepare = setTimeout(() => {
      this.prepare = undefined
      try {
        const tasks = this.build?.() ?? []
        this.build = undefined
        if (!tasks.length) {
          this.pending = false
          return
        }
        if (!this.worker) {
          const worker = this.createWorker()
          worker.onmessage = ({ data }) => {
            if (worker !== this.worker || this.disposed) return
            if (data.type === 'cancelled') {
              this.cancelled++
              this.generatedBeforeCancellation += data.generated
              this.lastCancelled = {
                revision: data.revision,
                generated: data.generated,
                total: data.total,
              }
              return
            }
            if (data.revision !== this.revision) return
            if (data.type === 'started') this.generating = data.revision
            else {
              this.generating = undefined
              if (data.type === 'error') this.fail(data.message)
              else this.applyImages(data.revision, data.images)
            }
          }
          worker.onerror = (event) => {
            if (worker === this.worker && !this.disposed)
              this.fail(event.message || 'Stripe texture worker failed')
          }
          this.worker = worker
        }
        this.worker.postMessage({ type: 'render', revision, tasks })
      } catch (error) {
        this.fail(String(error))
      }
    }, 0)
  }

  private fail(message: string) {
    this.cancel()
    this.worker?.terminate()
    this.worker = undefined
    this.onError(message)
  }

  private applyImages(revision: number, images: StripeTexture[]) {
    let index = 0
    const batch = () => {
      this.upload = undefined
      if (this.disposed || revision !== this.revision) return
      const started = performance.now()
      let count = 0
      try {
        while (index < images.length && count < 64 && performance.now() - started < 4) {
          const image = images[index++]
          if (image) this.apply(image)
          this.applied++
          count++
        }
      } catch (error) {
        this.fail(String(error))
        return
      }
      if (index < images.length) this.upload = setTimeout(batch, 0)
      else {
        this.pending = false
        this.completed++
      }
    }
    this.upload = setTimeout(batch, 0)
  }

  dispose() {
    this.cancel()
    this.disposed = true
    this.worker?.terminate()
    this.worker = undefined
  }
}
