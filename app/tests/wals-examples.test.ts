import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createStore } from 'jotai/vanilla'
import { indexWals, type WalsData, type WalsRecord } from '../src/domain/wals.ts'
import {
  selectWalsExamples,
  type WalsPoint,
  walsExampleGeometry,
  walsPoint,
} from '../src/domain/walsExamples.ts'
import { walsActionAtom, walsRepositoryAtom } from '../src/features/wals/state.ts'
import {
  clearWalsOverlayAtom,
  inspectWalsObservationAtom,
  setWalsOverlayVisibilityAtom,
  showWalsExamplesAtom,
  walsAtlasCatalogAtom,
  walsExampleGeometryAtom,
  walsExampleSelectionAtom,
} from '../src/integrations/wals/state.ts'
import { explorerActionAtom } from '../src/state/explorerState.ts'
import { mapCameraIntentAtom } from '../src/state/mapCameraIntent.ts'
import { walsCatalog, walsData } from './fixtures/wals.ts'

const fixture = (points: Readonly<Record<string, WalsPoint | null>>) => {
  const base = walsData()
  const template = base.records.ird
  assert.ok(template)
  const records: Record<string, WalsRecord> = {}
  const observations: Record<string, WalsData['observations'][string]> = {}
  for (const [sourceId, coordinates] of Object.entries(points)) {
    records[sourceId] = { ...template, name: sourceId, coordinates }
    observations[`12A-${sourceId}`] = {
      sourceId,
      featureId: '12A',
      categoryId: '12A-1',
      references: [],
      comment: '',
      exampleIds: [],
      url: `https://wals.info/valuesets/12A-${sourceId}`,
    }
  }
  return { ...base, records, observations }
}
const selected = (data: WalsData, origin = 'origin', limit = 12) => {
  const selection = selectWalsExamples(indexWals(data), origin, '12A', limit)
  assert.ok(selection)
  return selection
}
const ids = (selection: ReturnType<typeof selected>) => selection.examples.map((v) => v.sourceId)

test('exact category selection keeps distinct varieties, including a colocated origin', () => {
  const data = fixture({ origin: [0, 0], same: [0, 0], far: [180, 0], other: [90, 0] })
  const category = data.categories['12A-1']
  const other = data.observations['12A-other']
  assert.ok(category && other)
  data.categories = {
    ...data.categories,
    '12A-2': { ...category, number: 2 },
  }
  data.observations = {
    ...data.observations,
    '12A-other': { ...other, categoryId: '12A-2' },
  }
  const selection = selected(data)
  assert.deepEqual(ids(selection), ['far', 'same'])
  assert.deepEqual(selection.counts, {
    matchingRecords: 3,
    locatedRecords: 3,
    candidateRecords: 2,
    groupedCandidates: 2,
    displayedExamples: 2,
  })
  assert.equal(selection.examples[1]?.observationId, '12A-same')
})

test('farthest-first selects geographic spread, with stable source-ID ties and input order', () => {
  const data = fixture({ origin: [0, 0], a: [90, 0], b: [-90, 0], c: [180, 0], d: [1, 0] })
  const first = selected(data, 'origin', 3)
  assert.deepEqual(ids(first), ['c', 'a', 'b'])
  const reversed = {
    ...data,
    records: Object.fromEntries(Object.entries(data.records).reverse()),
    observations: Object.fromEntries(Object.entries(data.observations).reverse()),
  }
  assert.deepEqual(selected(reversed, 'origin', 3), first)
  assert.deepEqual(ids(selected(data, 'origin', 2)), ids(first).slice(0, 2))
})

test('counts separate matching, located, coordinate groups and displayed observations', () => {
  const data = fixture({
    origin: [0, 0],
    a: [90, 0],
    b: [90, 0],
    c: [90, 0],
    missing: null,
    invalid: [181, 20],
    infinite: [0, Infinity],
    nan: [NaN, 2],
  })
  const selection = selected(data, 'origin', 2)
  assert.deepEqual(selection.counts, {
    matchingRecords: 8,
    locatedRecords: 4,
    candidateRecords: 3,
    groupedCandidates: 1,
    displayedExamples: 2,
  })
  assert.deepEqual(ids(selection), ['a', 'b'])
  const geometry = walsExampleGeometry(selection)
  assert.equal(geometry.features.length, 2)
  assert.deepEqual(geometry.features[1]?.properties.sourceIds, ['a', 'b'])
  assert.deepEqual(geometry.features[1]?.properties.observationIds, ['12A-a', '12A-b'])
})

test('missing or invalid origin coordinates do not suppress other source observations', () => {
  for (const coordinates of [null, [NaN, 2], [0, 91]] as const) {
    const selection = selected(
      fixture({ origin: coordinates, z: [0, 0], a: [45, 0], b: [-135, 0] }),
    )
    assert.equal(selection.origin.coordinates, null)
    assert.deepEqual(ids(selection), ['a', 'b', 'z'])
    assert.equal(selection.counts.matchingRecords, 4)
    assert.equal(selection.counts.locatedRecords, 3)
    assert.ok(walsExampleGeometry(selection).features.every((f) => f.properties.role === 'example'))
  }
})

test('zero, dateline, poles, identical points and antipodes produce finite grouped point geometry', () => {
  const selection = selected(
    fixture({
      origin: [-180, 10],
      east: [180, 10],
      meridian: [180, 20],
      antipode: [0, -10],
      north: [100, 90],
      north2: [-40, 90],
      south: [0, -90],
      zero: [-0, -0],
    }),
  )
  const geometry = walsExampleGeometry(selection)
  assert.equal(geometry.features.length, 6)
  const origin = geometry.features.find((f) => f.properties.role === 'origin-and-example')
  assert.deepEqual(origin?.properties.sourceIds, ['origin', 'east'])
  assert.deepEqual(origin?.geometry.coordinates, [-180, 10])
  assert.deepEqual(walsPoint([-0, -0]), [0, 0])
  assert.equal(selection.counts.groupedCandidates, 6)
  for (const feature of geometry.features) {
    assert.equal(feature.geometry.type, 'Point')
    assert.ok(feature.geometry.coordinates.every(Number.isFinite))
    assert.equal(feature.properties.categoryId, '12A-1')
    assert.equal(feature.properties.featureId, '12A')
  }
})

test('limits are bounded, floored, and explicit about invalid numeric settings', () => {
  const data = fixture(
    Object.fromEntries([
      ['origin', [0, 0]],
      ...Array.from({ length: 20 }, (_, i) => [
        `s${i.toString().padStart(2, '0')}`,
        [i * 9 - 90, 20],
      ]),
    ]),
  )
  for (const [limit, count] of [
    [0, 0],
    [-1, 0],
    [2.9, 2],
    [100, 12],
    [Infinity, 12],
    [NaN, 12],
  ]) {
    assert.equal(selected(data, 'origin', limit).examples.length, count)
    assert.equal(selected(data, 'origin', limit).counts.candidateRecords, 20)
  }
})

test('no candidates or no locations retain the origin evidence and honest zero counts', () => {
  for (const coordinates of [[0, 0], null] as const) {
    const selection = selected(fixture({ origin: coordinates }))
    assert.deepEqual(selection.examples, [])
    assert.equal(selection.counts.matchingRecords, 1)
    assert.equal(selection.counts.locatedRecords, coordinates ? 1 : 0)
    assert.equal(selection.counts.candidateRecords, 0)
    assert.equal(selection.counts.groupedCandidates, 0)
    assert.equal(walsExampleGeometry(selection).features.length, coordinates ? 1 : 0)
  }
  const repository = indexWals(walsData())
  assert.equal(selectWalsExamples(repository, 'iri', '12A'), null)
  assert.equal(selectWalsExamples(repository, 'missing', '12A'), null)
  assert.equal(selectWalsExamples(repository, 'ird', 'missing'), null)
})

test('selection and geometry neither mutate evidence nor need an atlas association', () => {
  const data = fixture({ origin: [0, 0], unmatched: [100, 30] })
  const unmatched = data.records.unmatched
  assert.ok(unmatched)
  data.records = {
    ...data.records,
    unmatched: { ...unmatched, glottocode: null, iso6393: null },
  }
  const before = JSON.stringify(data)
  const selection = selected(data)
  assert.deepEqual(ids(selection), ['unmatched'])
  walsExampleGeometry(selection)
  assert.equal(JSON.stringify(data), before)
})

test('derived selection and geometry stay identical through inspection, catalog and visibility changes', () => {
  const store = createStore()
  const data = fixture({ origin: [0, 0], variety: [90, 0] })
  store.set(walsRepositoryAtom, indexWals(data))
  assert.equal(store.get(walsExampleSelectionAtom), null)
  assert.equal(store.get(walsExampleGeometryAtom), null)
  store.set(showWalsExamplesAtom, { sourceId: 'origin', featureId: '12A' })
  const selection = store.get(walsExampleSelectionAtom)
  const geometry = store.get(walsExampleGeometryAtom)
  assert.ok(selection && geometry)
  const intent = store.get(mapCameraIntentAtom)
  // Subscribe as a mounted consumer would; no resampling for unrelated UI state.
  const unsubscribe = store.sub(walsExampleGeometryAtom, () => {})
  store.set(walsAtlasCatalogAtom, walsCatalog())
  store.set(inspectWalsObservationAtom, { sourceId: 'variety', featureId: '12A' })
  store.set(setWalsOverlayVisibilityAtom, false)
  store.set(explorerActionAtom, { type: 'workspace', workspace: 'etymology' })
  store.set(setWalsOverlayVisibilityAtom, true)
  assert.strictEqual(store.get(walsExampleSelectionAtom), selection)
  assert.strictEqual(store.get(walsExampleGeometryAtom), geometry)
  assert.notStrictEqual(store.get(mapCameraIntentAtom), intent)
  store.set(walsActionAtom, { type: 'show-examples', sourceId: 'variety', featureId: '12A' })
  assert.notStrictEqual(store.get(walsExampleSelectionAtom), selection)
  assert.equal(store.get(walsExampleSelectionAtom)?.origin.sourceId, 'variety')
  store.set(clearWalsOverlayAtom)
  assert.equal(store.get(walsExampleSelectionAtom), null)
  assert.equal(store.get(walsExampleGeometryAtom), null)
  unsubscribe()
})
