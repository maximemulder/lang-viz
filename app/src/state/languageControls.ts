import { atom } from 'jotai'

export type LanguagePanelView = 'explore' | 'map'

/** Navigation state is independent of map selection, query, and geography. */
export const languagePanelAtom = atom<{
  readonly view: LanguagePanelView
  readonly detailId: string | null
  readonly detailEntryId: string | null
  readonly detailCollapsed: boolean
}>({ view: 'explore', detailId: null, detailEntryId: null, detailCollapsed: false })

export const openLanguageDetailsAtom = atom(
  null,
  (get, set, target: string | { languageId: string; entryId: string }) => {
    const panel = get(languagePanelAtom)
    set(languagePanelAtom, {
      ...panel,
      detailId: typeof target === 'string' ? target : target.languageId,
      detailEntryId: typeof target === 'string' ? null : target.entryId,
      detailCollapsed: false,
    })
  },
)

export const closeLanguageDetailsAtom = atom(null, (get, set) => {
  set(languagePanelAtom, {
    ...get(languagePanelAtom),
    detailId: null,
    detailEntryId: null,
    detailCollapsed: false,
  })
})

export const geographyFiltersRequestedAtom = atom(false)
export const editGeographyFiltersAtom = atom(null, (get, set) => {
  set(languagePanelAtom, { ...get(languagePanelAtom), view: 'explore' })
  set(geographyFiltersRequestedAtom, true)
})

/** Explore consumes this request after becoming visible and reveals the complete ancestry. */
export const revealLanguageIdAtom = atom<string | null>(null)
export const revealLanguageAtom = atom(null, (get, set, languageId: string) => {
  set(revealLanguageIdAtom, languageId)
  set(languagePanelAtom, { ...get(languagePanelAtom), view: 'explore' })
})
