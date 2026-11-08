import { atom } from 'jotai'
import { unwrap } from 'jotai/utils'
import { loadAtlasData } from '../data/atlasRepository'
import {
  type AreaMode,
  areaMode,
  buildGeographyAvailability,
  type GeographyAvailability,
  mappedLeavesForLanguages,
  resolveMapAreas,
} from '../domain/aggregation'
import type {
  GeographyDatasetSelection,
  GeometryVariantId,
  LanguageId,
  TemporalViewSelection,
} from '../domain/atlas'
import { buildLanguageHierarchy } from '../domain/hierarchy'

export const atlasDataAtom = atom(async () => loadAtlasData())

export const languageQueryAtom = atom('')
export const geographyDatasetFilterAtom = atom<GeographyDatasetSelection>('all')
export const finderScopeAtom = atom<'world' | 'viewport'>('world')
export const temporalViewAtom = atom<TemporalViewSelection>('all')
export const viewportLanguageIdsAtom = atom<readonly LanguageId[]>([])
export const visibleLanguageIdsAtom = atom<readonly LanguageId[]>([])
export const geometryOverridesAtom = atom<Readonly<Record<LanguageId, GeometryVariantId>>>({})
export const areaModesAtom = atom<Readonly<Record<LanguageId, AreaMode>>>({})
const resolvedAtlasDataAtom = unwrap(atlasDataAtom)
export const languageHierarchyAtom = atom((get) =>
  buildLanguageHierarchy(get(resolvedAtlasDataAtom)?.languages ?? []),
)
export const geographyAvailabilityAtom = atom((get) => {
  const data = get(resolvedAtlasDataAtom)
  return data
    ? buildGeographyAvailability(
        data,
        get(languageHierarchyAtom),
        get(temporalViewAtom),
        get(geographyDatasetFilterAtom),
        get(geometryOverridesAtom),
      )
    : new Map<string, GeographyAvailability>()
})
export const selectedMapAreasAtom = atom((get) =>
  resolveMapAreas(get(visibleLanguageIdsAtom), get(geographyAvailabilityAtom), get(areaModesAtom)),
)
export const overlapModeAtom = atom<'hatching' | 'blending'>('hatching')
export const languageOpacityAtom = atom(0.82)
export const overlapStatusAtom = atom<{
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  readonly message: string
}>({ status: 'idle', message: '' })

export const toggleVisibleLanguageAtom = atom(null, (get, set, languageId: LanguageId) => {
  const current = get(visibleLanguageIdsAtom)
  const available = get(geographyAvailabilityAtom).get(languageId)
  if (!current.includes(languageId) && available) {
    const modes = get(areaModesAtom)
    set(areaModesAtom, { ...modes, [languageId]: areaMode(available, modes[languageId]) })
  }
  set(
    visibleLanguageIdsAtom,
    current.includes(languageId)
      ? current.filter((id) => id !== languageId)
      : [...current, languageId],
  )
})

export const showLanguagesAtom = atom(null, (get, set, languageIds: readonly LanguageId[]) => {
  const modes = { ...get(areaModesAtom) }
  const availability = get(geographyAvailabilityAtom)
  for (const id of languageIds) {
    const available = availability.get(id)
    if (available) modes[id] = areaMode(available, modes[id])
  }
  set(areaModesAtom, modes)
  set(visibleLanguageIdsAtom, [...new Set([...get(visibleLanguageIdsAtom), ...languageIds])])
})

export const showMappedLeavesAtom = atom(
  null,
  (get, set, roots: LanguageId | readonly LanguageId[]) => {
    const leaves = mappedLeavesForLanguages(
      typeof roots === 'string' ? [roots] : roots,
      get(languageHierarchyAtom),
      get(geographyAvailabilityAtom),
    )
    if (!leaves.languageIds.length) return
    const modes = { ...get(areaModesAtom) }
    for (const id of leaves.languageIds) modes[id] = 'own'
    set(areaModesAtom, modes)
    set(visibleLanguageIdsAtom, [
      ...get(visibleLanguageIdsAtom).filter((id) => !leaves.subtreeIds.has(id)),
      ...leaves.languageIds,
    ])
  },
)

export const setGeometryOverrideAtom = atom(
  null,
  (
    get,
    set,
    update: { readonly languageId: LanguageId; readonly variantId: GeometryVariantId },
  ) => {
    set(geometryOverridesAtom, {
      ...get(geometryOverridesAtom),
      [update.languageId]: update.variantId,
    })
  },
)
