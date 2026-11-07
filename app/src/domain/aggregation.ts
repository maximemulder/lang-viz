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
  readonly color: string
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
    const color =
      language.geometryVariantIds.map((id) => data.variantById.get(id)?.color).find(Boolean) ??
      aggregateColor(language.id)
    const available = { ownVariants, own, descendants, uncoveredBranches, hasAnyAreas, color }
    result.set(language.id, available)
    return available
  }
  for (const language of data.languages) visit(language)
  return result
}

/** Deepest mapped entries in a complete subtree, including its root when appropriate. */
export const mappedLeavesForLanguage = (
  languageId: string,
  hierarchy: LanguageHierarchy,
  availability: ReadonlyMap<string, GeographyAvailability>,
) => {
  const subtreeIds = new Set<string>()
  const languageIds: string[] = []
  const visit = (id: string): boolean => {
    if (subtreeIds.has(id) || !hierarchy.languageById.has(id)) return false
    subtreeIds.add(id)
    let hasMappedDescendants = false
    for (const child of hierarchy.childrenById.get(id) ?? []) {
      // Visit every branch, even after finding geography in an earlier sibling.
      if (visit(child.id)) hasMappedDescendants = true
    }
    if (hasMappedDescendants) return true
    if (!availability.get(id)?.own) return false
    languageIds.push(id)
    return true
  }
  visit(languageId)
  return { subtreeIds, languageIds }
}

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

/** Stable per-entry color, including entries without directly supplied polygons. */
export const aggregateColor = (languageId: string) => {
  let hash = 0
  for (const character of languageId) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) | 0
  const hue = ((hash >>> 0) % 360) / 60
  const chroma = 0.5
  const x = chroma * (1 - Math.abs((hue % 2) - 1))
  const channels =
    hue < 1
      ? [chroma, x, 0]
      : hue < 2
        ? [x, chroma, 0]
        : hue < 3
          ? [0, chroma, x]
          : hue < 4
            ? [0, x, chroma]
            : hue < 5
              ? [x, 0, chroma]
              : [chroma, 0, x]
  return `#${channels
    .map((channel) =>
      Math.round((channel + 0.22) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`
}

export const resolveMapAreas = (
  ids: readonly string[],
  availability: ReadonlyMap<string, GeographyAvailability>,
  modes: Readonly<Record<string, AreaMode>>,
): readonly MapArea[] =>
  ids.flatMap((languageId) => {
    const available = availability.get(languageId)
    if (!available) return []
    const mode = areaMode(available, modes[languageId])
    const variants = areaVariants(available, mode)
    const first = variants[0]
    if (!first) return []
    return [
      {
        id: mode === 'own' ? first.id : `descendants:${languageId}`,
        languageId,
        mode,
        color: mode === 'own' ? first.color : available.color,
        variants,
      },
    ]
  })

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
