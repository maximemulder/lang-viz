import { atom } from 'jotai'
import {
  createExplorerSession,
  deriveWordTrail,
  type ExplorerAction,
  reduceExplorerSession,
  resolveExplorerSession,
} from '../domain/explorerSession.ts'
import { etymologyRepositoryAtom } from './etymologyData.ts'
import { languageMapNavigationAtom } from './languageControls.ts'
import { mapCameraIntentAtom } from './mapCameraIntent.ts'

const sessionAtom = atom(createExplorerSession())
/** Store-scoped session survives workspace component lifecycles. */
export const explorerSessionAtom = atom((get) => get(sessionAtom))
export const explorerActionAtom = atom(null, (get, set, action: ExplorerAction) => {
  const previous = get(sessionAtom)
  const next = reduceExplorerSession(previous, action)
  if (action.type === 'show-trail' && next !== previous) {
    set(languageMapNavigationAtom, null)
    set(mapCameraIntentAtom, next.overlay.focusRequest)
  } else if (
    previous.workspace !== next.workspace ||
    (previous.overlay.focusRequest !== next.overlay.focusRequest &&
      get(mapCameraIntentAtom) === previous.overlay.focusRequest)
  ) {
    set(mapCameraIntentAtom, null)
  }
  set(sessionAtom, next)
})
export const explorerRouteIssuesAtom = atom<readonly string[]>([])
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
