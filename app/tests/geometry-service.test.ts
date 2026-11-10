import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fromVectorTileJs, GeoJSONWrapper } from '@maplibre/vt-pbf'
import { geometryArchiveUrl } from '../src/data/geometryArchives.ts'
import { GeometryCoverageClient } from '../src/features/map/geometry/geometryService.ts'
import { CANCELLATION_GRACE_MS, REQUEST_TIMEOUT_MS } from '../src/features/map/geometry/limits.ts'
import { GeometryService, type GeometryWorker } from '../src/features/map/geometry/serviceClient.ts'
import type { GeometryInput, GeometryOutput } from '../src/features/map/geometry/serviceTypes.ts'
import { GeometryTileStore } from '../src/features/map/geometry/tileStore.ts'

const required = <T>(value: T | null | undefined): T => {
  assert.ok(value !== null && value !== undefined)
  return value
}

const coord = { z: 2, x: 1, y: 1 }
const emptyTile = fromVectorTileJs({
  layers: { areas: new GeoJSONWrapper([], { extent: 8192, version: 2 }) },
})
test('source rendering and previews share in-flight profile reads; cancelling one preserves the other', async () => {
  let reads = 0
  let release: (() => void) | undefined
  let readSignal: AbortSignal | undefined
  const store = new GeometryTileStore(() => ({
    getZxy: async (_z, _x, _y, signal) => {
      reads++
      readSignal = signal
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return { data: emptyTile.slice().buffer }
    },
  }))
  const a = new AbortController(),
    b = new AbortController()
  const url = geometryArchiveUrl('https://atlas.test/areas.pmtiles', ['profile.pmtiles'])
  const first = store.read(url, coord, a.signal)
  const second = store.read('https://atlas.test/profile.pmtiles', coord, b.signal)
  assert.equal(reads, 1)
  a.abort()
  await assert.rejects(first, { name: 'AbortError' })
  assert.equal(readSignal?.aborted, false)
  release?.()
  assert.deepEqual(await second, emptyTile)
  assert.deepEqual(await store.read(url, coord), emptyTile)
  assert.equal(reads, 1)
})

class Worker implements GeometryWorker {
  onmessage: GeometryWorker['onmessage'] = null
  onerror: GeometryWorker['onerror'] = null
  readonly requests: GeometryInput[] = []
  stopped = false
  postMessage(input: GeometryInput) {
    this.requests.push(input)
  }
  terminate() {
    this.stopped = true
  }
  send(data: GeometryOutput) {
    this.onmessage?.({ data } as MessageEvent<GeometryOutput>)
  }
}
test('a blocked cancelled preview restarts shared work, replays useful requests, and ignores stale replies', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const workers: Worker[] = []
  const service = new GeometryService(() => {
    const worker = new Worker()
    workers.push(worker)
    return worker
  })
  context.after(() => service.dispose())
  const a = new AbortController(),
    b = new AbortController()
  const first = service.request(
    { kind: 'source', archiveUrl: 'a', tile: coord, coverage: [] },
    a.signal,
  )
  const second = service.request({ kind: 'delivery', snapshot: 1, tile: coord }, b.signal)
  service.register(1, [])
  a.abort()
  await assert.rejects(first, { name: 'AbortError' })
  context.mock.timers.tick(151)
  assert.equal(workers.length, 2)
  assert.ok(required(workers[0]).stopped)
  assert.equal(required(workers[1]).requests.filter((r) => 'job' in r).length, 1)
  assert.ok(required(workers[1]).requests.some((r) => 'register' in r && r.register === 1))
  const result = {
    kind: 'delivery' as const,
    data: new Uint8Array([4]),
    metrics: {
      parentRequests: 1,
      parentCacheHits: 0,
      assemblyMs: 0,
      nativeBytes: 0,
      parentBytes: 0,
      parentEntries: 0,
      snapshots: 1,
      tiles: 0,
    },
  }
  required(workers[0]).send({
    id: 2,
    result: { ...result, data: new Uint8Array([9]) },
    complete: true,
  })
  required(workers[1]).send({ id: 2, result, complete: true })
  assert.deepEqual(await second, result)
  assert.equal(service.restarts, 1)
})

const deliveryResult = (value: number) => ({
  kind: 'delivery' as const,
  data: new Uint8Array([value]),
  metrics: {
    parentRequests: 1,
    parentCacheHits: 0,
    assemblyMs: 0,
    nativeBytes: 0,
    parentBytes: 0,
    parentEntries: 0,
    snapshots: 1,
    tiles: 0,
  },
})
const fixture = () => {
  const workers: Worker[] = []
  const service = new GeometryService(() => {
    const w = new Worker()
    workers.push(w)
    return w
  })
  const request = (signal = new AbortController().signal) =>
    service.request({ kind: 'delivery', snapshot: 1, tile: coord }, signal)
  return { workers, service, request }
}
test('cooperative cancellation preserves the shared worker and cache; settled and already-aborted requests leave no watchdog', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const f = fixture()
  context.after(() => f.service.dispose())
  const abort = new AbortController()
  const first = assert.rejects(f.request(abort.signal), { name: 'AbortError' })
  const second = f.request()
  abort.abort()
  required(f.workers[0]).send({ id: 1, cancelled: true })
  context.mock.timers.tick(CANCELLATION_GRACE_MS)
  assert.equal(f.workers.length, 1)
  assert.equal(required(f.workers[0]).stopped, false)
  required(f.workers[0]).send({ id: 2, result: deliveryResult(2), complete: true })
  assert.deepEqual(await second, deliveryResult(2))
  await first
  context.mock.timers.tick(REQUEST_TIMEOUT_MS)
  assert.equal(required(f.workers[0]).stopped, false)
  const count = required(f.workers[0]).requests.length
  await assert.rejects(f.request(AbortSignal.abort()), { name: 'AbortError' })
  assert.equal(required(f.workers[0]).requests.length, count)
})
test('replayed consumers keep original deadlines and can retry after a timeout or worker error', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const f = fixture()
  context.after(() => f.service.dispose())
  const expired = assert.rejects(f.request(), /time budget/)
  context.mock.timers.tick(REQUEST_TIMEOUT_MS - CANCELLATION_GRACE_MS - 1)
  const abort = new AbortController(),
    cancelled = assert.rejects(f.request(abort.signal), { name: 'AbortError' })
  abort.abort()
  context.mock.timers.tick(CANCELLATION_GRACE_MS)
  assert.equal(required(f.workers[1]).stopped, false)
  context.mock.timers.tick(1)
  assert.equal(required(f.workers[1]).stopped, true)
  await Promise.all([expired, cancelled])
  const failed = assert.rejects(f.request(), /Could not load/)
  required(f.workers[2]).onerror?.({} as ErrorEvent)
  await failed
  const retry = f.request()
  required(f.workers[3]).send({ id: 4, result: deliveryResult(4), complete: true })
  assert.deepEqual(await retry, deliveryResult(4))
})
test('initialization failure replaces the module registry and replays unrelated consumers', async (context) => {
  const f = fixture()
  context.after(() => f.service.dispose())
  const failed = assert.rejects(f.request(), /initialize/)
  const concurrent = f.request()
  required(f.workers[0]).send({
    id: 1,
    error: 'Could not initialize geometry',
    initialization: true,
  })
  await failed
  assert.equal(required(f.workers[0]).stopped, true)
  assert.equal(required(f.workers[1]).requests.filter((r) => 'job' in r).length, 1)
  required(f.workers[1]).send({ id: 2, result: deliveryResult(2), complete: true })
  assert.deepEqual(await concurrent, deliveryResult(2))
})
test('selection supersession cancels only that coverage consumer and cannot publish an obsolete result', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const f = fixture()
  context.after(() => f.service.dispose())
  const client = new GeometryCoverageClient(f.service)
  const responses: number[] = []
  client.onmessage = ({ data }) => responses.push(data.requestId)
  const request = (requestId: number) => ({
    requestId,
    archiveUrl: 'archive',
    sourceLayer: 'areas',
    variantIds: ['a'],
    tiles: [coord],
  })
  client.postMessage(request(10))
  client.postMessage(request(20))
  client.postMessage(request(30))
  context.mock.timers.tick(CANCELLATION_GRACE_MS)
  const replay = required(f.workers[1]).requests.filter((r) => 'job' in r)
  assert.equal(replay.length, 1)
  const result = {
    kind: 'coverage' as const,
    response: { requestId: 30, complete: true as const, tileCount: 1, durationMs: 1 },
  }
  required(f.workers[0]).send({ id: 3, result, complete: true })
  assert.deepEqual(responses, [])
  required(f.workers[1]).send({ id: 3, result, complete: true })
  assert.deepEqual(responses, [30])
  client.terminate()
})
