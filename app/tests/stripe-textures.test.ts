import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  StripeTextureClient,
  type StripeTextureWorker,
} from '../src/features/map/overlap/stripeTextureClient.ts'
import {
  createStripeTextureJobs,
  type StripeTexture,
  type StripeTextureInput,
  type StripeTextureOutput,
  type StripeTextureTask,
} from '../src/features/map/overlap/stripeTextureJobs.ts'

const task = (id: string): StripeTextureTask => ({ id, colors: ['#ff0000', '#0000ff'], repeats: 3 })
const image = (id: string): StripeTexture => ({
  id,
  repeats: 3,
  width: 1,
  height: 1,
  data: new Uint8Array(4),
})
const until = async (ready: () => boolean) => {
  for (let count = 0; count < 200; count++) {
    if (ready()) return
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  assert.fail('Texture job did not settle')
}

test('texture generation stops obsolete work at the next batch and skips replaced pending jobs', async () => {
  const outputs: StripeTextureOutput[] = []
  let resume: (() => void) | undefined
  const receive = createStripeTextureJobs(
    (output) => outputs.push(output),
    () =>
      new Promise<void>((resolve) => {
        resume = resolve
      }),
  )
  receive({
    type: 'render',
    revision: 1,
    tasks: Array.from({ length: 1000 }, (_, index) => task(`old-${index}`)),
  })
  assert.ok(resume, 'The running job must yield before completing all images')
  receive({ type: 'cancel', revision: 2 })
  receive({ type: 'render', revision: 2, tasks: [task('skipped')] })
  receive({ type: 'cancel', revision: 3 })
  receive({ type: 'render', revision: 3, tasks: [task('latest')] })
  resume()
  await until(() => outputs.some((output) => output.type === 'complete'))
  const cancelled = outputs.find((output) => output.type === 'cancelled')
  assert.ok(cancelled?.type === 'cancelled' && cancelled.generated > 0 && cancelled.generated <= 64)
  const completed = outputs.filter((output) => output.type === 'complete')
  assert.deepEqual(
    completed.map((output) => output.revision),
    [3],
  )
  assert.deepEqual(
    completed[0]?.images.map((result) => result.id),
    ['latest'],
  )
})

test('a cancellation without a replacement stops generation and publishes no partial textures', async () => {
  const outputs: StripeTextureOutput[] = []
  let resume: (() => void) | undefined
  const receive = createStripeTextureJobs(
    (output) => outputs.push(output),
    () =>
      new Promise<void>((resolve) => {
        resume = resolve
      }),
  )
  receive({ type: 'render', revision: 1, tasks: Array.from({ length: 1000 }, () => task('old')) })
  receive({ type: 'cancel', revision: 2 })
  assert.ok(resume)
  resume()
  await until(() => outputs.some((output) => output.type === 'cancelled'))
  assert.ok(outputs.every((output) => output.type !== 'complete'))
})

test('the client coalesces input, rejects stale results and interrupts superseded upload batches', async () => {
  const sent: StripeTextureInput[] = []
  const applied: string[] = []
  let terminated = false
  const worker: StripeTextureWorker = {
    postMessage: (input) => {
      sent.push(input)
    },
    terminate: () => {
      terminated = true
    },
    onmessage: null,
    onerror: null,
  }
  const errors: string[] = []
  const client = new StripeTextureClient(
    () => worker,
    (result) => {
      applied.push(result.id)
      if (applied.length === 1) queueMicrotask(() => client.request(() => [task('latest')]))
    },
    (message) => errors.push(message),
  )
  try {
    let skippedBuilds = 0
    client.request(() => {
      skippedBuilds++
      return [task('skipped')]
    })
    client.request(() => [task('old')])
    await until(() => sent.some((input) => input.type === 'render'))
    assert.equal(skippedBuilds, 0)
    const old = sent.find((input) => input.type === 'render')
    assert.ok(old)
    worker.onmessage?.({
      data: {
        type: 'complete',
        revision: old.revision,
        images: Array.from({ length: 1000 }, () => image('old')),
      },
    } as MessageEvent<StripeTextureOutput>)
    await until(() => sent.filter((input) => input.type === 'render').length === 2)
    assert.ok(
      applied.length > 0 && applied.length <= 64,
      'Only the already executing upload batch can finish',
    )
    const count = applied.length
    worker.onmessage?.({
      data: { type: 'complete', revision: old.revision, images: [image('stale')] },
    } as MessageEvent<StripeTextureOutput>)
    assert.equal(applied.length, count)
    const latest = sent.filter((input) => input.type === 'render').at(-1)
    assert.ok(latest)
    worker.onmessage?.({
      data: { type: 'complete', revision: latest.revision, images: [image('latest')] },
    } as MessageEvent<StripeTextureOutput>)
    await until(() => !client.state().pending)
    assert.equal(applied.at(-1), 'latest')
    assert.equal(client.state().completed, 1)
    assert.deepEqual(errors, [])
  } finally {
    client.dispose()
  }
  assert.ok(terminated)
  const count = applied.length
  worker.onmessage?.({
    data: { type: 'complete', revision: client.state().revision, images: [image('disposed')] },
  } as MessageEvent<StripeTextureOutput>)
  assert.equal(applied.length, count)
  worker.onerror?.({ message: 'late error' } as ErrorEvent)
  assert.deepEqual(errors, [])
})
