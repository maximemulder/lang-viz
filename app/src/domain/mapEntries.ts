import {
  type AreaMode,
  areaMode,
  areaVariants,
  type GeographyAvailability,
  type MapArea,
} from './aggregation.ts'
import type {
  AtlasData,
  GeographyDatasetSelection,
  GeometryVariantId,
  LanguageId,
  TemporalViewSelection,
} from './atlas.ts'
import { temporalQualityLabel } from './temporal.ts'

export interface GeographyContext {
  readonly sources: GeographyDatasetSelection
  readonly period: TemporalViewSelection
}

/** A pinned representation. Geometry provenance is independent of the current search filters. */
export interface MapEntry {
  readonly id: string
  readonly languageId: LanguageId
  readonly mode: AreaMode
  readonly variantIds: readonly GeometryVariantId[]
  readonly uncoveredBranchIds: readonly LanguageId[]
  readonly context: GeographyContext
  readonly colorRootId: LanguageId | null
  readonly colorOverride: string | null
  /** Entries added together refine ancestors in this branch and pinned context. */
  readonly branchRootId?: LanguageId | undefined
}

export const geographyContextKey = ({ sources, period }: GeographyContext) =>
  JSON.stringify([period, sources === 'all' ? 'all' : [...new Set(sources)].sort()])

const representationKey = (languageId: string, mode: AreaMode, ids: readonly string[]) =>
  JSON.stringify([languageId, mode, [...new Set(ids)].sort()])

export const mapEntryKey = (entry: MapEntry) =>
  representationKey(entry.languageId, entry.mode, entry.variantIds)

export const draftRepresentationKey = (
  languageId: LanguageId,
  available: GeographyAvailability | undefined,
  preferred?: AreaMode,
) => {
  if (!available) return null
  const mode = areaMode(available, preferred)
  const variants = areaVariants(available, mode)
  return variants.length
    ? representationKey(
        languageId,
        mode,
        variants.map(({ id }) => id),
      )
    : null
}

export const pinMapEntry = (
  languageId: LanguageId,
  available: GeographyAvailability | undefined,
  preferred: AreaMode | undefined,
  context: GeographyContext,
  colorRootId: LanguageId | null = null,
): MapEntry | null => {
  if (!available) return null
  const mode = areaMode(available, preferred)
  const variantIds = [...new Set(areaVariants(available, mode).map(({ id }) => id))]
  const firstId = variantIds[0]
  if (!firstId) return null
  return {
    // Own variants already have unique IDs; aggregates need independent membership identities.
    id: mode === 'own' ? firstId : `descendants:${languageId}:${crypto.randomUUID()}`,
    languageId,
    mode,
    variantIds,
    uncoveredBranchIds:
      mode === 'descendants' ? available.uncoveredBranches.map(({ id }) => id) : [],
    context: {
      period: context.period,
      sources: context.sources === 'all' ? 'all' : [...new Set(context.sources)].sort(),
    },
    colorRootId,
    colorOverride: null,
  }
}

/** Re-adding the same geometry preserves identity, color, and provenance. */
export const addMapEntries = (current: readonly MapEntry[], candidates: readonly MapEntry[]) => {
  const keys = new Set(current.map(mapEntryKey))
  const result = [...current]
  for (const entry of candidates) {
    const key = mapEntryKey(entry)
    if (keys.has(key)) continue
    keys.add(key)
    result.push(entry)
  }
  return result
}

/** Replace only the current comparison context; preserve other sources/periods in this subtree. */
export const replaceSubtreeMapEntries = (
  current: readonly MapEntry[],
  candidates: readonly MapEntry[],
  subtreeIds: ReadonlySet<LanguageId>,
  context: GeographyContext,
) => {
  const key = geographyContextKey(context)
  const replacements = new Map(candidates.map((entry) => [mapEntryKey(entry), entry]))
  return addMapEntries(
    current
      .filter(
        (entry) =>
          !subtreeIds.has(entry.languageId) ||
          geographyContextKey(entry.context) !== key ||
          replacements.has(mapEntryKey(entry)),
      )
      .map((entry) => {
        const replacement = replacements.get(mapEntryKey(entry))
        return replacement &&
          geographyContextKey(entry.context) === key &&
          (replacement.colorRootId !== entry.colorRootId ||
            replacement.branchRootId !== entry.branchRootId)
          ? {
              ...entry,
              colorRootId: replacement.colorRootId,
              branchRootId: replacement.branchRootId,
            }
          : entry
      }),
    candidates,
  )
}

export const resolveMapEntries = (
  entries: readonly MapEntry[],
  data: AtlasData,
  colors: ReadonlyMap<LanguageId, string>,
): readonly MapArea[] => {
  const areas: MapArea[] = entries.flatMap((entry) => {
    const variants = entry.variantIds.flatMap((id) => {
      const variant = data.variantById.get(id)
      return variant ? [variant] : []
    })
    // Never silently display a partial pinned representation after a catalog change.
    if (!variants.length || variants.length !== entry.variantIds.length) return []
    return [
      {
        id: entry.id,
        languageId: entry.languageId,
        mode: entry.mode,
        variants,
        color: entry.colorOverride ?? colors.get(entry.languageId) ?? '#777777',
        ...(entry.branchRootId ? { branchRootId: entry.branchRootId } : {}),
      },
    ]
  })
  // An ancestry index per intentional branch view avoids quadratic pair scans.
  const branches = new Map<string, Map<string, MapArea[]>>()
  const groupFor = (entry: MapEntry) =>
    JSON.stringify([entry.branchRootId, geographyContextKey(entry.context)])
  const entryById = new Map(entries.map((entry) => [entry.id, entry]))
  for (const area of areas) {
    const entry = entryById.get(area.id)
    if (!entry?.branchRootId) continue
    const key = groupFor(entry)
    const branch = branches.get(key) ?? new Map<string, MapArea[]>()
    branch.set(area.languageId, [...(branch.get(area.languageId) ?? []), area])
    branches.set(key, branch)
  }
  return areas.map((area) => {
    const entry = entryById.get(area.id)
    if (!entry?.branchRootId) return area
    const branch = branches.get(groupFor(entry))
    const refines: string[] = []
    const visited = new Set([area.languageId])
    let parent = data.languageById.get(area.languageId)?.parentId
    while (parent && !visited.has(parent)) {
      visited.add(parent)
      for (const ancestor of branch?.get(parent) ?? []) {
        // A broad 'all periods' browse can choose different periods per node.
        // Those representations remain comparisons, not geographic refinements.
        if (
          ancestor.variants[0]?.temporalCoverage.viewId ===
          area.variants[0]?.temporalCoverage.viewId
        )
          refines.push(ancestor.id)
      }
      parent = data.languageById.get(parent)?.parentId
    }
    return refines.length ? { ...area, refines: refines.sort() } : area
  })
}

export const mapEntryDescription = (entry: MapEntry, data: AtlasData) => {
  const variants = entry.variantIds.flatMap((id) => {
    const variant = data.variantById.get(id)
    return variant ? [variant] : []
  })
  const sources = [
    ...new Set(
      variants.map(
        ({ datasetId }) => data.datasets.find(({ id }) => id === datasetId)?.shortName ?? datasetId,
      ),
    ),
  ]
  const periods = [...new Set(variants.map(({ temporalCoverage }) => temporalCoverage.label))]
  const qualifications = [
    ...new Set(
      variants.flatMap(({ temporalCoverage }) =>
        temporalCoverage.quality === 'proxy' || temporalCoverage.quality === 'mixed'
          ? [temporalQualityLabel(temporalCoverage.quality)]
          : [],
      ),
    ),
  ]
  return [...sources, ...periods, ...qualifications].join(' · ')
}
