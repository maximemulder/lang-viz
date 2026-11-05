import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  type FallbackInput,
  type FallbackOutput,
  FallbackWorkerClient,
} from '../src/features/map/overlap/fallbackWorkerClient.ts'
import { lazyResource } from '../src/features/map/overlap/lazyResource.ts'
import {
  CANCELLATION_GRACE_MS,
  REQUEST_TIMEOUT_MS,
} from '../src/features/map/overlap/workerClient.ts'

test('failed initialization is shared, then retried; successful resources remain shared', async () => {
  let attempts = 0
  const resource = {}
  const load = lazyResource(async () => {
    if (++attempts === 1) throw new Error('Initialization unavailable')
    return resource
  })
  const first = load()
  assert.equal(load(), first)
  await assert.rejects(first, /Initialization unavailable/)
  const retry = load()
  assert.equal(load(), retry)
  assert.equal(await retry, resource)
  assert.equal(await load(), resource)
  assert.equal(attempts, 2)
})

class FakeWorker {
  onmessage: ((event: MessageEvent<FallbackOutput>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly messages: FallbackInput[] = []
  terminated = false
  postMessage(message: FallbackInput) {
    this.messages.push(message)
  }
  terminate() {
    this.terminated = true
  }
  send(data: FallbackOutput) {
    this.onmessage?.({ data } as MessageEvent<FallbackOutput>)
  }
}

const input = { archiveUrl: 'archive', coverage: [], tile: { z: 0, x: 0, y: 0 } }
const fixture = () => {
  const workers: FakeWorker[] = []
  const client = new FallbackWorkerClient(() => {
    const worker = new FakeWorker()
    workers.push(worker)
    return worker
  })
  return { client, workers }
}

test('fallback cancellation rejects immediately and acknowledgement preserves concurrent work and caches', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const { client, workers } = fixture()
  context.after(() => client.terminate())
  const abort = new AbortController()
  const first = client.request(input, abort.signal)
  const rejected = assert.rejects(first, { name: 'AbortError' })
  const second = client.request(input, new AbortController().signal)
  abort.abort()
  assert.deepEqual(workers[0]?.messages.at(-1), { cancel: 1 })
  workers[0]?.send({ id: 1, cancelled: true })
  context.mock.timers.tick(CANCELLATION_GRACE_MS)
  assert.equal(workers[0]?.terminated, false)
  workers[0]?.send({ id: 2, data: new Uint8Array([42]) })
  assert.deepEqual(await second, new Uint8Array([42]))
  await rejected
  context.mock.timers.tick(REQUEST_TIMEOUT_MS)
  assert.equal(workers[0]?.terminated, false, 'settled requests remove their watchdogs')
  await assert.rejects(client.request(input, AbortSignal.abort()), { name: 'AbortError' })
  assert.equal(workers[0]?.messages.length, 3, 'already-aborted requests never reach the worker')
})

test('blocked fallback cancellation restarts only live requests without exposing map errors', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const { client, workers } = fixture()
  context.after(() => client.terminate())
  const abort = new AbortController()
  const first = assert.rejects(client.request(input, abort.signal), { name: 'AbortError' })
  const second = client.request(input, new AbortController().signal)
  abort.abort()
  context.mock.timers.tick(CANCELLATION_GRACE_MS)
  assert.equal(workers[0]?.terminated, true)
  await first
  assert.deepEqual(workers[1]?.messages, [{ ...input, id: 2 }], 'aborted work is never replayed')
  workers[0]?.send({ id: 2, data: new Uint8Array([0]) })
  workers[1]?.send({ id: 2, data: new Uint8Array([42]) })
  assert.deepEqual(await second, new Uint8Array([42]))
  const retry = client.request(input, new AbortController().signal)
  workers[0]?.send({ id: 3, data: new Uint8Array([0]) })
  workers[1]?.send({ id: 3, data: new Uint8Array([7]) })
  assert.deepEqual(await retry, new Uint8Array([7]), 'obsolete workers cannot settle a retry')
})

test('fallback cancellation restarts preserve the original deadlines of live requests', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const { client, workers } = fixture()
  context.after(() => client.terminate())
  const timeout = assert.rejects(client.request(input, new AbortController().signal), /too long/)
  context.mock.timers.tick(REQUEST_TIMEOUT_MS - CANCELLATION_GRACE_MS - 1)
  const abort = new AbortController()
  const cancelled = assert.rejects(client.request(input, abort.signal), { name: 'AbortError' })
  abort.abort()
  context.mock.timers.tick(CANCELLATION_GRACE_MS)
  assert.equal(workers[0]?.terminated, true)
  assert.equal(workers[1]?.terminated, false)
  context.mock.timers.tick(1)
  assert.equal(workers[1]?.terminated, true, 'replaying cannot extend the request budget')
  await Promise.all([timeout, cancelled])
})

test('fallback deadlines and worker errors reject all pending requests and allow a fresh worker', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const { client, workers } = fixture()
  context.after(() => client.terminate())
  const timeout = assert.rejects(client.request(input, new AbortController().signal), /too long/)
  context.mock.timers.tick(REQUEST_TIMEOUT_MS)
  assert.equal(workers[0]?.terminated, true)
  await timeout
  const failed = assert.rejects(
    client.request(input, new AbortController().signal),
    /Could not load/,
  )
  workers[1]?.onerror?.({} as ErrorEvent)
  await failed
  const retry = client.request(input, new AbortController().signal)
  workers[2]?.send({ id: 3, data: new Uint8Array([9]) })
  assert.deepEqual(await retry, new Uint8Array([9]))
})

test('fallback initialization failures discard the module registry before Retry', async (context) => {
  const { client, workers } = fixture()
  context.after(() => client.terminate())
  const failed = assert.rejects(
    client.request(input, new AbortController().signal),
    /initialization failed/,
  )
  const concurrent = assert.rejects(
    client.request(input, new AbortController().signal),
    /initialization failed/,
  )
  workers[0]?.send({
    id: 1,
    error: 'Module initialization failed',
    failure: 'initialization-error',
  })
  assert.equal(workers[0]?.terminated, true)
  await Promise.all([failed, concurrent])
  const retry = client.request(input, new AbortController().signal)
  workers[1]?.send({ id: 3, data: new Uint8Array([1]) })
  assert.deepEqual(await retry, new Uint8Array([1]))
})
