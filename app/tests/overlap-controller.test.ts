import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Map as MapLibreMap } from 'maplibre-gl'
import {
  type CoverageResources,
  createOverlapController,
  idleHatchingState,
} from '../src/features/map/overlap/controller.ts'
import type { DeliveryTile } from '../src/features/map/overlap/delivery.ts'
import type { OverlapRequest, TileCoordinate } from '../src/features/map/overlap/types.ts'
import { PUBLICATION_TIMEOUT_MS } from '../src/features/map/overlap/workerClient.ts'

const required = <T>(value: T | null | undefined): T => {
  assert.ok(value !== undefined && value !== null)
  return value
}

const coordinate = (x: number, z = 2): TileCoordinate => ({ z, x, y: 0 })
const tile = (x: number, features = 1): DeliveryTile => ({
  tile: coordinate(x),
  data: new Uint8Array(),
  features,
  vertices: features * 5,
  patterns: features ? [{ pattern: 'overlap:A|B', variantIds: ['A', 'B'] }] : [],
})
const fixture = () => {
  let state = idleHatchingState()
  let coverage: string | null = null
  const sent: OverlapRequest[] = []
  const registered = new Map<number, ReadonlyMap<string, DeliveryTile>>()
  let nextId = 0
  const readiness = { loaded: false }
  const resources: CoverageResources = {
    stage(tiles) {
      const id = ++nextId
      registered.set(id, new Map(tiles))
      return {
        pixels: 324,
        snapshot: {
          id,
          url: `snapshot:${id}`,
          coverageTiles: [...tiles.values()].map((t) => t.tile),
          maxzoom: tiles.values().next().value?.tile.z ?? 0,
        },
      }
    },
    isReady: () => readiness.loaded,
    release: (snapshot) => {
      registered.delete(snapshot.id)
    },
  }
  let cancellations = 0
  let terminated = false
  const controller = createOverlapController({
    worker: {
      postMessage: (request) => {
        sent.push(request)
      },
      cancel: () => {
        cancellations++
      },
      terminate: () => {
        terminated = true
      },
      restarts: 0,
    },
    resources,
    archiveUrl: 'archive',
    sourceLayer: 'areas',
    onChange: (next) => {
      state = next
    },
    onCoverageReady: (next) => {
      coverage = next
    },
  })
  controller.configure('["A","B"]', true)
  const receive = (result: DeliveryTile) =>
    controller.receive({ requestId: required(sent.at(-1)).requestId, tile: result, durationMs: 1 })
  const finish = () =>
    controller.receive({
      requestId: required(sent.at(-1)).requestId,
      complete: true,
      tileCount: 1,
      durationMs: 1,
    })
  const publish = () => {
    readiness.loaded = true
    controller.publish()
  }
  const initial = () => {
    controller.refresh([coordinate(0)])
    receive(tile(0))
    finish()
    publish()
  }
  return {
    controller,
    resources,
    sent,
    registered,
    readiness,
    receive,
    finish,
    publish,
    initial,
    get state() {
      return state
    },
    get coverage() {
      return coverage
    },
    get cancellations() {
      return cancellations
    },
    get terminated() {
      return terminated
    },
  }
}

test('grouped coverage is computed even with one source polygon and carries its ownership', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const f = fixture()
  context.after(() => f.controller.dispose())
  const key = JSON.stringify({ variantIds: ['A'], variantGroups: { A: ['descendants:family'] } })
  f.controller.configure(key, true)
  f.controller.refresh([coordinate(0)])
  assert.deepEqual(f.sent[0]?.variantIds, ['A'])
  assert.deepEqual(f.sent[0]?.variantGroups, { A: ['descendants:family'] })
  f.receive({
    ...tile(0),
    patterns: [{ pattern: 'overlap:descendants:family', variantIds: ['descendants:family'] }],
  })
  f.finish()
  f.publish()
  assert.equal(f.coverage, key)
  assert.equal(f.state.status, 'ready')
})

test('publication waits for the composite source, retains the old snapshot, and coalesces arrivals', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const f = fixture()
  context.after(() => f.controller.dispose())
  f.initial()
  const previous = f.state.snapshots[0]
  f.readiness.loaded = false
  f.controller.refresh([coordinate(1), coordinate(2)])
  assert.deepEqual(f.sent.at(-1)?.knownTiles, ['2/0/0'])
  f.receive(tile(1))
  context.mock.timers.tick(250)
  assert.equal(f.registered.size, 2)
  f.receive(tile(2))
  f.finish()
  assert.equal(f.registered.size, 2, 'arrivals do not replace a staging source')
  f.controller.publish()
  assert.equal(f.state.activeBuffer, 0)
  assert.equal(f.state.snapshots[0], previous)
  f.readiness.loaded = true
  f.controller.publish()
  assert.equal(f.state.status, 'loading', 'newer arrivals still need a second publication')
  context.mock.timers.tick(32)
  f.publish()
  assert.equal(f.state.status, 'ready')
  assert.equal(f.registered.size, 1)
  assert.equal([...f.registered.values()][0]?.size, 3)
  const count = f.sent.length
  f.controller.refresh([coordinate(0)])
  assert.equal(f.sent.length, count, 'returning inside retained coverage does not dispatch')
})

test('a failed staging source cannot publish even when loaded; retry reuses geometry', (context) => {
  const f = fixture()
  context.after(() => f.controller.dispose())
  f.initial()
  const active = f.state.snapshots[0]
  f.controller.refresh([coordinate(1)])
  f.receive(tile(1))
  f.finish()
  const failed = required(f.state.snapshots[1])
  f.controller.sourceFailed(failed.id)
  f.publish()
  assert.equal(f.state.status, 'error')
  assert.equal(f.state.snapshots[0], active)
  assert.equal(f.state.snapshots[1], null)
  assert.equal(f.coverage, '["A","B"]')
  assert.equal(f.registered.size, 1)
  f.controller.retry()
  f.controller.refresh([coordinate(1)])
  f.finish()
  f.publish()
  assert.equal(f.state.status, 'ready')
  assert.deepEqual(f.sent.at(-1)?.knownTiles.sort(), ['2/0/0', '2/1/0'])
  f.controller.sourceFailed(failed.id)
  assert.equal(f.state.status, 'ready', 'late errors from released snapshots are ignored')
})

test('failure in an active streaming source restores original fills and can recover', (context) => {
  const f = fixture()
  context.after(() => f.controller.dispose())
  f.initial()
  f.controller.sourceFailed(required(f.state.snapshots[0]).id)
  assert.equal(f.state.status, 'error')
  assert.equal(f.state.activeBuffer, null)
  assert.equal(f.coverage, null)
  assert.equal(f.registered.size, 0)
  f.controller.retry()
  f.controller.refresh([coordinate(0)])
  f.finish()
  f.publish()
  assert.equal(f.state.status, 'ready')
  assert.equal(f.coverage, '["A","B"]')
})

test('selection/mode changes and disposal invalidate late responses and release snapshots', () => {
  const f = fixture()
  f.initial()
  f.controller.refresh([coordinate(1)])
  f.receive(tile(1))
  f.finish()
  const obsoleteId = required(f.sent.at(-1)).requestId
  f.controller.configure('["C","D"]', true)
  assert.equal(f.registered.size, 0)
  assert.equal(f.coverage, null)
  f.controller.receive({ requestId: obsoleteId, tile: tile(1), durationMs: 1 })
  f.publish()
  assert.equal(f.state.status, 'idle')
  f.controller.refresh([coordinate(1)])
  assert.deepEqual(f.sent.at(-1)?.knownTiles, [])
  f.controller.configure('["C","D"]', false)
  f.controller.refresh([coordinate(1)])
  assert.equal(f.state.status, 'idle')
  f.controller.dispose()
  assert.ok(f.terminated)
  const count = f.sent.length
  f.controller.refresh([coordinate(0)])
  assert.equal(f.sent.length, count)
})

test('computation failure publishes valid prefixes including empty masks without claiming readiness', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const f = fixture()
  context.after(() => f.controller.dispose())
  f.controller.refresh([coordinate(0), coordinate(1)])
  f.receive(tile(0, 0))
  context.mock.timers.tick(250)
  assert.equal(f.registered.size, 0)
  f.controller.receive({
    requestId: required(f.sent.at(-1)).requestId,
    error: 'Too complex',
    failure: 'tile-deadline',
    durationMs: 1,
  })
  f.publish()
  assert.equal(f.state.status, 'error')
  assert.deepEqual(f.state.snapshots[0]?.coverageTiles, [coordinate(0)])
  assert.equal(f.coverage, '["A","B"]')
})

test('publication deadline discards unready staging and prevents late publication', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const f = fixture()
  context.after(() => f.controller.dispose())
  f.initial()
  const previous = f.state.snapshots[0]
  f.readiness.loaded = false
  f.controller.refresh([coordinate(1)])
  f.receive(tile(1))
  f.finish()
  context.mock.timers.tick(PUBLICATION_TIMEOUT_MS)
  f.publish()
  assert.equal(f.state.status, 'error')
  assert.equal(f.state.snapshots[0], previous)
  assert.equal(f.registered.size, 1)
})

test('a valid prefix after computation failure still has a source-loading deadline', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const f = fixture()
  context.after(() => f.controller.dispose())
  f.initial()
  const previous = f.state.snapshots[0]
  f.readiness.loaded = false
  f.controller.refresh([coordinate(1), coordinate(2)])
  f.receive(tile(1))
  f.controller.receive({
    requestId: required(f.sent.at(-1)).requestId,
    error: 'Too complex',
    failure: 'tile-deadline',
    durationMs: 1,
  })
  assert.equal(f.registered.size, 2, 'a completed prefix can stage after a later tile fails')
  context.mock.timers.tick(PUBLICATION_TIMEOUT_MS)
  f.publish()
  assert.equal(f.registered.size, 1, 'unready prefix staging must be released')
  assert.equal(f.state.snapshots[0], previous)
  assert.match(f.state.message, /too long to load/)
})

test('retained output budgets preserve good coverage and zoom changes reset known tiles', (context) => {
  const f = fixture()
  context.after(() => f.controller.dispose())
  f.initial()
  f.controller.refresh([coordinate(1)])
  f.receive({ ...tile(1), vertices: 200_000 })
  f.publish()
  assert.equal(f.state.status, 'error')
  assert.equal(f.registered.size, 1)
  f.controller.refresh([coordinate(0, 1)])
  assert.deepEqual(f.sent.at(-1)?.knownTiles, [])
})

test('zoom transitions retain all old stripes until the complete new detail is ready', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const f = fixture()
  context.after(() => f.controller.dispose())
  f.initial()
  const previous = f.state.snapshots[0]
  f.controller.refresh([coordinate(0, 3), coordinate(1, 3)])
  f.receive({ ...tile(0), tile: coordinate(0, 3) })
  context.mock.timers.tick(300)
  f.publish()
  assert.equal(f.registered.size, 1, 'a new-detail prefix must not replace old striped coverage')
  assert.equal(f.state.snapshots[0], previous)
  f.receive({ ...tile(1), tile: coordinate(1, 3) })
  f.readiness.loaded = false
  f.finish()
  f.controller.publish()
  assert.equal(
    f.state.snapshots[0],
    previous,
    'complete geometry still waits for its atomic source',
  )
  f.publish()
  assert.equal(f.state.status, 'ready')
  assert.equal(f.state.activeBuffer, 1)
  assert.equal(f.state.snapshots[1]?.coverageTiles.length, 2)
  assert.equal(f.registered.size, 1)
})

test('failed cross-zoom prefixes preserve old stripes and remain reusable on Retry or zoom reversal', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const f = fixture()
  context.after(() => f.controller.dispose())
  f.initial()
  const previous = f.state.snapshots[0]
  f.controller.refresh([coordinate(0, 3), coordinate(1, 3)])
  f.receive({ ...tile(0), tile: coordinate(0, 3) })
  f.controller.receive({
    requestId: required(f.sent.at(-1)).requestId,
    error: 'Too complex',
    failure: 'tile-deadline',
    durationMs: 1,
  })
  f.publish()
  assert.equal(f.registered.size, 1)
  assert.equal(f.state.snapshots[0], previous)
  context.mock.timers.tick(PUBLICATION_TIMEOUT_MS)
  assert.match(
    f.state.message,
    /Too complex/,
    'a deliberately withheld prefix has no loading deadline',
  )
  f.controller.retry()
  f.controller.refresh([coordinate(0, 3), coordinate(1, 3)])
  assert.deepEqual(f.sent.at(-1)?.knownTiles, ['3/0/0'])
  const obsolete = required(f.sent.at(-1)).requestId
  f.controller.refresh([coordinate(0)])
  assert.deepEqual(
    f.sent.at(-1)?.knownTiles,
    ['2/0/0'],
    'the still-visible native tile survives zoom reversal',
  )
  f.controller.receive({
    requestId: obsolete,
    tile: { ...tile(1), tile: coordinate(1, 3) },
    durationMs: 1,
  })
  f.finish()
  f.publish()
  assert.equal(f.state.status, 'ready')
  assert.deepEqual(f.state.snapshots[f.state.activeBuffer ?? 0]?.coverageTiles, [coordinate(0)])
  assert.equal(
    f.state.snapshots[0],
    previous,
    'returning to displayed tiles needs no source replacement',
  )
})

test('a completed zoom replacement still has a loading deadline after a worker failure', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const f = fixture()
  context.after(() => f.controller.dispose())
  f.initial()
  const previous = f.state.snapshots[0]
  f.readiness.loaded = false
  f.controller.refresh([coordinate(0, 3)])
  f.receive({ ...tile(0), tile: coordinate(0, 3) })
  f.finish()
  assert.equal(f.registered.size, 2)
  f.controller.workerFailed()
  context.mock.timers.tick(PUBLICATION_TIMEOUT_MS)
  assert.equal(f.registered.size, 1)
  assert.equal(f.state.snapshots[0], previous)
  assert.match(f.state.message, /too long to load/)
})

// The adapter imports browser protocol registration. Only location is needed
// to keep its explicit diagnostics switch off in this Node test environment.
Object.assign(globalThis, { location: { search: '' } })
const { createMapResources, coverageSourceId } = await import(
  '../src/features/map/overlap/mapResources.ts'
)

test('MapLibre adapter rejects errored sources despite loaded=true and ignores unrelated errors', () => {
  const listeners = new Map<string, (event: unknown) => void>()
  const sources = new Map<string, string>()
  const failures: number[] = []
  let moving = false
  const map = {
    on: (event: string, callback: (event: unknown) => void) => listeners.set(event, callback),
    off: (event: string) => listeners.delete(event),
    getLayer: () => undefined,
    getSource: (id: string) =>
      sources.has(id) ? { serialize: () => ({ tiles: [sources.get(id)] }) } : undefined,
    isSourceLoaded: () => true,
    isMoving: () => moving,
  } as unknown as MapLibreMap
  const resources = createMapResources(map, 'archive', new Map(), (id) => failures.push(id))
  // Empty tiles need no images; they still establish coverage/fallback identities.
  const { snapshot } = resources.stage(new Map([['2/0/0', tile(0, 0)]]), 0)
  sources.set(coverageSourceId(0), snapshot.url)
  assert.deepEqual(resources.isReady(snapshot, 0), true)
  moving = true
  assert.deepEqual(
    resources.isReady(snapshot, 0),
    false,
    'loaded sources cannot switch buffers during a camera gesture',
  )
  moving = false
  const error = required(listeners.get('error'))
  error({ sourceId: 'terrain', source: { tiles: [snapshot.url] } })
  error({ sourceId: coverageSourceId(0), source: { tiles: ['obsolete-mask'] } })
  assert.deepEqual(failures, [])
  error({ sourceId: coverageSourceId(0), source: { tiles: [snapshot.url] } })
  assert.deepEqual(failures, [snapshot.id])
  assert.deepEqual(resources.isReady(snapshot, 0), false)
  resources.release(snapshot)
  resources.dispose()
  assert.equal(listeners.size, 0)
})

test('style replacement restores owned stripe images without recomputing and releases them on disposal', () => {
  const listeners = new Map<string, (event: unknown) => void>()
  const images = new Map<string, { width: number; height: number; data: Uint8Array }>()
  const failures: number[] = []
  const sources = new Map<string, string>()
  const map = {
    on: (event: string, callback: (event: unknown) => void) => listeners.set(event, callback),
    off: (event: string) => listeners.delete(event),
    getLayer: () => undefined,
    getSource: (id: string) =>
      sources.has(id) ? { serialize: () => ({ tiles: [sources.get(id)] }) } : undefined,
    isSourceLoaded: () => true,
    querySourceFeatures: () => [],
    getImage: (id: string) => (images.has(id) ? { data: images.get(id) } : undefined),
    hasImage: (id: string) => images.has(id),
    addImage: (id: string, image: { width: number; height: number; data: Uint8Array }) =>
      images.set(id, image),
    removeImage: (id: string) => images.delete(id),
  } as unknown as MapLibreMap
  const resources = createMapResources(
    map,
    'archive',
    new Map([
      ['A', '#ff0000'],
      ['B', '#0000ff'],
    ]),
    (id) => failures.push(id),
  )
  const { snapshot } = resources.stage(new Map([['2/0/0', tile(0)]]), 0)
  const original = required(images.get('overlap:A|B'))
  images.clear()
  const restore = required(listeners.get('styleimagemissing'))
  restore({ id: 'overlap:A|B' })
  assert.deepEqual(images.get('overlap:A|B'), original)
  restore({ id: 'unrelated-image' })
  assert.equal(images.size, 1)
  assert.deepEqual(failures, [])
  sources.set(coverageSourceId(0), snapshot.url)
  resources.release(snapshot)
  resources.prune()
  assert.equal(images.size, 1, 'React still references the retiring coverage source')
  sources.set(coverageSourceId(0), 'replacement-snapshot')
  required(listeners.get('styledata'))({})
  resources.prune()
  assert.equal(images.size, 0, 'detached sources release their last pattern reference')
  images.clear()
  restore({ id: 'overlap:A|B' })
  assert.equal(images.size, 0, 'released and pruned images cannot be resurrected')
  resources.dispose()
  assert.equal(listeners.size, 0)
})
