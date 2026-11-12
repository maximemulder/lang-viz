import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createStore } from 'jotai/vanilla'
import { walsActionAtom, walsRepositoryAtom, walsSessionAtom } from '../src/features/wals/state.ts'
import { associateWals } from '../src/integrations/wals/languageMatching.ts'
import { resolveWalsProfile } from '../src/integrations/wals/profile.ts'
import {
  clearWalsOverlayAtom,
  focusWalsExamplesAtom,
  inspectWalsObservationAtom,
  selectWalsVarietyAtom,
  setWalsOverlayVisibilityAtom,
  showWalsExamplesAtom,
  walsAssociationsAtom,
  walsAtlasCatalogAtom,
  walsCameraRequestAtom,
  walsInspectionAtom,
} from '../src/integrations/wals/state.ts'
import { explorerActionAtom, explorerSessionAtom } from '../src/state/explorerState.ts'
import {
  closeLanguageDetailsAtom,
  focusLanguageOnMapAtom,
  languageMapNavigationAtom,
  languagePanelAtom,
} from '../src/state/languageControls.ts'
import { mapCameraIntentAtom } from '../src/state/mapCameraIntent.ts'
import { walsCatalog, walsRepository } from './fixtures/wals.ts'

const readyStore = () => {
  const store = createStore()
  store.set(walsRepositoryAtom, walsRepository())
  store.set(walsAtlasCatalogAtom, walsCatalog())
  return store
}
const profile = (store: ReturnType<typeof readyStore>, id: string) => {
  const repository = store.get(walsRepositoryAtom)
  const associations = store.get(walsAssociationsAtom)
  assert.ok(repository && associations)
  return resolveWalsProfile(repository, associations, store.get(walsSessionAtom), id)
}

for (const [sourceId, featureId, atlasId, defaultId] of [
  ['ird', '12A', 'atlas:irish', 'iri'],
  ['kyq', '37A', 'nuuc1236', 'nuu'],
  ['aea', '12A', 'aleu1260', 'ale'],
] as const)
  test(`${sourceId}: inspecting an observation keeps the exact variety/feature through remounts and workspace switches`, () => {
    const store = readyStore()
    store.set(selectWalsVarietyAtom, { profileId: atlasId, sourceId: defaultId })
    assert.equal(
      store.get(walsRepositoryAtom)?.index.bySource.get(defaultId)?.has(featureId),
      false,
    )
    const lexical = store.get(explorerSessionAtom)
    assert.equal(store.set(inspectWalsObservationAtom, { sourceId, featureId }), true)
    assert.equal(store.get(languagePanelAtom).detailId, atlasId)
    assert.equal(store.get(mapCameraIntentAtom), null)
    assert.equal(store.get(languageMapNavigationAtom), null)
    assert.equal(profile(store, atlasId).sourceId, sourceId)
    assert.equal(profile(store, atlasId).featureId, featureId)
    assert.equal(store.get(walsInspectionAtom)?.observationId, `${featureId}-${sourceId}`)
    assert.strictEqual(store.get(explorerSessionAtom), lexical)
    store.set(closeLanguageDetailsAtom)
    store.set(explorerActionAtom, { type: 'workspace', workspace: 'etymology' })
    store.set(explorerActionAtom, { type: 'workspace', workspace: 'geography' })
    // No component owns the selection: another resolver sees the same session choice.
    assert.equal(profile(store, atlasId).sourceId, sourceId)
    assert.equal(profile(store, atlasId).featureId, featureId)
    assert.equal(createStore().get(walsSessionAtom).profiles.size, 0)
  })

test('variety choices are per profile, validate associations, and never replace the overlay origin', () => {
  const store = readyStore()
  assert.equal(store.set(showWalsExamplesAtom, { sourceId: 'ird', featureId: '12A' }), true)
  const overlay = store.get(walsSessionAtom).overlay
  assert.equal(
    store.set(selectWalsVarietyAtom, { profileId: 'atlas:irish', sourceId: 'iri' }),
    true,
  )
  assert.equal(store.set(selectWalsVarietyAtom, { profileId: 'nuuc1236', sourceId: 'kyq' }), true)
  assert.equal(
    store.set(selectWalsVarietyAtom, { profileId: 'atlas:irish', sourceId: 'kyq' }),
    false,
  )
  store.set(inspectWalsObservationAtom, { sourceId: 'aea', featureId: '12A' })
  assert.strictEqual(store.get(walsSessionAtom).overlay, overlay)
  assert.equal(profile(store, 'atlas:irish').sourceId, 'iri')
  assert.equal(profile(store, 'nuuc1236').sourceId, 'kyq')
  assert.equal(profile(store, 'aleu1260').sourceId, 'aea')
})

test('unmatched or ambiguous inspection retains source evidence without opening an unrelated profile', () => {
  const store = readyStore()
  store.set(inspectWalsObservationAtom, { sourceId: 'ird', featureId: '12A' })
  const before = store.get(languagePanelAtom)
  assert.equal(
    store.set(inspectWalsObservationAtom, { sourceId: 'orphan', featureId: '12A' }),
    true,
  )
  assert.strictEqual(store.get(languagePanelAtom), before)
  assert.equal(store.get(walsInspectionAtom)?.record?.name, 'Unmatched')
  assert.equal(store.get(walsInspectionAtom)?.observation?.featureId, '12A')
  assert.match(store.get(walsInspectionAtom)?.message ?? '', /no ISO substitution/)
  const duplicate = walsCatalog()[0]
  assert.ok(duplicate)
  store.set(walsAtlasCatalogAtom, [...walsCatalog(), { ...duplicate, id: 'duplicate' }])
  store.set(inspectWalsObservationAtom, { sourceId: 'ird', featureId: '12A' })
  assert.equal(store.get(walsInspectionAtom)?.association?.status, 'ambiguous')
  assert.strictEqual(store.get(languagePanelAtom), before)
})

test('missing catalog can resolve evidence later but never initiates deferred profile navigation', () => {
  const store = createStore()
  store.set(walsRepositoryAtom, walsRepository())
  store.set(inspectWalsObservationAtom, { sourceId: 'ird', featureId: '12A' })
  assert.match(store.get(walsInspectionAtom)?.message ?? '', /catalog is not ready/)
  const session = store.get(walsSessionAtom)
  store.set(walsAtlasCatalogAtom, walsCatalog())
  assert.equal(store.get(walsInspectionAtom)?.association?.status, 'associated')
  assert.equal(store.get(walsInspectionAtom)?.profileId, undefined)
  assert.equal(store.get(languagePanelAtom).detailId, null)
  assert.strictEqual(store.get(walsSessionAtom), session)
  store.set(inspectWalsObservationAtom, { sourceId: 'ird', featureId: '12A' })
  assert.equal(store.get(languagePanelAtom).detailId, 'atlas:irish')
  assert.equal(store.get(walsInspectionAtom)?.profileId, 'atlas:irish')
})

test('closing standalone source inspection preserves profile choices, overlay and navigation', () => {
  const store = readyStore()
  store.set(inspectWalsObservationAtom, { sourceId: 'ird', featureId: '12A' })
  store.set(showWalsExamplesAtom, { sourceId: 'ird', featureId: '12A' })
  store.set(inspectWalsObservationAtom, { sourceId: 'orphan', featureId: '12A' })
  const before = store.get(walsSessionAtom)
  const panel = store.get(languagePanelAtom)
  const explorer = store.get(explorerSessionAtom)
  store.set(walsActionAtom, { type: 'clear-inspection' })
  assert.equal(store.get(walsInspectionAtom), null)
  assert.strictEqual(store.get(walsSessionAtom).profiles, before.profiles)
  assert.strictEqual(store.get(walsSessionAtom).overlay, before.overlay)
  assert.strictEqual(store.get(languagePanelAtom), panel)
  assert.strictEqual(store.get(explorerSessionAtom), explorer)
})

test('broader-scope inspection opens the family itself and retains an explicit source-only explanation', () => {
  const store = readyStore()
  store.set(inspectWalsObservationAtom, { sourceId: 'broad', featureId: '12A' })
  assert.equal(store.get(languagePanelAtom).detailId, 'broa1234')
  assert.equal(profile(store, 'broa1234').association?.status, 'associated')
  assert.match(store.get(walsInspectionAtom)?.message ?? '', /broader scope/)
  assert.equal(profile(store, 'child').record, null)
})

test('only explicit show/focus actions request a camera; newer manual/profile/lexical/WALS actions supersede them', () => {
  const store = readyStore()
  store.set(showWalsExamplesAtom, { sourceId: 'ird', featureId: '12A' })
  const first = store.get(walsCameraRequestAtom)
  assert.ok(first)
  // Selecting a profile variety cancels pending focus and preserves the overlay.
  store.set(selectWalsVarietyAtom, { profileId: 'atlas:irish', sourceId: 'iri' })
  assert.equal(store.get(walsCameraRequestAtom), null)
  store.set(focusWalsExamplesAtom)
  store.set(mapCameraIntentAtom, null) // Same cancellation used by manual panning.
  assert.equal(store.get(walsCameraRequestAtom), null)
  store.set(focusWalsExamplesAtom)
  assert.notStrictEqual(store.get(walsCameraRequestAtom), first)
  store.set(focusLanguageOnMapAtom, { languageId: 'nuuc1236' })
  assert.equal(store.get(walsCameraRequestAtom), null)
  store.set(focusWalsExamplesAtom)
  store.set(explorerActionAtom, { type: 'trace', id: 'word' })
  store.set(explorerActionAtom, { type: 'show-trail' })
  assert.equal(store.get(walsCameraRequestAtom), null)
  const lexical = store.get(explorerSessionAtom)
  store.set(showWalsExamplesAtom, { sourceId: 'kyq', featureId: '37A' })
  const newer = store.get(walsCameraRequestAtom)
  assert.ok(newer)
  assert.notStrictEqual(newer, first)
  assert.strictEqual(store.get(explorerSessionAtom).trail, lexical.trail)
  assert.strictEqual(store.get(explorerSessionAtom).overlay, lexical.overlay)
  store.set(inspectWalsObservationAtom, { sourceId: 'orphan', featureId: '12A' })
  assert.equal(store.get(walsCameraRequestAtom), null)
})

test('visibility, workspace return and clearing never replay camera intent or clear other feature state', () => {
  const store = readyStore()
  store.set(inspectWalsObservationAtom, { sourceId: 'ird', featureId: '12A' })
  store.set(showWalsExamplesAtom, { sourceId: 'ird', featureId: '12A' })
  store.set(explorerActionAtom, { type: 'workspace', workspace: 'etymology' })
  assert.equal(store.get(walsCameraRequestAtom), null)
  store.set(explorerActionAtom, { type: 'workspace', workspace: 'geography' })
  assert.equal(store.get(walsCameraRequestAtom), null)
  store.set(setWalsOverlayVisibilityAtom, false)
  store.set(setWalsOverlayVisibilityAtom, true)
  assert.equal(store.get(walsCameraRequestAtom), null)
  store.set(focusLanguageOnMapAtom, { languageId: 'nuuc1236' })
  const camera = store.get(mapCameraIntentAtom)
  const lexical = store.get(explorerSessionAtom)
  store.set(clearWalsOverlayAtom)
  assert.equal(store.get(walsSessionAtom).overlay, null)
  assert.equal(profile(store, 'atlas:irish').sourceId, 'ird')
  assert.equal(profile(store, 'atlas:irish').featureId, '12A')
  assert.strictEqual(store.get(mapCameraIntentAtom), camera)
  assert.strictEqual(store.get(explorerSessionAtom), lexical)
})

test('unready or missing observations cannot issue navigation or show/focus requests', () => {
  const store = createStore()
  assert.equal(store.set(inspectWalsObservationAtom, { sourceId: 'ird', featureId: '12A' }), false)
  assert.equal(store.set(showWalsExamplesAtom, { sourceId: 'ird', featureId: '12A' }), false)
  assert.equal(store.set(focusWalsExamplesAtom), false)
  store.set(walsRepositoryAtom, walsRepository())
  assert.equal(store.set(inspectWalsObservationAtom, { sourceId: 'iri', featureId: '12A' }), false)
  assert.equal(store.set(showWalsExamplesAtom, { sourceId: 'empty', featureId: '12A' }), false)
  // Missing locations do not erase source evidence; map eligibility is a later stage.
  assert.equal(store.set(showWalsExamplesAtom, { sourceId: 'orphan', featureId: '12A' }), true)
})

test('derived defaults never initialize choices, and a stale saved choice is explicit', () => {
  const store = readyStore()
  const before = store.get(walsSessionAtom)
  assert.ok(profile(store, 'atlas:irish').record)
  assert.strictEqual(store.get(walsSessionAtom), before)
  store.set(selectWalsVarietyAtom, { profileId: 'atlas:irish', sourceId: 'ird' })
  const repository = store.get(walsRepositoryAtom)
  assert.ok(repository)
  const result = resolveWalsProfile(
    repository,
    associateWals(repository, []),
    store.get(walsSessionAtom),
    'atlas:irish',
  )
  assert.equal(result.sourceId, 'ird')
  assert.equal(result.record, null)
  assert.match(result.message, /saved WALS variety is unavailable/)
})
