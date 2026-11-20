import { atom } from 'jotai'
import { mapCameraIntentAtom } from './mapCameraIntent.ts'

export interface RegionHit {
  readonly featureId: string
  readonly sourceName: string
  readonly territoryCode: string | null
  readonly longitude: number
  readonly latitude: number
}

export type MapIsolation = {
  readonly label: string
  readonly cameraRequest: object
  readonly colorsVisible: boolean
} & (
  | { readonly kind: 'language'; readonly variantIds: readonly string[]; readonly color: string }
  | { readonly kind: 'region'; readonly featureIds: readonly string[] }
)

const normalMapColorsVisibleAtom = atom(true)
export const mapIsolationAtom = atom<MapIsolation | null>(null)
export const mapColorsVisibleAtom = atom(
  (get) => get(mapIsolationAtom)?.colorsVisible ?? get(normalMapColorsVisibleAtom),
  (get, set, visible: boolean) => {
    const isolation = get(mapIsolationAtom)
    if (isolation) set(mapIsolationAtom, { ...isolation, colorsVisible: visible })
    else set(normalMapColorsVisibleAtom, visible)
  },
)
export const readyRegionMaskAtom = atom<readonly string[] | null>(null)
export const clearMapIsolationAtom = atom(null, (get, set) => {
  const isolation = get(mapIsolationAtom)
  if (isolation && get(mapCameraIntentAtom) === isolation.cameraRequest)
    set(mapCameraIntentAtom, null)
  set(mapIsolationAtom, null)
  set(readyRegionMaskAtom, null)
})
export const setIsolationColorAtom = atom(null, (get, set, color: string) => {
  const isolation = get(mapIsolationAtom)
  if (isolation?.kind === 'language') set(mapIsolationAtom, { ...isolation, color })
})

export const mapContextOpacityAtom = atom((get) => {
  if (!get(mapColorsVisibleAtom)) return 0
  const isolation = get(mapIsolationAtom)
  if (isolation?.kind === 'language') return 0
  if (isolation?.kind === 'region') return get(readyRegionMaskAtom) === isolation.featureIds ? 1 : 0
  return 1
})
