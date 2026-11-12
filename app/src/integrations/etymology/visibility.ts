import { atom } from 'jotai'
import { explorerSessionAtom } from '../../state/explorerState.ts'
import { mapCameraIntentAtom } from '../../state/mapCameraIntent.ts'

const hiddenSequenceAtom = atom<number | null>(null)
/** Hide retains the trail. A new explicit show/focus sequence makes it visible again. */
export const wordTrailVisibleAtom = atom(
  (get) => get(hiddenSequenceAtom) !== get(explorerSessionAtom).overlay.focusSequence,
  (get, set, visible: boolean) => {
    const overlay = get(explorerSessionAtom).overlay
    set(hiddenSequenceAtom, visible ? null : overlay.focusSequence)
    if (!visible && get(mapCameraIntentAtom) === overlay.focusRequest)
      set(mapCameraIntentAtom, null)
  },
)
