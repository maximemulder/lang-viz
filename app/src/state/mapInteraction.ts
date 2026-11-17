import { atom } from 'jotai'
import { walsSessionAtom } from '../features/wals/state.ts'
export const mapContextOpacityAtom = atom((get) =>
  get(walsSessionAtom).overlay?.visible ? 0.16 : 1,
)
