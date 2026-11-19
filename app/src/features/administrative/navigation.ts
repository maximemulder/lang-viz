import { atom } from 'jotai'
import { atlasDataAtom } from '../../state/atlasState.ts'
import { explorerActionAtom } from '../../state/explorerState.ts'
import { focusLanguageOnMapAtom, openLanguageDetailsAtom } from '../../state/languageControls.ts'
import { mapCameraIntentAtom } from '../../state/mapCameraIntent.ts'
import { isolateMapAtom } from '../../state/mapInteraction.ts'
import { showAllMapColorsAtom } from '../../state/searchSelection.ts'
import { loadBoundaryIndex } from './boundaryRepository.ts'
import {
  type AdministrativeSelection,
  administrativeRepositoryAtom,
  administrativeSessionAtom,
  boundaryIndexAtom,
  checkedTerritoriesAtom,
  focusAdministrativeShapeAtom,
  focusAdministrativeTerritoryAtom,
  selectAdministrativeAtom,
} from './state.ts'

/** Region-to-language navigation uses only the reviewed CLDR ↔ Glottolog link.
 * Administrative speaker estimates never become language polygons.
 */
export const navigateAdministrativeAtom = atom(
  null,
  async (get, set, selection: AdministrativeSelection) => {
    if (!set(selectAdministrativeAtom, selection)) return
    if (selection.kind === 'territory' || selection.kind === 'source-shape') {
      return
    }
    if (selection.kind !== 'language') return
    const source = get(administrativeRepositoryAtom)?.languageByCode.get(selection.id)
    if (!source?.glottocode) return
    const atlas = await get(atlasDataAtom)
    const current = get(administrativeSessionAtom).selection
    if (current?.kind !== 'language' || current.id !== selection.id) return
    const language = atlas.languageById.get(source.glottocode)
    if (!language) return
    set(explorerActionAtom, { type: 'map-mode', mode: 'language' })
    set(openLanguageDetailsAtom, language.id, 'map')
  },
)

/** Only a deliberate zoom action moves the administrative camera. */
export const zoomAdministrativeAtom = atom(
  null,
  async (get, set, selection: AdministrativeSelection) => {
    await set(navigateAdministrativeAtom, selection)
    const current = get(administrativeSessionAtom).selection
    if (current?.kind !== selection.kind || current.id !== selection.id) return
    if (selection.kind === 'language') {
      const id = get(administrativeRepositoryAtom)?.languageByCode.get(selection.id)?.glottocode
      if (id) set(focusLanguageOnMapAtom, { languageId: id })
      return
    }
    if (selection.kind === 'family') return
    const pending = { source: 'region-zoom', id: selection.id }
    set(mapCameraIntentAtom, pending)
    try {
      if (!get(boundaryIndexAtom)) set(boundaryIndexAtom, await loadBoundaryIndex())
      if (get(mapCameraIntentAtom) !== pending) return
      if (selection.kind === 'territory') set(focusAdministrativeTerritoryAtom, selection.id)
      else if (selection.kind === 'source-shape') set(focusAdministrativeShapeAtom, selection.id)
    } catch {
      if (get(mapCameraIntentAtom) === pending) set(mapCameraIntentAtom, null)
    }
  },
)

/** Region checkboxes use the explicit country mask. */
export const showCheckedTerritoriesAtom = atom(null, (get, set) => {
  const index = get(boundaryIndexAtom)
  const codes = get(checkedTerritoriesAtom).filter(
    (code) => index?.associations.get(code)?.status === 'matched',
  )
  if (!codes.length) return false
  const featureIds = [
    ...new Set(codes.flatMap((code) => index?.associations.get(code)?.featureIds ?? [])),
  ]
  const names = new Intl.DisplayNames(['en'], { type: 'region' })
  const first = codes[0]
  if (!first) return false
  set(showAllMapColorsAtom)
  set(selectAdministrativeAtom, { kind: 'territory', id: first })
  set(isolateMapAtom, {
    kind: 'region',
    id: codes.join('|'),
    label:
      codes.length === 1
        ? (names.of(first) ?? first)
        : `${names.of(first) ?? first} + ${codes.length - 1} ${codes.length === 2 ? 'region' : 'regions'}`,
    color: '#df7546',
    featureIds,
  })
  return true
})
export const isolateAdministrativeTerritoryAtom = atom(null, (get, set, code: string) => {
  if (get(boundaryIndexAtom)?.associations.get(code)?.status !== 'matched') return
  set(checkedTerritoriesAtom, [code])
  set(showCheckedTerritoriesAtom)
})
