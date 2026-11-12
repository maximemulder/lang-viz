import { atom } from 'jotai'
import {
  createExplorerSession,
  type ExplorerAction,
  reduceExplorerSession,
} from '../domain/explorerSession.ts'
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
