import { stripeImage } from './patterns.ts'

export interface StripeTextureTask {
  readonly id: string
  readonly colors: readonly string[]
  readonly repeats: number
}
export interface StripeTexture extends ReturnType<typeof stripeImage> {
  readonly id: string
  readonly repeats: number
}
export type StripeTextureInput =
  | {
      readonly type: 'render'
      readonly revision: number
      readonly tasks: readonly StripeTextureTask[]
    }
  | { readonly type: 'cancel'; readonly revision: number }
export type StripeTextureOutput =
  | { readonly type: 'started'; readonly revision: number }
  | { readonly type: 'complete'; readonly revision: number; readonly images: StripeTexture[] }
  | {
      readonly type: 'cancelled'
      readonly revision: number
      readonly generated: number
      readonly total: number
    }
  | { readonly type: 'error'; readonly revision: number; readonly message: string }

/** One active job and one replaceable pending job. Yield to worker message tasks
 * after at most 64 images / four milliseconds so cancellation stops work.
 */
export const createStripeTextureJobs = (
  send: (output: StripeTextureOutput) => void,
  yieldTask: () => Promise<void> = () => new Promise((resolve) => setTimeout(resolve, 0)),
) => {
  let latest = 0
  let pending: Extract<StripeTextureInput, { type: 'render' }> | undefined
  let running = false
  const run = async () => {
    running = true
    while (pending) {
      const job = pending
      pending = undefined
      const images: StripeTexture[] = []
      send({ type: 'started', revision: job.revision })
      let batchStarted = performance.now()
      try {
        for (const task of job.tasks) {
          if (job.revision !== latest) break
          images.push({
            id: task.id,
            repeats: task.repeats,
            ...stripeImage(task.colors, 2, task.repeats),
          })
          if (images.length % 64 === 0 || performance.now() - batchStarted >= 4) {
            // A macrotask yield lets incoming cancel/render messages run.
            await yieldTask()
            batchStarted = performance.now()
          }
        }
        if (job.revision === latest) send({ type: 'complete', revision: job.revision, images })
        else
          send({
            type: 'cancelled',
            revision: job.revision,
            generated: images.length,
            total: job.tasks.length,
          })
      } catch (error) {
        if (job.revision === latest)
          send({ type: 'error', revision: job.revision, message: String(error) })
      }
    }
    running = false
  }
  return (input: StripeTextureInput) => {
    if (input.revision < latest) return
    latest = input.revision
    pending = input.type === 'render' ? input : undefined
    if (!running && pending) void run()
  }
}
