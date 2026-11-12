import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createStore } from 'jotai/vanilla'
import { indexWals } from '../src/domain/wals.ts'
import { selectWalsExamples, walsExampleGeometry } from '../src/domain/walsExamples.ts'
import { walsRepositoryAtom, walsSessionAtom } from '../src/features/wals/state.ts'
import { wordTrailVisibleAtom } from '../src/integrations/etymology/visibility.ts'
import { startOverlayCamera } from '../src/integrations/map/overlayCamera.ts'
import { walsCameraBounds, walsExampleBounds } from '../src/integrations/wals/mapGeometry.ts'
import {
  clearWalsOverlayAtom,
  focusWalsExamplesAtom,
  inspectWalsObservationAtom,
  setWalsOverlayVisibilityAtom,
  showWalsExamplesAtom,
  walsAtlasCatalogAtom,
  walsCameraRequestAtom,
} from '../src/integrations/wals/state.ts'
import { explorerActionAtom, explorerSessionAtom } from '../src/state/explorerState.ts'
import { focusLanguageOnMapAtom } from '../src/state/languageControls.ts'
import { mapCameraIntentAtom } from '../src/state/mapCameraIntent.ts'
import { walsCatalog, walsData } from './fixtures/wals.ts'

test('WALS focus bounds use the short dateline arc; empty and single points are explicit', () => {
  const data = walsData()
  data.records = {
    ...data.records,
    ird: { ...data.records.ird, coordinates: [170, 0] },
    aea: { ...data.records.aea, coordinates: [-170, 20] },
    broad: { ...data.records.broad, coordinates: null },
    orphan: { ...data.records.orphan, coordinates: null },
  }
  const selection = selectWalsExamples(indexWals(data), 'ird', '12A')
  assert.ok(selection)
  assert.deepEqual(walsExampleBounds(walsExampleGeometry(selection)), [170, 0, 190, 20])
  assert.deepEqual(
    walsExampleBounds(walsExampleGeometry({ ...selection, examples: [] })),
    [170, 0, 170, 0],
  )
  assert.equal(walsExampleBounds({ type: 'FeatureCollection', features: [] }), null)
  assert.deepEqual(walsCameraBounds([170, 0, 190, 20], true), [-180, 0, 180, 20])
  assert.deepEqual(walsCameraBounds([170, 0, 190, 20], false), [170, 0, 190, 20])
  assert.deepEqual(walsCameraBounds([-20, 0, 30, 20], true), [-20, 0, 30, 20])
})

const cameraFixture = () => {
  const store = createStore()
  store.set(walsRepositoryAtom, indexWals(walsData()))
  store.set(walsAtlasCatalogAtom, walsCatalog())
  store.set(explorerActionAtom, { type: 'trace', id: 'test-word' })
  store.set(showWalsExamplesAtom, { sourceId: 'ird', featureId: '12A' })
  const request = store.get(walsCameraRequestAtom)
  assert.ok(request)
  const events = new Map<string, Set<() => void>>()
  const frames = new Map<number, () => void>()
  let frameId = 0
  let loaded = false
  let fits = 0
  let resolutions = 0
  let duration: number | null = null
  const cleanup = startOverlayCamera({
    map: {
      isStyleLoaded: () => loaded,
      on: (event, fn) => {
        const values = events.get(event) ?? new Set()
        values.add(fn)
        events.set(event, values)
      },
      off: (event, fn) => events.get(event)?.delete(fn),
      getCanvas: () => ({ clientWidth: 640, clientHeight: 400 }),
      resize: () => {},
      stop: () => {},
      fitBounds: (_bounds, options) => {
        fits++
        duration = options.duration
      },
    },
    bounds: () => {
      resolutions++
      return [170, 0, 190, 20]
    },
    isCurrent: () => store.get(walsCameraRequestAtom) === request,
    canStop: () => !store.get(mapCameraIntentAtom) || store.get(mapCameraIntentAtom) === request,
    reducedMotion: true,
    frames: {
      request: (fn) => {
        const id = ++frameId
        frames.set(id, fn)
        return id
      },
      cancel: (id) => {
        frames.delete(id)
      },
    },
  })
  return {
    store,
    cleanup,
    get fits() {
      return fits
    },
    get resolutions() {
      return resolutions
    },
    get duration() {
      return duration
    },
    ready: () => {
      loaded = true
      for (const fn of events.get('style.load') ?? []) fn()
    },
    flush: () => {
      const callbacks = [...frames.values()]
      frames.clear()
      for (const fn of callbacks) fn()
    },
  }
}

test('WALS camera rechecks actual action ownership after style and frame waits', () => {
  const actions = {
    manual: (store) => store.set(mapCameraIntentAtom, null),
    profile: (store) => store.set(focusLanguageOnMapAtom, { languageId: 'atlas:irish' }),
    lexical: (store) => store.set(explorerActionAtom, { type: 'show-trail' }),
    inspection: (store) =>
      store.set(inspectWalsObservationAtom, { sourceId: 'aea', featureId: '12A' }),
    replacement: (store) => store.set(showWalsExamplesAtom, { sourceId: 'aea', featureId: '12A' }),
    hide: (store) => store.set(setWalsOverlayVisibilityAtom, false),
    clear: (store) => store.set(clearWalsOverlayAtom),
    workspace: (store) =>
      store.set(explorerActionAtom, { type: 'workspace', workspace: 'etymology' }),
  } satisfies Record<string, (store: ReturnType<typeof createStore>) => unknown>
  for (const [name, action] of Object.entries(actions))
    for (const phase of ['style', 'frame']) {
      const f = cameraFixture()
      if (phase === 'frame') f.ready()
      action(f.store)
      f.ready()
      f.flush()
      assert.equal(f.fits, 0, `${name} during ${phase}`)
      assert.equal(f.resolutions, 0, `${name} must cancel before resolving focus bounds`)
      f.cleanup()
    }
  const f = cameraFixture()
  f.ready()
  f.flush()
  f.ready()
  f.flush()
  assert.equal(f.fits, 1)
  assert.equal(f.resolutions, 1)
  assert.equal(f.duration, 0)
  f.cleanup()
})

test('overlay visibility retains both explorations and cannot replay old camera requests', () => {
  const f = cameraFixture()
  const { store } = f
  store.set(explorerActionAtom, { type: 'trace', id: 'test-word' })
  store.set(explorerActionAtom, { type: 'show-trail' })
  const lexical = store.get(explorerSessionAtom)
  const specification = store.get(walsSessionAtom).overlay
  store.set(wordTrailVisibleAtom, false)
  assert.equal(store.get(wordTrailVisibleAtom), false)
  assert.strictEqual(store.get(walsSessionAtom).overlay, specification)
  assert.equal(store.get(mapCameraIntentAtom), null)
  store.set(wordTrailVisibleAtom, true)
  assert.equal(store.get(mapCameraIntentAtom), null)
  assert.strictEqual(store.get(explorerSessionAtom), lexical)
  store.set(wordTrailVisibleAtom, false)
  store.set(explorerActionAtom, { type: 'show-trail' })
  assert.equal(store.get(wordTrailVisibleAtom), true, 'explicit lexical show restores visibility')
  const intent = store.get(mapCameraIntentAtom)
  store.set(setWalsOverlayVisibilityAtom, false)
  assert.strictEqual(
    store.get(mapCameraIntentAtom),
    intent,
    'WALS hide preserves a newer lexical intent',
  )
  store.set(setWalsOverlayVisibilityAtom, true)
  assert.strictEqual(store.get(mapCameraIntentAtom), intent)
  store.set(focusWalsExamplesAtom)
  const walsIntent = store.get(mapCameraIntentAtom)
  store.set(wordTrailVisibleAtom, false)
  assert.strictEqual(
    store.get(mapCameraIntentAtom),
    walsIntent,
    'lexical hide preserves newer WALS intent',
  )
  store.set(clearWalsOverlayAtom)
  assert.equal(store.get(explorerSessionAtom).overlay.enabled, true)
  assert.equal(store.get(explorerSessionAtom).trail.root, 'test-word')
  f.cleanup()
})
