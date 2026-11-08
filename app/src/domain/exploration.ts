import {
  type AreaMode,
  areaMode,
  areaVariants,
  type GeographyAvailability,
  isAreaAvailable,
} from './aggregation.ts'
import type { Language, LanguageId } from './atlas.ts'
import type { LanguageHierarchy } from './hierarchy.ts'

interface ExploreResultOptions {
  readonly matches: readonly Language[]
  readonly hierarchy: LanguageHierarchy
  readonly browseRoots: boolean
  /** null searches the whole world; an empty set is an empty viewport. */
  readonly viewportLanguageIds: ReadonlySet<LanguageId> | null
  readonly availability: ReadonlyMap<LanguageId, GeographyAvailability>
  readonly modes: Readonly<Record<LanguageId, AreaMode>>
}

/** Apply geography after text matching; leave expanded children to the hierarchy. */
export const prepareExploreResults = ({
  matches,
  hierarchy,
  browseRoots,
  viewportLanguageIds,
  availability,
  modes,
}: ExploreResultOptions) => {
  const candidates = browseRoots ? hierarchy.roots : matches
  const withAreas: Language[] = []
  const withoutAreas: Language[] = []
  for (const language of candidates) {
    const available = availability.get(language.id)
    if (
      viewportLanguageIds !== null &&
      (!available ||
        !areaVariants(available, areaMode(available, modes[language.id])).some((variant) =>
          viewportLanguageIds.has(variant.languageId),
        ))
    )
      continue
    const group = isAreaAvailable(available, modes[language.id]) ? withAreas : withoutAreas
    group.push(language)
  }
  // Stable grouping retains relevance order for matches and catalog order for roots.
  return {
    roots: [...withAreas, ...withoutAreas],
    showableIds: withAreas.map(({ id }) => id),
  }
}
