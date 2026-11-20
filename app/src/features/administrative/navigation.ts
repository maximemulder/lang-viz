import { atom } from 'jotai'
import { atlasDataAtom } from '../../state/atlasState.ts'
import { explorerActionAtom, explorerSessionAtom } from '../../state/explorerState.ts'
import { openLanguageDetailsAtom } from '../../state/languageControls.ts'
import { mapCameraIntentAtom } from '../../state/mapCameraIntent.ts'
import { mapIsolationAtom } from '../../state/mapInteraction.ts'
import { loadBoundaryIndex } from './boundaryRepository.ts'
import {
  type AdministrativeSelection,
  administrativeRepositoryAtom,
  administrativeSessionAtom,
  boundaryIndexAtom,
  checkedTerritoriesAtom,
  focusAdministrativeFeaturesAtom,
  focusAdministrativeTerritoryAtom,
  selectAdministrativeAtom,
} from './state.ts'

export const inspectAdministrativeFromSidebarAtom = atom(
  null,
  async (get, set, selection: AdministrativeSelection) => {
    if (!set(selectAdministrativeAtom, selection)) return
    const stillSelected = () =>
      get(administrativeSessionAtom).selection === selection &&
      get(explorerSessionAtom).workspace === 'map' &&
      get(explorerSessionAtom).mapMode === 'region'
    if (selection.kind === 'territory') {
      if (get(boundaryIndexAtom)) {
        set(focusAdministrativeTerritoryAtom, selection.id)
        return
      }
      const intent = {}
      set(mapCameraIntentAtom, intent)
      try {
        const index = await loadBoundaryIndex()
        if (stillSelected() && get(mapCameraIntentAtom) === intent) {
          set(boundaryIndexAtom, index)
          set(focusAdministrativeTerritoryAtom, selection.id)
        }
      } catch {
        // BoundaryLayer reports load failures and allows retry.
      } finally {
        if (get(mapCameraIntentAtom) === intent) set(mapCameraIntentAtom, null)
      }
    } else if (selection.kind === 'language') {
      const glottocode = get(administrativeRepositoryAtom)?.languageByCode.get(
        selection.id,
      )?.glottocode
      if (!glottocode) return
      const atlas = await get(atlasDataAtom).catch(() => null)
      if (!atlas?.languageById.has(glottocode) || !stillSelected()) return
      set(explorerActionAtom, { type: 'map-mode', mode: 'language' })
      set(openLanguageDetailsAtom, glottocode, 'map')
    }
  },
)

export const showCheckedTerritoriesAtom = atom(null, (get, set, label: string) => {
  const index = get(boundaryIndexAtom)
  const featureIds = [
    ...new Set(
      get(checkedTerritoriesAtom).flatMap((code) => {
        const association = index?.associations.get(code)
        return association?.status === 'matched' ? association.featureIds : []
      }),
    ),
  ]
  if (!featureIds.length) return
  const cameraRequest = set(focusAdministrativeFeaturesAtom, featureIds)
  set(mapIsolationAtom, { kind: 'region', featureIds, label, cameraRequest, colorsVisible: true })
})
