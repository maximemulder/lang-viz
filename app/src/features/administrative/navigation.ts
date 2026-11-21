import { atom } from 'jotai'
import { explorerSessionAtom } from '../../state/explorerState.ts'
import { mapCameraIntentAtom } from '../../state/mapCameraIntent.ts'
import { mapIsolationAtom } from '../../state/mapInteraction.ts'
import { loadBoundaryIndex } from './boundaryRepository.ts'
import {
  type AdministrativeSelection,
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
    if (!set(selectAdministrativeAtom, selection, 'sidebar') || selection.kind !== 'territory')
      return
    const stillSelected = () =>
      get(administrativeSessionAtom).selection === selection &&
      get(explorerSessionAtom).workspace === 'map' &&
      get(explorerSessionAtom).mapMode === 'region'
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
  set(mapIsolationAtom, { kind: 'region', featureIds, label, cameraRequest })
})
