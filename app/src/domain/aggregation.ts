import type {
  AtlasData,
  GeographyDatasetSelection,
  GeometryVariant,
  Language,
  TemporalViewSelection,
} from './atlas.ts'
import { geographyVariantsForLanguage } from './geography.ts'
import type { LanguageHierarchy } from './hierarchy.ts'
import type { Refinements } from './refinement.ts'

export type AreaMode = 'own' | 'descendants'

export interface GeographyAvailability {
  readonly ownVariants: readonly GeometryVariant[]
  readonly own: GeometryVariant | undefined
  /** First available geometry on each descendant branch, excluding this entry. */
  readonly descendants: readonly GeometryVariant[]
  /** Highest uncovered branches, rather than every missing leaf within them. */
  readonly uncoveredBranches: readonly Language[]
  readonly hasAnyAreas: boolean
}

export interface MapArea {
  readonly id: string
  readonly languageId: string
  readonly mode: AreaMode
  readonly color: string
  readonly variants: readonly GeometryVariant[]
  readonly branchRootId?: string
  readonly refines?: readonly string[]
}

/** Resolve all branches once per filter/override change, independently of tree expansion. */
export const buildGeographyAvailability = (
  data: AtlasData,
  hierarchy: LanguageHierarchy,
  period: TemporalViewSelection,
  sources: GeographyDatasetSelection,
  overrides: Readonly<Record<string, string>>,
): ReadonlyMap<string, GeographyAvailability> => {
  const result = new Map<string, GeographyAvailability>()
  const visiting = new Set<string>()
  const visit = (language: Language): GeographyAvailability => {
    const cached = result.get(language.id)
    if (cached) return cached
    const ownVariants = geographyVariantsForLanguage(data, language, period, sources)
    const own = ownVariants.find(({ id }) => id === overrides[language.id]) ?? ownVariants[0]
    const descendants: GeometryVariant[] = []
    const uncoveredBranches: Language[] = []
    let hasAnyAreas = language.geometryVariantIds.length > 0
    visiting.add(language.id)
    for (const child of hierarchy.childrenById.get(language.id) ?? []) {
      if (visiting.has(child.id)) continue
      const available = visit(child)
      hasAnyAreas ||= available.hasAnyAreas
      if (available.own) descendants.push(available.own)
      else if (available.descendants.length) {
        descendants.push(...available.descendants)
        uncoveredBranches.push(...available.uncoveredBranches)
      } else uncoveredBranches.push(child)
    }
    visiting.delete(language.id)
    const available = { ownVariants, own, descendants, uncoveredBranches, hasAnyAreas }
    result.set(language.id, available)
    return available
  }
  for (const language of data.languages) visit(language)
  return result
}

/** Preserve every mapped entry across complete subtrees, including mapped ancestors. */
export const mappedBranchForLanguages = (
  rootIds: readonly string[],
  hierarchy: LanguageHierarchy,
  availability: ReadonlyMap<string, GeographyAvailability>,
) => {
  const subtreeIds = new Set<string>()
  const languageIds: string[] = []
  const visit = (id: string) => {
    if (subtreeIds.has(id) || !hierarchy.languageById.has(id)) return
    subtreeIds.add(id)
    for (const child of hierarchy.childrenById.get(id) ?? []) {
      visit(child.id)
    }
    if (availability.get(id)?.own) languageIds.push(id)
  }
  for (const id of rootIds) visit(id)
  return { subtreeIds, languageIds }
}

/** Available own areas in a complete branch, independently of tree expansion. */
export const mappedBranchForLanguage = (
  languageId: string,
  hierarchy: LanguageHierarchy,
  availability: ReadonlyMap<string, GeographyAvailability>,
) => mappedBranchForLanguages([languageId], hierarchy, availability)

export const areaMode = (available: GeographyAvailability, preferred?: AreaMode): AreaMode =>
  preferred ?? (available.own ? 'own' : 'descendants')

export const areaVariants = (available: GeographyAvailability, mode: AreaMode) =>
  mode === 'own' ? (available.own ? [available.own] : []) : available.descendants

export const areaStatus = (available: GeographyAvailability, mode: AreaMode) => {
  if (areaVariants(available, mode).length) return mode === 'own' ? 'Own area' : 'Descendant areas'
  if (available.own || available.descendants.length)
    return mode === 'own' ? 'Own unavailable' : 'Descendants unavailable'
  return available.hasAnyAreas ? 'Filtered out' : 'No areas'
}

/** One source polygon may belong to a selected aggregate and an independently selected child. */
export const mapAreaMemberships = (areas: readonly MapArea[]) => {
  const memberships: Record<string, string[]> = {}
  for (const area of areas)
    for (const variant of area.variants) {
      const owners = memberships[variant.id] ?? []
      owners.push(area.id)
      memberships[variant.id] = owners
    }
  return memberships
}

export const mapAreaRefinements = (areas: readonly MapArea[]): Refinements =>
  Object.fromEntries(
    areas
      .filter((area) => area.refines?.length)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((area) => [area.id, area.refines]),
  ) as Refinements

/** Ancestors draw first while exact coverage is loading or unavailable. */
export const mapAreaSourcePriorities = (areas: readonly MapArea[]) => {
  const priorities: Record<string, number> = {}
  for (const area of areas)
    for (const variant of area.variants)
      priorities[variant.id] = Math.max(priorities[variant.id] ?? 0, area.refines?.length ?? 0)
  return priorities
}

/** Grouping and refinement are geometry policy, independent of colors. */
export const mapAreaSelectionKey = (areas: readonly MapArea[], presentation = 'hatching') => {
  const memberships = mapAreaMemberships(areas)
  const variantIds = Object.keys(memberships).sort()
  const refinements = mapAreaRefinements(areas)
  return areas.some(({ mode }) => mode === 'descendants') || Object.keys(refinements).length
    ? JSON.stringify({
        variantIds,
        presentation,
        variantGroups: Object.fromEntries(variantIds.map((id) => [id, memberships[id]?.sort()])),
        ...(Object.keys(refinements).length ? { refinements } : {}),
      })
    : JSON.stringify(variantIds)
}

export const inspectedMapAreaIds = (ids: readonly string[], areas: readonly MapArea[]) => {
  const memberships = mapAreaMemberships(areas)
  return [...new Set(ids.flatMap((id) => memberships[id] ?? [id]))].sort()
}

export const inspectedSourceVariantIds = (ids: readonly string[], areas: readonly MapArea[]) => [
  ...new Set(
    ids.flatMap(
      (id) => areas.find((area) => area.id === id)?.variants.map((variant) => variant.id) ?? [id],
    ),
  ),
]

/** Explicit child selections take precedence in the temporary, unpartitioned fallback. */
export const mapAreaSourceColors = (areas: readonly MapArea[]) => {
  const colors: Record<string, string> = {}
  for (const area of [
    ...areas.filter(({ mode }) => mode === 'descendants'),
    ...areas.filter(({ mode }) => mode === 'own'),
  ]) {
    for (const variant of area.variants) colors[variant.id] = area.color
  }
  return colors
}

export const isAreaAvailable = (
  available: GeographyAvailability | undefined,
  preferred?: AreaMode,
) => Boolean(available && areaVariants(available, areaMode(available, preferred)).length)
