import { atom } from 'jotai'
import { unwrap } from 'jotai/utils'
import { walsRepositoryAtom, walsSessionAtom } from '../../features/wals/state.ts'
import {
  atlasDataAtom,
  geographyDatasetFilterAtom,
  temporalViewAtom,
} from '../../state/atlasState.ts'
import { matchWalsAreas } from './areaMatching.ts'
import { walsAssociationsAtom } from './state.ts'

const readyAtlasAtom = unwrap(atlasDataAtom)
export const walsAreaMatchesAtom = atom((get) => {
  const repository = get(walsRepositoryAtom)
  const associations = get(walsAssociationsAtom)
  const overlay = get(walsSessionAtom).overlay
  if (!repository || !associations || !overlay?.visible) return null
  const atlas = get(readyAtlasAtom)
  if (!atlas) return null
  const sources = get(geographyDatasetFilterAtom),
    period = get(temporalViewAtom)
  const variants = atlas.variants.filter(
    (variant) =>
      (sources === 'all' || sources.includes(variant.datasetId)) &&
      (period === 'all' || variant.temporalCoverage.viewId === period),
  )
  return matchWalsAreas(repository, associations, overlay.sourceId, overlay.featureId, variants)
})
