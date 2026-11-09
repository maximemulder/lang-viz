import {
  type AreaMode,
  areaMode,
  areaVariants,
  type GeographyAvailability,
  isAreaAvailable,
} from './aggregation.ts'
import type { Language, LanguageId } from './atlas.ts'
import type { LanguageHierarchy } from './hierarchy.ts'
import { hasCoverage, type MapCoverage } from './mapGroups.ts'

interface ExploreResultOptions {
  readonly matches: readonly Language[]
  readonly hierarchy: LanguageHierarchy
  readonly browseRoots: boolean
  /** null searches the whole world; an empty set is an empty viewport. */
  readonly viewportLanguageIds: ReadonlySet<LanguageId> | null
  readonly availability: ReadonlyMap<LanguageId, GeographyAvailability>
  readonly modes: Readonly<Record<LanguageId, AreaMode>>
  readonly coverage?: MapCoverage
}

/** Apply geography after text matching; leave expanded children to the hierarchy. */
export const prepareExploreResults = ({
  matches,
  hierarchy,
  browseRoots,
  viewportLanguageIds,
  availability,
  modes,
  coverage,
}: ExploreResultOptions) => {
  const candidates = browseRoots ? hierarchy.roots : matches
  const withAreas: Language[] = []
  const withoutAreas: Language[] = []
  const viewportBranches = new Set<string>()
  if (coverage === 'branch' && viewportLanguageIds !== null) {
    for (const id of viewportLanguageIds) {
      if (!availability.get(id)?.own) continue
      let node = hierarchy.languageById.get(id)
      while (node && !viewportBranches.has(node.id)) {
        viewportBranches.add(node.id)
        node = node.parentId ? hierarchy.languageById.get(node.parentId) : undefined
      }
    }
  }
  for (const language of candidates) {
    const available = availability.get(language.id)
    if (
      viewportLanguageIds !== null &&
      (coverage === 'branch'
        ? !viewportBranches.has(language.id)
        : coverage === 'own'
          ? !available?.own || !viewportLanguageIds.has(language.id)
          : !available ||
            !areaVariants(available, areaMode(available, modes[language.id])).some((variant) =>
              viewportLanguageIds.has(variant.languageId),
            ))
    )
      continue
    const usable = coverage
      ? hasCoverage(available, coverage)
      : isAreaAvailable(available, modes[language.id])
    const group = usable ? withAreas : withoutAreas
    group.push(language)
  }
  // Stable grouping retains relevance order for matches and catalog order for roots.
  return {
    roots: [...withAreas, ...withoutAreas],
    showableIds: withAreas.map(({ id }) => id),
  }
}
