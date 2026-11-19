import { atom } from 'jotai'
import { walsSessionAtom } from '../features/wals/state.ts'
import { mapCameraIntentAtom } from './mapCameraIntent.ts'

export type MapIsolation =
  | {
      readonly kind: 'language'
      readonly id: string
      readonly label: string
      readonly color: string
    }
  | {
      readonly kind: 'region'
      readonly id: string
      readonly label: string
      readonly color: string
      readonly featureIds: readonly string[]
    }

/** Isolation is temporary paint state. It never edits pinned groups or their colours. */
export const mapColorsVisibleAtom = atom(true)
export const regionIsolationReadyAtom = atom(false)
export const mapIsolationAtom = atom<MapIsolation | null>(null)
export const isolationOverviewRequestAtom = atom<{ readonly requestId: number } | null>(null)
export const isolateMapAtom = atom(null, (get, set, isolation: MapIsolation) => {
  set(mapColorsVisibleAtom, true)
  set(regionIsolationReadyAtom, false)
  set(mapIsolationAtom, isolation)
  const request = { requestId: (get(isolationOverviewRequestAtom)?.requestId ?? 0) + 1 }
  set(isolationOverviewRequestAtom, request)
  set(mapCameraIntentAtom, request)
})
export const clearMapIsolationAtom = atom(null, (get, set) => {
  if (get(mapCameraIntentAtom) === get(isolationOverviewRequestAtom)) set(mapCameraIntentAtom, null)
  set(mapIsolationAtom, null)
  set(isolationOverviewRequestAtom, null)
})
export const setIsolationColorAtom = atom(null, (get, set, color: string) => {
  const isolation = get(mapIsolationAtom)
  if (isolation && /^#[0-9a-f]{6}$/i.test(color)) set(mapIsolationAtom, { ...isolation, color })
})
export const mapContextOpacityAtom = atom((get) => {
  if (!get(mapColorsVisibleAtom)) return 0
  const isolation = get(mapIsolationAtom)
  if (isolation?.kind === 'language') return 0
  if (isolation?.kind === 'region') return get(regionIsolationReadyAtom) ? 1 : 0
  return get(walsSessionAtom).overlay?.visible ? 0.16 : 1
})

export const mapSelectionFocusAtom = atom<{ readonly variantIds: readonly string[] } | null>(null)
export const focusMapSelectionAtom = atom(null, (_get, set, variantIds: readonly string[]) => {
  const request = { variantIds }
  set(mapSelectionFocusAtom, request)
  set(mapCameraIntentAtom, request)
})
