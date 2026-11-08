import { atom } from 'jotai'

export type LanguagePanelView = 'explore' | 'map' | 'details'

/** Navigation state is independent of map selection, query, and geography. */
export const languagePanelAtom = atom<{
  readonly view: LanguagePanelView
  readonly detailId: string | null
  readonly detailEntryId: string | null
  readonly returnView: 'explore' | 'map'
}>({ view: 'explore', detailId: null, detailEntryId: null, returnView: 'explore' })

export const openLanguageDetailsAtom = atom(
  null,
  (get, set, target: string | { languageId: string; entryId: string }) => {
    const panel = get(languagePanelAtom)
    set(languagePanelAtom, {
      view: 'details',
      detailId: typeof target === 'string' ? target : target.languageId,
      detailEntryId: typeof target === 'string' ? null : target.entryId,
      returnView: panel.view === 'details' ? panel.returnView : panel.view,
    })
  },
)

/** Explore consumes this request after becoming visible and reveals the complete ancestry. */
export const revealLanguageIdAtom = atom<string | null>(null)
export const revealLanguageAtom = atom(null, (get, set, languageId: string) => {
  set(revealLanguageIdAtom, languageId)
  set(languagePanelAtom, { ...get(languagePanelAtom), view: 'explore' })
})
