import { atom } from 'jotai'
import type { EtymologyRepository } from '../domain/etymology.ts'

/** Ready data is published by the data loader; it never initializes or rewrites navigation. */
export const etymologyRepositoryAtom = atom<EtymologyRepository | null>(null)
