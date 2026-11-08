import type {
  AtlasData,
  GeographyDatasetSelection,
  GeometryVariant,
  Language,
  TemporalViewSelection,
} from './atlas.ts'
import { geographyVariantsForLanguage } from './geography.ts'
import type { LanguageHierarchy } from './hierarchy.ts'

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

/** Deepest mapped entries across complete subtrees, visiting shared branches only once. */
export const mappedLeavesForLanguages = (
  rootIds: readonly string[],
  hierarchy: LanguageHierarchy,
  availability: ReadonlyMap<string, GeographyAvailability>,
) => {
  const subtreeIds = new Set<string>()
  const mappedSubtrees = new Map<string, boolean>()
  const languageIds: string[] = []
  const visit = (id: string): boolean => {
    const cached = mappedSubtrees.get(id)
    if (cached !== undefined) return cached
    if (subtreeIds.has(id) || !hierarchy.languageById.has(id)) return false
    subtreeIds.add(id)
    let hasMappedDescendants = false
    for (const child of hierarchy.childrenById.get(id) ?? []) {
      // Visit every branch, even after finding geography in an earlier sibling.
      if (visit(child.id)) hasMappedDescendants = true
    }
    const hasOwn = Boolean(availability.get(id)?.own)
    if (!hasMappedDescendants && hasOwn) languageIds.push(id)
    const hasMapped = hasMappedDescendants || hasOwn
    mappedSubtrees.set(id, hasMapped)
    return hasMapped
  }
  for (const id of rootIds) visit(id)
  return { subtreeIds, languageIds }
}

/** Deepest mapped entries in a complete subtree, including its root when appropriate. */
export const mappedLeavesForLanguage = (
  languageId: string,
  hierarchy: LanguageHierarchy,
  availability: ReadonlyMap<string, GeographyAvailability>,
) => mappedLeavesForLanguages([languageId], hierarchy, availability)

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

/** Retain the legacy key for ordinary selections; grouped membership is part of cache identity. */
export const mapAreaSelectionKey = (areas: readonly MapArea[], presentation = 'hatching') => {
  const memberships = mapAreaMemberships(areas)
  const variantIds = Object.keys(memberships).sort()
  return areas.some(({ mode }) => mode === 'descendants')
    ? JSON.stringify({
        variantIds,
        presentation,
        variantGroups: Object.fromEntries(variantIds.map((id) => [id, memberships[id]?.sort()])),
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
