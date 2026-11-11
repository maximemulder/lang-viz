import { atom } from 'jotai'

/** Identity of the latest explicit camera action, shared by atlas and lexical navigation. */
export const mapCameraIntentAtom = atom<object | null>(null)
