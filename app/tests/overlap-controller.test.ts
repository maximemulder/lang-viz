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
  const readiness = { coverage: false, fallback: false }
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
          maxzoom: 2,
        },
      }
    },
    readiness: () => readiness,
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
    readiness.coverage = readiness.fallback = true
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

test('publication waits for both sources, retains the old snapshot, and coalesces arrivals', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const f = fixture()
  context.after(() => f.controller.dispose())
  f.initial()
  const previous = f.state.snapshots[0]
  f.readiness.coverage = f.readiness.fallback = false
  f.controller.refresh([coordinate(1), coordinate(2)])
  assert.deepEqual(f.sent.at(-1)?.knownTiles, ['2/0/0'])
  f.receive(tile(1))
  context.mock.timers.tick(250)
  assert.equal(f.registered.size, 2)
  f.receive(tile(2))
  f.finish()
  assert.equal(f.registered.size, 2, 'arrivals do not replace a staging source')
  f.readiness.coverage = true
  f.controller.publish()
  assert.equal(f.state.activeBuffer, 0)
  assert.equal(f.state.snapshots[0], previous)
  f.readiness.fallback = true
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
  f.readiness.fallback = false
  f.controller.refresh([coordinate(1)])
  f.receive(tile(1))
  f.finish()
  context.mock.timers.tick(PUBLICATION_TIMEOUT_MS)
  f.publish()
  assert.equal(f.state.status, 'error')
  assert.equal(f.state.snapshots[0], previous)
  assert.equal(f.registered.size, 1)
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

// The adapter imports browser protocol registration. Only location is needed
// to keep its explicit diagnostics switch off in this Node test environment.
Object.assign(globalThis, { location: { search: '' } })
const { createMapResources, coverageSourceId, fallbackSourceId } = await import(
  '../src/features/map/overlap/mapResources.ts'
)
const { fallbackTilesUrl } = await import('../src/features/map/overlap/fallbackProtocol.ts')

test('MapLibre adapter rejects errored sources despite loaded=true and ignores unrelated errors', () => {
  const listeners = new Map<string, (event: unknown) => void>()
  const sources = new Map<string, string>()
  const failures: number[] = []
  const map = {
    on: (event: string, callback: (event: unknown) => void) => listeners.set(event, callback),
    off: (event: string) => listeners.delete(event),
    getLayer: () => undefined,
    getSource: (id: string) =>
      sources.has(id) ? { serialize: () => ({ tiles: [sources.get(id)] }) } : undefined,
    isSourceLoaded: () => true,
  } as unknown as MapLibreMap
  const resources = createMapResources(map, 'archive', new Map(), (id) => failures.push(id))
  // Empty tiles need no images; they still establish coverage/fallback identities.
  const { snapshot } = resources.stage(new Map([['2/0/0', tile(0, 0)]]), 0)
  sources.set(coverageSourceId(0), snapshot.url)
  const fallback = fallbackTilesUrl('archive', snapshot.coverageTiles, snapshot.id)
  sources.set(fallbackSourceId(0), fallback)
  assert.deepEqual(resources.readiness(snapshot, 0), { coverage: true, fallback: true })
  const error = required(listeners.get('error'))
  error({ sourceId: 'terrain', source: { tiles: [fallback] } })
  error({ sourceId: fallbackSourceId(0), source: { tiles: ['obsolete-mask'] } })
  assert.deepEqual(failures, [])
  error({ sourceId: fallbackSourceId(0), source: { tiles: [fallback] } })
  assert.deepEqual(failures, [snapshot.id])
  assert.deepEqual(resources.readiness(snapshot, 0), { coverage: false, fallback: false })
  resources.release(snapshot)
  resources.dispose()
  assert.equal(listeners.size, 0)
})
