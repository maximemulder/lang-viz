import { atom } from 'jotai'
import type { LanguageDetailPlacement } from '../../state/languageControls.ts'
import { mapCameraIntentAtom } from '../../state/mapCameraIntent.ts'
import type { BoundaryIndex } from './boundaryRepository.ts'
import type { AdministrativeRepository } from './model.ts'
import { loadAdministrative } from './repository.ts'
import type { AdministrativeMetric } from './selectors.ts'

export const administrativeRepositoryAtom = atom<AdministrativeRepository | null>(null)
export const administrativeLoadStateAtom = atom<{
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  readonly message: string
}>({ status: 'idle', message: '' })
const pendingAtom = atom<Promise<void> | null>(null)

/** The supplement is requested only when the Administrative panel mounts. */
export const loadAdministrativeAtom = atom(
  null,
  (get, set, load: () => Promise<AdministrativeRepository> = loadAdministrative): Promise<void> => {
    if (get(administrativeRepositoryAtom)) return Promise.resolve()
    const pending = get(pendingAtom)
    if (pending) return pending
    set(administrativeLoadStateAtom, { status: 'loading', message: '' })
    const work = Promise.resolve()
      .then(load)
      .then((repository) => {
        set(administrativeRepositoryAtom, repository)
        set(administrativeLoadStateAtom, { status: 'ready', message: '' })
      })
      .catch((error: unknown) => {
        set(administrativeLoadStateAtom, {
          status: 'error',
          message: error instanceof Error ? error.message : 'Could not load administrative data.',
        })
      })
      .finally(() => set(pendingAtom, null))
    set(pendingAtom, work)
    return work
  },
)

export type AdministrativeSelection =
  | { readonly kind: 'territory'; readonly id: string }
  | { readonly kind: 'language'; readonly id: string }
  | { readonly kind: 'family'; readonly id: string }
  | { readonly kind: 'source-shape'; readonly id: string }

export type AdministrativeSearchKind = 'territory' | 'language' | 'family'

export interface AdministrativeSession {
  readonly query: string
  readonly searchKind: AdministrativeSearchKind
  readonly selection: AdministrativeSelection | null
  readonly metric: AdministrativeMetric | null
}

export const administrativeSessionAtom = atom<AdministrativeSession>({
  query: '',
  searchKind: 'territory',
  selection: null,
  metric: null,
})
export const administrativeLanguagePlacementAtom = atom<LanguageDetailPlacement>('beside')
export const toggleAdministrativeLanguagePlacementAtom = atom(null, (get, set) => {
  if (get(administrativeSessionAtom).selection?.kind !== 'language') return
  set(
    administrativeLanguagePlacementAtom,
    get(administrativeLanguagePlacementAtom) === 'cover' ? 'beside' : 'cover',
  )
})

/** Languages mode remembers its optional borders across mode switches. */
export const languageBordersAtom = atom(false)
export const hoveredAdministrativeRegionAtom = atom<string | null>(null)
export const boundaryIndexAtom = atom<BoundaryIndex | null>(null)

export const setAdministrativeQueryAtom = atom(null, (get, set, query: string) =>
  set(administrativeSessionAtom, { ...get(administrativeSessionAtom), query }),
)
export const setAdministrativeSearchKindAtom = atom(
  null,
  (get, set, searchKind: AdministrativeSearchKind) =>
    set(administrativeSessionAtom, { ...get(administrativeSessionAtom), searchKind, query: '' }),
)
export const selectAdministrativeAtom = atom(
  null,
  (get, set, selection: AdministrativeSelection | null) => {
    if (selection) {
      if (selection.kind === 'source-shape') {
        if (!get(boundaryIndexAtom)?.features.some((feature) => feature.featureId === selection.id))
          return false
      } else {
        const repository = get(administrativeRepositoryAtom)
        if (
          !repository ||
          !(selection.kind === 'territory'
            ? repository.territoryByCode.has(selection.id)
            : selection.kind === 'language'
              ? repository.languageByCode.has(selection.id)
              : repository.familyById.has(selection.id))
        )
          return false
      }
    }
    if (get(administrativeSessionAtom).selection?.kind !== 'language')
      set(administrativeLanguagePlacementAtom, 'beside')
    set(administrativeSessionAtom, { ...get(administrativeSessionAtom), selection })
    return true
  },
)
export const setAdministrativeMetricAtom = atom(
  null,
  (get, set, metric: AdministrativeMetric | null) => {
    const repository = get(administrativeRepositoryAtom)
    if (
      metric &&
      (!repository ||
        (metric.kind === 'language-estimate' &&
          !repository.languageByCode.has(metric.sourceLanguageCode)) ||
        (metric.kind === 'family-estimate' && !repository.familyById.has(metric.familyId)))
    )
      return false
    set(administrativeSessionAtom, { ...get(administrativeSessionAtom), metric })
    return true
  },
)

export interface AdministrativeCameraRequest {
  readonly featureIds: readonly string[]
  readonly requestId: number
}
export const administrativeCameraRequestAtom = atom<AdministrativeCameraRequest | null>(null)
/** Selecting and loading do not move the map. Only this explicit action requests focus. */
export const focusAdministrativeTerritoryAtom = atom(null, (get, set, territoryCode: string) => {
  const featureIds = get(boundaryIndexAtom)?.associations.get(territoryCode)?.featureIds
  if (!featureIds?.length || !get(administrativeRepositoryAtom)?.territoryByCode.has(territoryCode))
    return false
  const request = {
    featureIds,
    requestId: (get(administrativeCameraRequestAtom)?.requestId ?? 0) + 1,
  }
  set(administrativeCameraRequestAtom, request)
  set(mapCameraIntentAtom, request)
  return true
})

export const focusAdministrativeShapeAtom = atom(null, (get, set, featureId: string) => {
  if (!get(boundaryIndexAtom)?.features.some((feature) => feature.featureId === featureId))
    return false
  const request = {
    featureIds: [featureId],
    requestId: (get(administrativeCameraRequestAtom)?.requestId ?? 0) + 1,
  }
  set(administrativeCameraRequestAtom, request)
  set(mapCameraIntentAtom, request)
  return true
})
