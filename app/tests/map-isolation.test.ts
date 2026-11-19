import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createStore } from 'jotai/vanilla'
import { walsActionAtom, walsSessionAtom } from '../src/features/wals/state.ts'
import { mapCameraIntentAtom } from '../src/state/mapCameraIntent.ts'
import {
  clearMapIsolationAtom,
  isolateMapAtom,
  isolationOverviewRequestAtom,
  mapColorsVisibleAtom,
  mapContextOpacityAtom,
  mapIsolationAtom,
  regionIsolationReadyAtom,
  setIsolationColorAtom,
} from '../src/state/mapInteraction.ts'

test('isolation removes context fills without changing the WALS selection, and restores it', () => {
  const store = createStore()
  store.set(walsActionAtom, { type: 'show-examples', sourceId: 'iri', featureId: '81A' })
  const overlay = store.get(walsSessionAtom).overlay
  store.set(isolateMapAtom, { kind: 'language', id: 'lang', label: 'A language', color: '#887766' })
  assert.equal(store.get(mapContextOpacityAtom), 0)
  assert.strictEqual(store.get(walsSessionAtom).overlay, overlay)
  store.set(clearMapIsolationAtom)
  assert.equal(store.get(mapContextOpacityAtom), 0.16)
  assert.strictEqual(store.get(walsSessionAtom).overlay, overlay)
})

test('colour edits do not reissue a camera request or change isolated region geometry', () => {
  const store = createStore()
  const featureIds = ['original-country-A', 'original-country-B']
  store.set(isolateMapAtom, {
    kind: 'region',
    id: 'AB',
    label: 'Region',
    color: '#887766',
    featureIds,
  })
  const request = store.get(isolationOverviewRequestAtom)
  store.set(setIsolationColorAtom, '#123abc')
  const isolation = store.get(mapIsolationAtom)
  assert.equal(isolation?.color, '#123abc')
  assert.ok(isolation?.kind === 'region')
  assert.strictEqual(isolation.featureIds, featureIds)
  assert.strictEqual(store.get(isolationOverviewRequestAtom), request)
  store.set(setIsolationColorAtom, 'invalid')
  assert.strictEqual(store.get(mapIsolationAtom), isolation)
})

test('restoring the map leaves newer camera intent alone', () => {
  const store = createStore()
  store.set(isolateMapAtom, { kind: 'language', id: 'a', label: 'Language', color: '#123456' })
  const newer = { requestId: 999 }
  store.set(mapCameraIntentAtom, newer)
  store.set(clearMapIsolationAtom)
  assert.strictEqual(store.get(mapCameraIntentAtom), newer)
  assert.equal(store.get(mapIsolationAtom), null)
})

test('country isolation retains the multicolour language fill only after its mask is ready', () => {
  const store = createStore()
  store.set(isolateMapAtom, {
    kind: 'region',
    id: 'AB',
    label: 'Region',
    color: '#123456',
    featureIds: ['original'],
  })
  assert.equal(store.get(mapContextOpacityAtom), 0)
  store.set(regionIsolationReadyAtom, true)
  assert.equal(store.get(mapContextOpacityAtom), 1)
  store.set(mapColorsVisibleAtom, false)
  assert.equal(store.get(mapContextOpacityAtom), 0)
})
