import { atom } from 'jotai'
import type { LanguageId } from '../domain/atlas'
import {
  addMapGroupEntries,
  buildMapGroupEntries,
  type GroupColoring,
  groupMapEntries,
  hasCoverage,
  type MapCoverage,
} from '../domain/mapGroups'
import { walsActionAtom } from '../features/wals/state.ts'
import {
  colorTopologyAtom,
  geographyAvailabilityAtom,
  geographyContextAtom,
  languageHierarchyAtom,
  mapEntriesAtom,
} from './atlasState'
import { closeLanguageDetailsAtom } from './languageControls.ts'
import {
  clearMapIsolationAtom,
  focusMapSelectionAtom,
  mapColorsVisibleAtom,
} from './mapInteraction.ts'

/** A working selection; browsing or checking a result never changes the map. */
export const searchSelectionAtom = atom<readonly LanguageId[]>([])
export const searchCoverageAtom = atom<MapCoverage>('branch')
export const searchColoringAtom = atom<GroupColoring>('hierarchy')

export const toggleSearchSelectionAtom = atom(null, (get, set, id: LanguageId) => {
  const selected = get(searchSelectionAtom)
  set(
    searchSelectionAtom,
    selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id],
  )
})

export const selectSearchResultsAtom = atom(null, (get, set, ids: readonly LanguageId[]) => {
  set(searchSelectionAtom, [...new Set([...get(searchSelectionAtom), ...ids])])
})

export const addSearchSelectionToMapAtom = atom(null, (get, set) => {
  const selected = get(searchSelectionAtom)
  const availability = get(geographyAvailabilityAtom)
  const coverage = get(searchCoverageAtom)
  const candidates = buildMapGroupEntries(
    selected,
    get(languageHierarchyAtom),
    availability,
    get(geographyContextAtom),
    coverage,
    get(searchColoringAtom),
    get(colorTopologyAtom),
  )
  const current = get(mapEntriesAtom)
  const next = addMapGroupEntries(current, candidates)
  set(mapEntriesAtom, next)
  return {
    addedGroups: groupMapEntries(next).length - groupMapEntries(current).length,
    addedAreas: next.length - current.length,
    unavailable: selected.filter((id) => !hasCoverage(availability.get(id), coverage)).length,
  }
})

/** Show selected entries as the current map, rather than silently adding duplicates
 * to the initial all-language view. Existing source geometry/colours are reused. */
export const showSearchSelectionOnMapAtom = atom(null, (get, set) => {
  const selected = get(searchSelectionAtom)
  const candidates = buildMapGroupEntries(
    selected,
    get(languageHierarchyAtom),
    get(geographyAvailabilityAtom),
    get(geographyContextAtom),
    'branch',
    'hierarchy',
    get(colorTopologyAtom),
  )
  if (!candidates.length) return 0
  set(clearMapIsolationAtom)
  set(mapColorsVisibleAtom, true)
  set(walsActionAtom, { type: 'clear-overlay' })
  set(closeLanguageDetailsAtom)
  set(mapEntriesAtom, candidates)
  set(focusMapSelectionAtom, [...new Set(candidates.flatMap((entry) => entry.variantIds))])
  return candidates.length
})
export const showAllMapColorsAtom = atom(null, (get, set) => {
  set(clearMapIsolationAtom)
  set(mapColorsVisibleAtom, true)
  set(walsActionAtom, { type: 'clear-overlay' })
  set(
    mapEntriesAtom,
    buildMapGroupEntries(
      get(languageHierarchyAtom).roots.map(({ id }) => id),
      get(languageHierarchyAtom),
      get(geographyAvailabilityAtom),
      get(geographyContextAtom),
      'branch',
      'hierarchy',
      get(colorTopologyAtom),
    ),
  )
})
export const clearMapColorsAtom = atom(null, (_get, set) => {
  set(clearMapIsolationAtom)
  set(mapColorsVisibleAtom, false)
})
