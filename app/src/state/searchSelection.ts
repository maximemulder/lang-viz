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
import {
  colorTopologyAtom,
  geographyAvailabilityAtom,
  geographyContextAtom,
  languageHierarchyAtom,
  mapEntriesAtom,
} from './atlasState'

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
