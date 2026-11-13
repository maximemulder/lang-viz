import { atom } from 'jotai'
import type { Language } from '../../domain/atlas.ts'
import { selectWalsExamples, walsExampleGeometry } from '../../domain/walsExamples.ts'
import type { WalsOverlaySpecification } from '../../features/wals/session.ts'
import { walsActionAtom, walsRepositoryAtom, walsSessionAtom } from '../../features/wals/state.ts'
import { explorerActionAtom, explorerSessionAtom } from '../../state/explorerState.ts'
import { languageMapNavigationAtom, openLanguageDetailsAtom } from '../../state/languageControls.ts'
import { mapCameraIntentAtom } from '../../state/mapCameraIntent.ts'
import { isolatedLanguageIdAtom } from '../../state/mapInteraction.ts'
import { associateWals } from './languageMatching.ts'

/** The integration publishes the COMPLETE ready atlas catalog, independent of map filters. */
export const walsAtlasCatalogAtom = atom<readonly Language[] | null>(null)
export const walsAssociationsAtom = atom((get) => {
  const repository = get(walsRepositoryAtom)
  const catalog = get(walsAtlasCatalogAtom)
  return repository && catalog ? associateWals(repository, catalog) : null
})
// Primitive dependencies prevent profile inspection, visibility and catalog changes
// from resampling or rebuilding geometry. No sampled records are stored in session state.
const exampleSourceAtom = atom((get) => get(walsSessionAtom).overlay?.sourceId ?? null)
const exampleFeatureAtom = atom((get) => get(walsSessionAtom).overlay?.featureId ?? null)
const exampleLimitAtom = atom((get) => get(walsSessionAtom).overlay?.maxExamples)
export const walsExampleSelectionAtom = atom((get) => {
  const repository = get(walsRepositoryAtom)
  const sourceId = get(exampleSourceAtom)
  const featureId = get(exampleFeatureAtom)
  const limit = get(exampleLimitAtom)
  return repository && sourceId && featureId
    ? selectWalsExamples(repository, sourceId, featureId, limit)
    : null
})
export const walsExampleGeometryAtom = atom((get) => {
  const selection = get(walsExampleSelectionAtom)
  return selection ? walsExampleGeometry(selection) : null
})
export const walsInspectionAtom = atom((get) => {
  const selection = get(walsSessionAtom).inspection
  const repository = get(walsRepositoryAtom)
  if (!selection || !repository) return null
  const observationId = selection.featureId
    ? repository.index.bySource.get(selection.sourceId)?.get(selection.featureId)
    : undefined
  const association = get(walsAssociationsAtom)?.bySource.get(selection.sourceId) ?? null
  return {
    ...selection,
    record: repository.data.records[selection.sourceId] ?? null,
    observationId: observationId ?? null,
    observation: observationId ? (repository.data.observations[observationId] ?? null) : null,
    association,
    message:
      association?.explanation ??
      'The atlas catalog is not ready. WALS source evidence remains available; no catalog profile has been opened.',
  }
})

export const selectWalsVarietyAtom = atom(
  null,
  (get, set, choice: { readonly profileId: string; readonly sourceId: string }) => {
    const association = get(walsAssociationsAtom)?.bySource.get(choice.sourceId)
    if (association?.status !== 'associated' || association.atlasId !== choice.profileId)
      return false
    set(walsActionAtom, { type: 'select-variety', ...choice })
    set(mapCameraIntentAtom, null)
    set(languageMapNavigationAtom, null)
    return true
  },
)

/** Synchronous ready-data action: a late catalog/load result never opens a different profile. */
export const inspectWalsObservationAtom = atom(
  null,
  (get, set, selection: { readonly sourceId: string; readonly featureId: string }) => {
    const repository = get(walsRepositoryAtom)
    if (!repository?.index.bySource.get(selection.sourceId)?.has(selection.featureId)) return false
    const association = get(walsAssociationsAtom)?.bySource.get(selection.sourceId)
    set(walsActionAtom, {
      type: 'inspect',
      ...selection,
      ...(association?.status === 'associated' ? { profileId: association.atlasId } : {}),
    })
    // Inspection supersedes pending focus without requesting another camera move.
    set(mapCameraIntentAtom, null)
    set(languageMapNavigationAtom, null)
    if (association?.status === 'associated')
      set(openLanguageDetailsAtom, { languageId: association.atlasId, moveMap: false })
    return true
  },
)

const focusRequestAtom = atom<{ readonly specification: WalsOverlaySpecification } | null>(null)
/** Camera consumers must check this again after any asynchronous work. */
export const walsCameraRequestAtom = atom((get) => {
  const request = get(focusRequestAtom)
  const overlay = get(walsSessionAtom).overlay
  return request &&
    request === get(mapCameraIntentAtom) &&
    request.specification === overlay &&
    overlay?.visible &&
    get(explorerSessionAtom).workspace === 'geography'
    ? request
    : null
})
export const focusWalsExamplesAtom = atom(null, (get, set) => {
  const specification = get(walsSessionAtom).overlay
  if (
    !specification?.visible ||
    !get(walsRepositoryAtom)
      ?.index.bySource.get(specification.sourceId)
      ?.has(specification.featureId)
  )
    return false
  set(explorerActionAtom, { type: 'workspace', workspace: 'geography' })
  const request = { specification }
  set(languageMapNavigationAtom, null)
  set(focusRequestAtom, request)
  set(mapCameraIntentAtom, request)
  return true
})
export const showWalsExamplesAtom = atom(
  null,
  (get, set, selection: { readonly sourceId: string; readonly featureId: string }) => {
    if (!get(walsRepositoryAtom)?.index.bySource.get(selection.sourceId)?.has(selection.featureId))
      return false
    set(isolatedLanguageIdAtom, null)
    set(walsActionAtom, { type: 'show-examples', ...selection })
    return set(focusWalsExamplesAtom)
  },
)
export const setWalsOverlayVisibilityAtom = atom(null, (get, set, visible: boolean) => {
  if (get(mapCameraIntentAtom) === get(focusRequestAtom)) set(mapCameraIntentAtom, null)
  set(focusRequestAtom, null)
  set(walsActionAtom, { type: 'overlay-visibility', visible })
})
export const clearWalsOverlayAtom = atom(null, (get, set) => {
  if (get(mapCameraIntentAtom) === get(focusRequestAtom)) set(mapCameraIntentAtom, null)
  set(focusRequestAtom, null)
  set(walsActionAtom, { type: 'clear-overlay' })
})
