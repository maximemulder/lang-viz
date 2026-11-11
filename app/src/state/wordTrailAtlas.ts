import { atom } from 'jotai'
import type { WordTrail } from '../domain/etymology.ts'
import { geographyContextKey } from '../domain/mapEntries.ts'
import { planTrailAreas } from '../domain/wordTrailAtlas.ts'
import {
  areaModesAtom,
  atlasDataAtom,
  geographyAvailabilityAtom,
  geographyContextAtom,
  geometryOverridesAtom,
  mapEntriesAtom,
  showLanguagesAtom,
} from './atlasState.ts'
import { etymologyRepositoryAtom } from './etymologyData.ts'
import { atlasWordTrailAtom, explorerSessionAtom } from './explorerState.ts'

const operationAtom = atom<{
  readonly trail: WordTrail
  readonly context: string
  readonly modes: object
  readonly overrides: object
  readonly busy: boolean
  readonly message: string
} | null>(null)
export const trailAreaOperationAtom = atom((get) => {
  const operation = get(operationAtom)
  return operation?.trail === get(atlasWordTrailAtom) &&
    operation.context === geographyContextKey(get(geographyContextAtom)) &&
    operation.modes === get(areaModesAtom) &&
    operation.overrides === get(geometryOverridesAtom)
    ? operation
    : null
})

/** One explicit addition uses the latest availability and the normal pin/dedup action. */
export const addTrailAreasAtom = atom(null, async (get, set) => {
  const trail = get(atlasWordTrailAtom)
  const repository = get(etymologyRepositoryAtom)
  const session = get(explorerSessionAtom)
  if (!trail || !repository || session.workspace !== 'geography') return
  const operation = {
    trail,
    context: geographyContextKey(get(geographyContextAtom)),
    modes: get(areaModesAtom),
    overrides: get(geometryOverridesAtom),
    busy: true,
    message: '',
  }
  set(operationAtom, operation)
  try {
    const atlas = await get(atlasDataAtom)
    if (
      get(operationAtom) !== operation ||
      get(explorerSessionAtom) !== session ||
      get(atlasWordTrailAtom) !== trail
    )
      return
    const before = get(mapEntriesAtom)
    const plan = planTrailAreas(
      repository.data,
      trail,
      atlas.languages,
      get(geographyAvailabilityAtom),
      get(areaModesAtom),
      before,
    )
    if (plan.languageIds.length) set(showLanguagesAtom, plan.languageIds)
    const added = get(mapEntriesAtom).length - before.length
    set(operationAtom, {
      ...operation,
      busy: false,
      context: geographyContextKey(get(geographyContextAtom)),
      modes: get(areaModesAtom),
      overrides: get(geometryOverridesAtom),
      message: `${added} map entries added · ${plan.alreadyPresent} already present · ${plan.unavailable} lexical records currently unavailable · ${plan.unmatched} without a unique atlas match.`,
    })
  } catch (error: unknown) {
    if (get(operationAtom) === operation)
      set(operationAtom, {
        ...operation,
        busy: false,
        message: error instanceof Error ? error.message : 'Could not add language areas.',
      })
  } finally {
    if (get(operationAtom) === operation) set(operationAtom, { ...operation, busy: false })
  }
})
