import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ByteCache } from '../src/features/map/overlap/byteCache.ts'
import { type DeliveryTile, encodeCoverageTile } from '../src/features/map/overlap/delivery.ts'
import { DeliveryStore } from '../src/features/map/overlap/deliveryStore.ts'
import { FallbackCache, fallbackMaskKey } from '../src/features/map/overlap/fallbackCache.ts'
import type { OverlapRequest, OverlapResponse } from '../src/features/map/overlap/types.ts'
import {
  CANCELLATION_GRACE_MS,
  OverlapWorkerClient,
  REQUEST_TIMEOUT_MS,
  type WorkerInput,
  type WorkerOutput,
} from '../src/features/map/overlap/workerClient.ts'

test('byte cache evicts least recently used entries and bounds empty and oversized payloads', () => {
  const cache = new ByteCache(2, 5)
  cache.set('a', new Uint8Array(2))
  cache.set('b', new Uint8Array(2))
  assert.ok(cache.get('a'))
  cache.set('c', new Uint8Array(2))
  assert.equal(cache.get('b'), undefined)
  assert.ok(cache.get('a'))
  cache.set('c', new Uint8Array(9))
  assert.equal(cache.get('c'), undefined)
  assert.equal(cache.bytes, 2)
  for (let i = 0; i < 100; i++) cache.set(String(i), new Uint8Array())
  assert.equal(cache.size, 2)
  assert.equal(cache.bytes, 0)
})

const nativeTile = (x: number, color: string): DeliveryTile =>
  encodeCoverageTile({
    tile: { z: 2, x, y: 0 },
    extent: 16,
    features: [
      {
        type: 'Feature',
        properties: { pattern: color, variantIds: [color] },
        geometry: {
          type: 'MultiPolygon',
          coordinates: [
            [
              [
                [0, 0],
                [16, 0],
                [16, 16],
                [0, 16],
                [0, 0],
              ],
            ],
          ],
        },
      },
    ],
    vertices: 5,
  })

test('parent delivery caches local descendants, invalidates changed geometry, and releases snapshot references', () => {
  const store = new DeliveryStore()
  const a = nativeTile(0, 'a')
  const b = nativeTile(3, 'b')
  const replacement = nativeTile(0, 'new-selection')
  const target = { z: 1, x: 0, y: 0 }
  store.register(1, [1], [[1, a]])
  const first = store.get(1, target)
  assert.ok(first.byteLength)
  store.register(2, [2, 1], [[2, b]])
  assert.equal(store.get(2, target), first, 'unrelated additions should reuse parent bytes')
  assert.equal(store.stats().parentCacheHits, 1)
  store.register(3, [3], [[3, replacement]])
  assert.notDeepEqual(store.get(3, target), first)
  store.release(1)
  store.release(2)
  assert.equal(store.stats().tiles, 1)
  store.release(3)
  assert.equal(store.stats().tiles, 0)
  assert.equal(store.stats().nativeBytes, 0)
  assert.equal(store.stats().snapshots, 0)
  assert.ok(store.stats().parentBytes <= 8 * 1024 * 1024)
})

test('fallback cache keys ignore unrelated coverage, reuse raw data for changed local masks, and isolate archives', async () => {
  const cache = new FallbackCache()
  let fetches = 0
  const archive = {
    getZxy: async () => {
      fetches++
      return undefined
    },
  }
  const tile = { z: 1, x: 0, y: 0 }
  const local = { z: 2, x: 0, y: 0 }
  const outside = { z: 2, x: 3, y: 3 }
  const signal = new AbortController().signal
  assert.equal(fallbackMaskKey(tile, [local, outside]), fallbackMaskKey(tile, [local]))
  const first = await cache.get(archive, 'a', tile, [local], signal)
  assert.equal(await cache.get(archive, 'a', tile, [outside, local], signal), first)
  assert.equal(fetches, 1)
  assert.equal(cache.stats().cacheHits, 1)
  await cache.get(archive, 'a', tile, [{ z: 2, x: 1, y: 1 }], signal)
  assert.equal(fetches, 1)
  assert.equal(cache.stats().rawCacheHits, 1)
  await cache.get(archive, 'b', tile, [local], signal)
  assert.equal(fetches, 2)
  await cache.get(archive, 'a', tile, [tile], signal)
  assert.equal(fetches, 2, 'wholly covered tiles need no archive read')
  await assert.rejects(cache.get(archive, 'a', tile, [], AbortSignal.abort()), {
    name: 'AbortError',
  })
})

class FakeWorker {
  onmessage: ((event: MessageEvent<WorkerOutput>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  messages: WorkerInput[] = []
  terminated = false
  postMessage(message: WorkerInput) {
    this.messages.push(message)
  }
  terminate() {
    this.terminated = true
  }
  send(data: WorkerOutput) {
    this.onmessage?.({ data } as MessageEvent<WorkerOutput>)
  }
}
const request = (requestId: number): OverlapRequest => ({
  requestId,
  archiveUrl: 'archive',
  sourceLayer: 'language_areas',
  variantIds: ['a', 'b'],
  tiles: [{ z: 0, x: 0, y: 0 }],
})
const finished = (requestId: number): OverlapResponse => ({
  requestId,
  complete: true,
  tileCount: 1,
  durationMs: 1,
})

test('cooperative cancellation preserves the worker and remains armed for later supersession', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const worker = new FakeWorker()
  const client = new OverlapWorkerClient(() => worker)
  const responses: OverlapResponse[] = []
  client.onmessage = ({ data }) => responses.push(data)
  client.postMessage(request(1))
  client.cancel()
  assert.deepEqual(worker.messages.at(-1), { cancel: 1 })
  worker.send({ requestId: 1, cancelled: true })
  context.mock.timers.tick(CANCELLATION_GRACE_MS)
  assert.equal(worker.terminated, false)
  client.postMessage(request(2))
  worker.send({ requestId: 2, started: true })
  context.mock.timers.tick(CANCELLATION_GRACE_MS)
  assert.equal(worker.terminated, false)
  worker.send(finished(1))
  assert.equal(responses.length, 0)
  worker.send(finished(2))
  context.mock.timers.tick(REQUEST_TIMEOUT_MS)
  assert.equal(worker.terminated, false)
  client.postMessage(request(3))
  client.cancel()
  context.mock.timers.tick(CANCELLATION_GRACE_MS)
  assert.equal(worker.terminated, true)
  assert.equal(client.restarts, 1)
  client.terminate()
})

test('blocked superseded work is terminated within the grace period; only the latest request restarts', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const workers: FakeWorker[] = []
  const client = new OverlapWorkerClient(() => {
    const worker = new FakeWorker()
    workers.push(worker)
    return worker
  })
  const responses: OverlapResponse[] = []
  client.onmessage = ({ data }) => responses.push(data)
  client.postMessage(request(1))
  client.postMessage(request(2))
  context.mock.timers.tick(CANCELLATION_GRACE_MS - 1)
  client.postMessage(request(3))
  context.mock.timers.tick(1)
  assert.equal(workers[0]?.terminated, true)
  assert.deepEqual(workers[1]?.messages, [request(3)])
  workers[0]?.send(finished(3))
  assert.equal(responses.length, 0)
  workers[1]?.send(finished(3))
  assert.equal(responses.length, 1)
  client.terminate()
})

test('request deadline terminates a stuck worker, reports an explicit error, and allows recovery', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const workers: FakeWorker[] = []
  const client = new OverlapWorkerClient(() => {
    const worker = new FakeWorker()
    workers.push(worker)
    return worker
  })
  const responses: OverlapResponse[] = []
  client.onmessage = ({ data }) => responses.push(data)
  client.postMessage(request(1))
  context.mock.timers.tick(REQUEST_TIMEOUT_MS)
  assert.equal(workers[0]?.terminated, true)
  assert.equal(responses.length, 1)
  assert.equal(
    'failure' in (responses[0] ?? {}) && (responses[0] as { failure: string }).failure,
    'request-deadline',
  )
  client.postMessage(request(2))
  workers[1]?.send(finished(2))
  assert.equal(responses.length, 2)
  client.terminate()
})
