import { atom } from 'jotai'
import type { LanguageMapTarget } from '../domain/languageFocus'
import { mapCameraIntentAtom } from './mapCameraIntent.ts'

export const languageMapNavigationAtom = atom<{
  readonly target: LanguageMapTarget
  readonly requestId: number
} | null>(null)
export const focusLanguageOnMapAtom = atom(null, (get, set, target: LanguageMapTarget) => {
  const request = {
    target,
    requestId: (get(languageMapNavigationAtom)?.requestId ?? 0) + 1,
  }
  set(languageMapNavigationAtom, request)
  set(mapCameraIntentAtom, request)
})

type Preview = { readonly owner: string; readonly target: LanguageMapTarget }
export const languagePointerPreviewAtom = atom<Preview | null>(null)
export const languageKeyboardPreviewAtom = atom<Preview | null>(null)
export const setLanguagePreviewAtom = atom(
  null,
  (
    get,
    set,
    update: {
      readonly kind: 'pointer' | 'keyboard'
      readonly owner: string
      readonly target: LanguageMapTarget | null
    },
  ) => {
    const state =
      update.kind === 'pointer' ? languagePointerPreviewAtom : languageKeyboardPreviewAtom
    if (update.target) set(state, { owner: update.owner, target: update.target })
    else if (get(state)?.owner === update.owner) set(state, null)
  },
)

export type LanguagePanelView = 'explore' | 'map'
export type LanguageDetailOrigin = 'sidebar' | 'map'
export type LanguageDetailPlacement = 'cover' | 'beside'

/** Navigation state is independent of map selection, query, and geography. */
export const languagePanelAtom = atom<{
  readonly view: LanguagePanelView
  readonly detailId: string | null
  readonly detailGroupId: string | null
  readonly detailEntryId: string | null
  readonly detailOrigin: LanguageDetailOrigin
  readonly detailPlacement: LanguageDetailPlacement
  readonly detailPlacementChosen: boolean
}>({
  view: 'explore',
  detailId: null,
  detailGroupId: null,
  detailEntryId: null,
  detailOrigin: 'sidebar',
  detailPlacement: 'beside',
  detailPlacementChosen: false,
})

export const openLanguageDetailsAtom = atom(
  null,
  (get, set, target: string | LanguageMapTarget, origin?: LanguageDetailOrigin) => {
    if (get(mapCameraIntentAtom) === get(languageMapNavigationAtom)) set(mapCameraIntentAtom, null)
    set(languageMapNavigationAtom, null)
    const panel = get(languagePanelAtom)
    set(languagePanelAtom, {
      ...panel,
      detailId: typeof target === 'string' ? target : target.languageId,
      detailGroupId: typeof target === 'string' ? null : (target.groupId ?? null),
      detailEntryId: typeof target === 'string' ? null : (target.entryId ?? null),
      detailOrigin: origin ?? panel.detailOrigin,
      // Entry points set defaults; an explicit move remains in force while inspecting languages.
      detailPlacement:
        panel.detailId && panel.detailPlacementChosen
          ? panel.detailPlacement
          : (origin ?? panel.detailOrigin) === 'map'
            ? 'cover'
            : 'beside',
      detailPlacementChosen: Boolean(panel.detailId && panel.detailPlacementChosen),
    })
  },
)

/** Sidebar identity activation inspects and frames the same representation. */
export const inspectLanguageFromSidebarAtom = atom(
  null,
  (_get, set, target: string | LanguageMapTarget) => {
    set(openLanguageDetailsAtom, target, 'sidebar')
    set(focusLanguageOnMapAtom, typeof target === 'string' ? { languageId: target } : target)
  },
)

export const inspectLanguageFromMapAtom = atom(null, (_get, set, target: LanguageMapTarget) =>
  set(openLanguageDetailsAtom, target, 'map'),
)

export const toggleLanguageDetailPlacementAtom = atom(null, (get, set) => {
  const panel = get(languagePanelAtom)
  if (!panel.detailId) return
  set(languagePanelAtom, {
    ...panel,
    detailPlacement: panel.detailPlacement === 'cover' ? 'beside' : 'cover',
    detailPlacementChosen: true,
  })
})

export const closeLanguageDetailsAtom = atom(null, (get, set) => {
  if (get(mapCameraIntentAtom) === get(languageMapNavigationAtom)) set(mapCameraIntentAtom, null)
  set(languageMapNavigationAtom, null)
  set(languagePanelAtom, {
    ...get(languagePanelAtom),
    detailId: null,
    detailGroupId: null,
    detailEntryId: null,
    detailOrigin: 'sidebar',
    detailPlacement: 'beside',
    detailPlacementChosen: false,
  })
})

/** Explore consumes this request after becoming visible and reveals the complete ancestry. */
export const revealLanguageIdAtom = atom<string | null>(null)
export const revealLanguageAtom = atom(null, (get, set, languageId: string) => {
  set(revealLanguageIdAtom, languageId)
  set(languagePanelAtom, {
    ...get(languagePanelAtom),
    view: 'explore',
    detailOrigin: 'sidebar',
    detailPlacement: 'beside',
    detailPlacementChosen: false,
  })
})
