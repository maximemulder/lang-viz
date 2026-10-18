import { atom } from 'jotai'
import { loadAtlasData } from '../data/atlasRepository'
import type {
  GeographyDatasetId,
  GeometryVariantId,
  LanguageId,
  TemporalViewSelection,
} from '../domain/atlas'

export const atlasDataAtom = atom(async () => loadAtlasData())

export const languageQueryAtom = atom('')
export const geographyDatasetFilterAtom = atom<GeographyDatasetId | 'all'>('all')
export const finderScopeAtom = atom<'world' | 'viewport'>('world')
export const temporalViewAtom = atom<TemporalViewSelection>('all')
export const viewportLanguageIdsAtom = atom<readonly LanguageId[]>([])
export const visibleLanguageIdsAtom = atom<readonly LanguageId[]>([])
export const geometryOverridesAtom = atom<Readonly<Record<LanguageId, GeometryVariantId>>>({})

export const toggleVisibleLanguageAtom = atom(null, (get, set, languageId: LanguageId) => {
  const current = get(visibleLanguageIdsAtom)
  set(
    visibleLanguageIdsAtom,
    current.includes(languageId)
      ? current.filter((id) => id !== languageId)
      : [...current, languageId],
  )
})

export const showLanguagesAtom = atom(null, (get, set, languageIds: readonly LanguageId[]) => {
  set(visibleLanguageIdsAtom, [...new Set([...get(visibleLanguageIdsAtom), ...languageIds])])
})

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
