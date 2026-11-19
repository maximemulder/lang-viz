import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { createStore } from 'jotai/vanilla'
import { indexBoundaries } from '../src/features/administrative/boundaryRepository.ts'
import {
  boundaryIndexAtom,
  checkedTerritoriesAtom,
  selectCheckedTerritoriesAtom,
  toggleCheckedTerritoryAtom,
} from '../src/features/administrative/state.ts'
import {
  inspectLanguageInRegion,
  isDoubleMapClick,
  isolatedLanguageIds,
} from '../src/features/map/interactionRules.ts'

test('country overview selects a country, then its language areas receive the same gestures as Languages', () => {
  assert.equal(inspectLanguageInRegion('India', [], true), false)
  assert.equal(inspectLanguageInRegion('India', ['India'], true), true)
  assert.equal(inspectLanguageInRegion('Japan', ['India'], true), false)
  assert.equal(inspectLanguageInRegion('India', ['India'], false), false)
  assert.equal(inspectLanguageInRegion(null, ['India'], true), false)
})
test('a family isolation includes its real mapped members rather than becoming an empty map', () => {
  const children = new Map([
    ['family', [{ id: 'a' }, { id: 'b' }]],
    ['a', [{ id: 'dialect' }]],
  ])
  assert.deepEqual(
    [...isolatedLanguageIds('family', 'family', false, children)],
    ['family', 'a', 'b', 'dialect'],
  )
  assert.deepEqual([...isolatedLanguageIds('a', 'language', true, children)], ['a'])
  assert.deepEqual([...isolatedLanguageIds('a', 'language', false, children)], ['a', 'dialect'])
  assert.deepEqual([...isolatedLanguageIds('other', 'language', false, children)], ['other'])
})
test('branch traversal is safe for repeated or cyclic links', () => {
  const children = new Map([
    ['family', [{ id: 'a' }, { id: 'a' }]],
    ['a', [{ id: 'family' }]],
  ])
  assert.deepEqual([...isolatedLanguageIds('family', 'family', false, children)], ['family', 'a'])
})
test('region checkboxes select only mapped boundaries, preserve other checks, and toggle independently', () => {
  const asset = (name: string) =>
    JSON.parse(
      readFileSync(new URL(`../public/administrative/boundaries/${name}`, import.meta.url), 'utf8'),
    )
  const store = createStore()
  store.set(
    boundaryIndexAtom,
    indexBoundaries(asset('feature-index.json'), asset('crosswalk.json')),
  )
  store.set(toggleCheckedTerritoryAtom, 'IN')
  store.set(toggleCheckedTerritoryAtom, 'JP')
  assert.deepEqual(store.get(checkedTerritoriesAtom), ['IN', 'JP'])
  store.set(selectCheckedTerritoriesAtom, ['IN', 'US', 'ZZ'])
  assert.deepEqual(store.get(checkedTerritoriesAtom), ['IN', 'JP', 'US'])
  store.set(toggleCheckedTerritoryAtom, 'JP')
  assert.deepEqual(store.get(checkedTerritoriesAtom), ['IN', 'US'])
})

test('human double clicks remain double clicks beyond the old 350ms timeout, including trackpad clicks without native detail', () => {
  const first = { x: 500, y: 350, time: 1000 }
  assert.equal(isDoubleMapClick(first, { x: 502, y: 351, time: 1480 }), true)
  assert.equal(isDoubleMapClick(first, { x: 501, y: 352, time: 1600 }), true)
  assert.equal(isDoubleMapClick(first, { x: 501, y: 352, time: 1700 }), false)
  assert.equal(isDoubleMapClick(first, { x: 525, y: 350, time: 1200 }), false)
  assert.equal(isDoubleMapClick(null, first), false)
})
