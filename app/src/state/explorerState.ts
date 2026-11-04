import { atom } from 'jotai'
import type { Language } from '../domain/atlas'
import type { EtymologyData, WordTrail } from '../domain/etymology'

const fragment = new URLSearchParams(window.location.hash.slice(1))
export const workspaceAtom = atom<'geography' | 'etymology'>(
  fragment.has('word') ? 'etymology' : 'geography',
)
export const wordFocusAtom = atom(fragment.get('word') ?? '69562')
export const wordViewAtom = atom<'history' | 'family'>(
  fragment.get('view') === 'family' ? 'family' : 'history',
)
export const lexicalLanguageRequestAtom = atom<Language | null>(null)
export const openLanguageWordsAtom = atom(null, (_get, set, language: Language) => {
  set(lexicalLanguageRequestAtom, language)
  set(workspaceAtom, 'etymology')
})
export interface AtlasWordTrail {
  readonly data: EtymologyData
  readonly trail: WordTrail
  readonly root: string
}
export const atlasWordTrailAtom = atom<AtlasWordTrail | null>(null)
