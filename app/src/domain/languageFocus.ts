import { type GeographyAvailability, mappedBranchForLanguage } from './aggregation.ts'
import type { AtlasData, GeometryVariant } from './atlas.ts'
import type { LanguageHierarchy } from './hierarchy.ts'
import type { MapEntry } from './mapEntries.ts'
import { groupMapEntries, type MapCoverage } from './mapGroups.ts'

export interface LanguageMapTarget {
  readonly languageId: string
  readonly entryId?: string
  readonly groupId?: string
}

/** East may exceed 180 for a footprint crossing the antimeridian. */
export type GeographicBounds = readonly [west: number, south: number, east: number, north: number]

export const targetGeometry = (
  target: LanguageMapTarget | null,
  data: AtlasData,
  availability: ReadonlyMap<string, GeographyAvailability>,
  coverage: MapCoverage,
  hierarchy: LanguageHierarchy,
  entries: readonly MapEntry[],
): readonly GeometryVariant[] => {
  if (!target) return []
  if (target.groupId) {
    const group = groupMapEntries(entries).find(
      ({ group }) => group.id === target.groupId && group.rootId === target.languageId,
    )
    if (!group) return []
    const ids = [...new Set(group.entries.flatMap(({ variantIds }) => variantIds))]
    const variants = ids.flatMap((id) => data.variantById.get(id) ?? [])
    return variants.length === ids.length ? variants : []
  }
  if (target.entryId) {
    const entry = entries.find(
      ({ id, languageId }) => id === target.entryId && languageId === target.languageId,
    )
    if (!entry) return []
    const variants = entry.variantIds.flatMap((id) => data.variantById.get(id) ?? [])
    return variants.length === entry.variantIds.length ? variants : []
  }
  const available = availability.get(target.languageId)
  if (coverage === 'own') return available?.own ? [available.own] : []
  return mappedBranchForLanguage(target.languageId, hierarchy, availability).languageIds.flatMap(
    (id) => availability.get(id)?.own ?? [],
  )
}

/** Smallest enclosing longitude arc; bounds include all islands and aggregate contributors. */
export const combinedBounds = (bounds: readonly GeographicBounds[]): GeographicBounds | null => {
  if (!bounds.length) return null
  const intervals: [number, number][] = []
  let south = 90
  let north = -90
  for (const [west, bottom, east, top] of bounds) {
    if (![west, bottom, east, top].every(Number.isFinite) || east < west || top < bottom)
      return null
    south = Math.min(south, bottom)
    north = Math.max(north, top)
    const width = Math.min(360, east - west)
    const start = ((west % 360) + 360) % 360
    intervals.push([start, Math.min(360, start + width)])
    if (start + width > 360) intervals.push([0, start + width - 360])
  }
  intervals.sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const interval of intervals) {
    const last = merged.at(-1)
    if (last && interval[0] <= last[1]) last[1] = Math.max(last[1], interval[1])
    else merged.push([...interval])
  }
  let gap = -1
  let start = 0
  for (let i = 0; i < merged.length; i++) {
    const current = merged[i]
    const next = merged[(i + 1) % merged.length]
    if (!current || !next) continue
    const distance = next[0] + (i === merged.length - 1 ? 360 : 0) - current[1]
    if (distance > gap) {
      gap = distance
      start = next[0]
    }
  }
  const west = ((start + 180) % 360) - 180
  return [
    gap === 0 ? -180 : west,
    Math.max(-85, Math.min(85, south)),
    gap === 0 ? 180 : west + 360 - Math.max(0, gap),
    Math.max(-85, Math.min(85, north)),
  ]
}
