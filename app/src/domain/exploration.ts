import { type AreaMode, type GeographyAvailability, isAreaAvailable } from './aggregation.ts'
import type { Language, LanguageId } from './atlas.ts'
import type { LanguageHierarchy } from './hierarchy.ts'
import { hasCoverage, type MapCoverage } from './mapGroups.ts'

interface ExploreResultOptions {
  readonly matches: readonly Language[]
  readonly hierarchy: LanguageHierarchy
  readonly browseRoots: boolean
  readonly availability: ReadonlyMap<LanguageId, GeographyAvailability>
  readonly modes: Readonly<Record<LanguageId, AreaMode>>
  readonly coverage?: MapCoverage
}

/** Apply geography after text matching; leave expanded children to the hierarchy. */
export const prepareExploreResults = ({
  matches,
  hierarchy,
  browseRoots,
  availability,
  modes,
  coverage,
}: ExploreResultOptions) => {
  const candidates = browseRoots ? hierarchy.roots : matches
  const withAreas: Language[] = []
  const withoutAreas: Language[] = []
  for (const language of candidates) {
    const available = availability.get(language.id)
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
