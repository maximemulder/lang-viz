import { atom } from 'jotai'

export type LanguageSummarySection = 'genealogy' | 'areas' | 'map' | 'features' | 'etymology'

/** Disclosure preferences belong to the summary, not to an individual language. */
export const languageSummarySectionsAtom = atom<Record<LanguageSummarySection, boolean>>({
  genealogy: true,
  areas: false,
  map: false,
  features: false,
  etymology: false,
})

export const setLanguageSummarySectionAtom = atom(
  null,
  (get, set, section: LanguageSummarySection, expanded: boolean) =>
    set(languageSummarySectionsAtom, { ...get(languageSummarySectionsAtom), [section]: expanded }),
)
