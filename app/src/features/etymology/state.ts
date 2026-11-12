import { atom } from 'jotai'
import type { EtymologyRepository } from '../../domain/etymology.ts'
import { explorerSessionAtom } from '../../state/explorerState.ts'
import { deriveWordTrail, resolveExplorerSession } from './session.ts'

/** Ready data is published by the data loader; it never initializes or rewrites navigation. */
export const etymologyRepositoryAtom = atom<EtymologyRepository | null>(null)

export const trailSpecificationAtom = atom((get) => get(explorerSessionAtom).trail)
export const wordTrailAtom = atom((get) => {
  const repository = get(etymologyRepositoryAtom)
  return repository ? deriveWordTrail(repository, get(trailSpecificationAtom)) : null
})
/** Same derived object as the graph; never a saved overlay snapshot. */
export const atlasWordTrailAtom = atom((get) =>
  get(explorerSessionAtom).overlay.enabled ? get(wordTrailAtom) : null,
)
export const resolvedExplorerAtom = atom((get) => {
  const repository = get(etymologyRepositoryAtom)
  return repository ? resolveExplorerSession(get(explorerSessionAtom), repository) : null
})
