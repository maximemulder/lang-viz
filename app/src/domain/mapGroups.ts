import type { GeographyAvailability } from './aggregation.ts'
import type { LanguageId } from './atlas.ts'
import { buildBranchMapEntries } from './branches.ts'
import { buildColorTopology, type ColorTopology } from './colors.ts'
import type { LanguageHierarchy } from './hierarchy.ts'
import {
  type GeographyContext,
  geographyContextKey,
  type MapEntry,
  mapEntryGeometryKey,
  pinMapEntry,
} from './mapEntries.ts'

export type MapCoverage = 'branch' | 'own'
export type GroupColoring = 'hierarchy' | 'uniform'

/** Stored with the pinned entries, independently of the next Explore action. */
export interface MapGroup {
  readonly id: string
  readonly rootId: LanguageId
  readonly coverage: MapCoverage
  readonly coloring: GroupColoring
  readonly color: string | null
}

export interface MapEntryGroup {
  readonly group: MapGroup
  readonly entries: readonly MapEntry[]
}

/** Legacy/testing entries remain usable alongside groups created through Explore. */
export const mapGroupId = (entry: MapEntry) =>
  entry.group?.id ??
  (entry.branchRootId
    ? JSON.stringify(['branch', entry.branchRootId, geographyContextKey(entry.context)])
    : `entry:${entry.id}`)

export const groupMapEntries = (entries: readonly MapEntry[]): readonly MapEntryGroup[] => {
  const groups = new Map<string, { group: MapGroup; entries: MapEntry[] }>()
  for (const entry of entries) {
    const id = mapGroupId(entry)
    let grouped = groups.get(id)
    if (!grouped) {
      grouped = {
        group: entry.group ?? {
          id,
          rootId: entry.branchRootId ?? entry.languageId,
          coverage: entry.branchRootId || entry.mode === 'descendants' ? 'branch' : 'own',
          coloring: 'hierarchy',
          color: null,
        },
        entries: [],
      }
      groups.set(id, grouped)
    }
    grouped.entries.push(entry)
  }
  return [...groups.values()]
}

export const buildMapGroupEntries = (
  rootIds: readonly LanguageId[],
  hierarchy: LanguageHierarchy,
  availability: ReadonlyMap<LanguageId, GeographyAvailability>,
  context: GeographyContext,
  coverage: MapCoverage,
  coloring: GroupColoring,
  topology: ColorTopology = buildColorTopology(hierarchy),
): readonly MapEntry[] => {
  const groups = new Map<string, MapGroup>()
  const entries =
    coverage === 'branch'
      ? buildBranchMapEntries(rootIds, hierarchy, availability, context, topology).entries
      : [...new Set(rootIds)].flatMap((id) => {
          const entry = pinMapEntry(id, availability.get(id), 'own', context, id)
          return entry ? [entry] : []
        })
  return entries.map((entry) => {
    const rootId = entry.branchRootId ?? entry.languageId
    let group = groups.get(rootId)
    if (!group) {
      group = { id: crypto.randomUUID(), rootId, coverage, coloring, color: null }
      groups.set(rootId, group)
    }
    return { ...entry, group }
  })
}

/** Additive: comparisons survive, repeats keep styles, removed members can be restored. */
export const addMapGroupEntries = (
  current: readonly MapEntry[],
  candidates: readonly MapEntry[],
): readonly MapEntry[] => {
  const result = [...current]
  const existingGroups = groupMapEntries(current)
  const usedIds = new Set(current.map(({ id }) => id))
  for (const candidate of groupMapEntries(candidates)) {
    const wanted = new Set(candidate.entries.map(mapEntryGeometryKey))
    const existing = existingGroups.find(
      ({ group, entries }) =>
        group.rootId === candidate.group.rootId &&
        group.coverage === candidate.group.coverage &&
        entries.every((entry) => wanted.has(mapEntryGeometryKey(entry))) &&
        (entries.length === wanted.size ||
          (entries[0] &&
            candidate.entries[0] &&
            geographyContextKey(entries[0].context) ===
              geographyContextKey(candidate.entries[0].context))),
    )
    const group = existing?.group ?? candidate.group
    if (existing) {
      const ids = new Set(existing.entries.filter((entry) => !entry.group).map(({ id }) => id))
      for (let i = 0; i < result.length; i++) {
        const entry = result[i]
        if (entry && ids.has(entry.id)) result[i] = { ...entry, group }
      }
    }
    const present = new Set(existing?.entries.map(mapEntryGeometryKey))
    for (const entry of candidate.entries) {
      if (present.has(mapEntryGeometryKey(entry))) continue
      // Native IDs keep complete, non-overlapping branch views eligible for prepared tiles.
      // A shared source polygon in another group needs its own inspection/color identity.
      const id = usedIds.has(entry.id) ? `group:${group.id}:${entry.id}` : entry.id
      usedIds.add(id)
      result.push({ ...entry, id, group })
    }
  }
  return result
}

export const hasCoverage = (available: GeographyAvailability | undefined, coverage: MapCoverage) =>
  Boolean(available && (available.own || (coverage === 'branch' && available.descendants.length)))
