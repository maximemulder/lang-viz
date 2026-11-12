import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createStore } from 'jotai/vanilla'
import type { GeographyAvailability } from '../src/domain/aggregation.ts'
import type { GeometryVariant, Language } from '../src/domain/atlas.ts'
import { addMapEntries, pinMapEntry } from '../src/domain/mapEntries.ts'
import { deriveWordTrail } from '../src/features/etymology/session.ts'
import { etymologyRepositoryAtom } from '../src/features/etymology/state.ts'
import { planTrailAreas, trailLanguageGroups } from '../src/integrations/etymology/trailAreas.ts'
import { explorerActionAtom, explorerSessionAtom } from '../src/state/explorerState.ts'
import { focusLanguageOnMapAtom, languageMapNavigationAtom } from '../src/state/languageControls.ts'
import { mapCameraIntentAtom } from '../src/state/mapCameraIntent.ts'
import { explorerRepository } from './fixtures/explorer.ts'

const required = <T>(value: T | null | undefined): T => {
  assert.ok(value !== null && value !== undefined)
  return value
}

const repository = explorerRepository()
const trail = required(
  deriveWordTrail(repository, {
    root: '69562',
    depth: 4,
    branches: true,
    placeholders: false,
    expanded: new Set(),
  }),
)
const language = (id: string, glottocode: string): Language => ({
  id,
  classification: { kind: 'glottolog', glottocode },
  name: id,
  level: 'language',
  parentId: null,
  parentLanguageId: null,
  alternativeNames: [],
  iso6393: null,
  familyId: null,
  familyName: null,
  macroarea: null,
  countries: [],
  latitude: null,
  longitude: null,
  geometryVariantIds: [],
})
const atlas = [language('opaque:english', 'stan1293'), language('opaque:latin', 'lati1261')]
const variant = (id: string): GeometryVariant => ({
  id,
  languageId: 'opaque:english',
  datasetId: 'source',
  layer: 'contemporary',
  label: id,
  featureId: 1,
  featureCount: 1,
  geometryKind: 'source',
  color: '#123456',
  temporalCoverage: {
    kind: 'named-period',
    viewId: 'contemporary',
    label: 'Now',
    quality: 'direct',
  },
  sourceYear: 2000,
})
const own = variant('own')
const available: GeographyAvailability = {
  own,
  ownVariants: [own],
  descendants: [],
  uncoveredBranches: [],
  hasAnyAreas: true,
}
const context = { sources: ['source'], period: 'contemporary' } as const

test('trail language grouping retains every form, including records without focal points', () => {
  const data = {
    ...repository.data,
    languages: {
      ...repository.data.languages,
      '2': { ...required(repository.data.languages['2']), lat: null, lon: null },
    },
  }
  assert.deepEqual(
    trailLanguageGroups(data, trail)
      .flatMap(({ ids }) => ids)
      .sort(),
    [...trail.ids].sort(),
  )
})

test('area planning resolves identity against full catalogs before current availability', () => {
  const plan = planTrailAreas(
    repository.data,
    trail,
    atlas,
    new Map([['opaque:english', available]]),
    {},
    [],
  )
  assert.deepEqual(plan.languageIds, ['opaque:english'])
  assert.equal(plan.unavailable, 1)
  assert.equal(plan.unmatched, 0)
  const duplicate = planTrailAreas(
    repository.data,
    trail,
    [...atlas, language('other', 'stan1293')],
    new Map([['opaque:english', available]]),
    {},
    [],
  )
  assert.equal(duplicate.unmatched, 1, 'availability must not disambiguate an identity')
  assert.deepEqual(duplicate.languageIds, [])
})

test('pinning preserves comparisons and repeated additions report existing representations', () => {
  const availability = new Map([['opaque:english', available]])
  const existing = {
    ...required(pinMapEntry('old-comparison', available, 'own', context)),
    id: 'comparison',
    colorOverride: '#abcdef',
  }
  const before = [existing]
  const first = planTrailAreas(repository.data, trail, atlas, availability, {}, before)
  const after = addMapEntries(
    before,
    first.languageIds.map((id) =>
      required(pinMapEntry(id, availability.get(id), undefined, context)),
    ),
  )
  assert.strictEqual(after[0], existing)
  assert.equal(after.length - before.length, 1)
  const repeat = planTrailAreas(repository.data, trail, atlas, availability, {}, after)
  assert.deepEqual(repeat.languageIds, [])
  assert.equal(repeat.alreadyPresent, 1)
})

test('current overrides and own/descendant modes determine eligibility and exact representation', () => {
  const override = variant('override')
  const availability = new Map([
    ['opaque:english', { ...available, own: override, ownVariants: [own, override] }],
  ])
  const original = required(pinMapEntry('opaque:english', available, 'own', context))
  assert.deepEqual(
    planTrailAreas(repository.data, trail, atlas, availability, {}, [original]).languageIds,
    ['opaque:english'],
  )
  const descendants = new Map([
    ['opaque:english', { ...available, own: undefined, ownVariants: [], descendants: [own] }],
  ])
  assert.deepEqual(planTrailAreas(repository.data, trail, atlas, descendants, {}, []).languageIds, [
    'opaque:english',
  ])
  assert.deepEqual(
    planTrailAreas(repository.data, trail, atlas, descendants, { 'opaque:english': 'own' }, [])
      .languageIds,
    [],
  )
  assert.equal(
    planTrailAreas(repository.data, trail, atlas, descendants, { 'opaque:english': 'own' }, [])
      .unavailable,
    2,
  )
})

test('explicit atlas and trail camera requests supersede one another without replay on workspace return', () => {
  const store = createStore()
  store.set(etymologyRepositoryAtom, repository)
  store.set(focusLanguageOnMapAtom, { languageId: 'opaque:english' })
  assert.strictEqual(store.get(mapCameraIntentAtom), store.get(languageMapNavigationAtom))
  store.set(explorerActionAtom, { type: 'trace', id: '69562' })
  store.set(explorerActionAtom, { type: 'show-trail' })
  const intent = store.get(explorerSessionAtom).overlay.focusRequest
  assert.strictEqual(store.get(mapCameraIntentAtom), intent)
  assert.equal(store.get(languageMapNavigationAtom), null)
  store.set(focusLanguageOnMapAtom, { languageId: 'opaque:latin' })
  assert.notStrictEqual(store.get(mapCameraIntentAtom), intent)
  store.set(explorerActionAtom, { type: 'workspace', workspace: 'etymology' })
  store.set(explorerActionAtom, { type: 'workspace', workspace: 'geography' })
  assert.equal(store.get(mapCameraIntentAtom), null)
})

test('inspecting a mapped form retains trail, expansion, comparison and filters', () => {
  const store = createStore()
  store.set(explorerActionAtom, { type: 'trace', id: '69562' })
  store.set(explorerActionAtom, { type: 'expand', id: '69421' })
  store.set(explorerActionAtom, { type: 'comparison', conceptId: '1001', collectionId: '1' })
  store.set(explorerActionAtom, {
    type: 'comparison-filter',
    family: 'Family',
    includeMissing: true,
  })
  store.set(explorerActionAtom, { type: 'show-trail' })
  const before = store.get(explorerSessionAtom)
  store.set(explorerActionAtom, { type: 'inspect-trail-word', id: '69421' })
  const after = store.get(explorerSessionAtom)
  assert.strictEqual(after.trail, before.trail)
  assert.strictEqual(after.comparison, before.comparison)
  assert.deepEqual(after.selection, { kind: 'word', id: '69421' })
  assert.equal(after.workspace, 'etymology')
  assert.equal(after.overlay.enabled, true)
})
