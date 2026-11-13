import { atom } from 'jotai'
import { walsSessionAtom } from '../features/wals/state.ts'
/** Temporary paint state. Pinned entries, source geometry and selections stay intact. */
export const isolatedLanguageIdAtom = atom<string | null>(null)
export const mapContextOpacityAtom = atom((get) =>
  get(isolatedLanguageIdAtom) ? 0 : get(walsSessionAtom).overlay?.visible ? 0.16 : 1,
)
