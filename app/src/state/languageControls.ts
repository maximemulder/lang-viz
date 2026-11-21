import { atom } from 'jotai'
import type { LanguageMapTarget } from '../domain/languageFocus'
import {
  type DetailPanelLayout,
  type DetailPanelOrigin,
  moveDetailPanel,
  openDetailPanel,
} from './detailPanelLayout.ts'
import { mapCameraIntentAtom } from './mapCameraIntent.ts'

export const languageMapNavigationAtom = atom<{
  readonly target: LanguageMapTarget
  readonly variantIds?: readonly string[]
  readonly requestId: number
} | null>(null)
export const focusLanguageOnMapAtom = atom(
  null,
  (get, set, target: LanguageMapTarget, variantIds?: readonly string[]) => {
    const request = {
      target,
      ...(variantIds ? { variantIds } : {}),
      requestId: (get(languageMapNavigationAtom)?.requestId ?? 0) + 1,
    }
    set(languageMapNavigationAtom, request)
    set(mapCameraIntentAtom, request)
    return request
  },
)

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

/** Navigation state is independent of map selection, query, and geography. */
export const languagePanelAtom = atom<{
  readonly view: LanguagePanelView
  readonly detailId: string | null
  readonly detailGroupId: string | null
  readonly detailEntryId: string | null
  readonly detailLayout: DetailPanelLayout | null
}>({
  view: 'explore',
  detailId: null,
  detailGroupId: null,
  detailEntryId: null,
  detailLayout: null,
})

export const openLanguageDetailsAtom = atom(
  null,
  (get, set, target: string | LanguageMapTarget, origin?: DetailPanelOrigin) => {
    if (get(mapCameraIntentAtom) === get(languageMapNavigationAtom)) set(mapCameraIntentAtom, null)
    set(languageMapNavigationAtom, null)
    const panel = get(languagePanelAtom)
    set(languagePanelAtom, {
      ...panel,
      detailId: typeof target === 'string' ? target : target.languageId,
      detailGroupId: typeof target === 'string' ? null : (target.groupId ?? null),
      detailEntryId: typeof target === 'string' ? null : (target.entryId ?? null),
      detailLayout: openDetailPanel(panel.detailLayout, origin),
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
  if (!panel.detailLayout) return
  set(languagePanelAtom, {
    ...panel,
    detailLayout: moveDetailPanel(panel.detailLayout),
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
    detailLayout: null,
  })
})

/** Explore consumes this request after becoming visible and reveals the complete ancestry. */
export const revealLanguageIdAtom = atom<string | null>(null)
export const revealLanguageAtom = atom(null, (get, set, languageId: string) => {
  const panel = get(languagePanelAtom)
  set(revealLanguageIdAtom, languageId)
  set(languagePanelAtom, {
    ...panel,
    view: 'explore',
    detailLayout: panel.detailId ? openDetailPanel(null, 'sidebar') : null,
  })
})
