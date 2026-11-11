import { type AreaMode, areaStatus, type GeographyAvailability } from './aggregation.ts'
import type { Language } from './atlas.ts'
import { type EtymologyData, matchAtlasLanguage, type WordTrail } from './etymology.ts'
import { draftRepresentationKey, type MapEntry, mapEntryKey } from './mapEntries.ts'

export const trailLanguageGroups = (data: EtymologyData, trail: WordTrail) => {
  const groups = new Map<string, string[]>()
  for (const id of trail.ids) {
    const word = data.lexemes[id]
    if (word) groups.set(word.l, [...(groups.get(word.l) ?? []), id])
  }
  return [...groups].map(([languageId, ids]) => ({ languageId, ids }))
}

/** Resolve on full catalogs first; geography filters affect availability, never identity. */
export const planTrailAreas = (
  data: EtymologyData,
  trail: WordTrail,
  atlasLanguages: readonly Language[],
  availability: ReadonlyMap<string, GeographyAvailability>,
  modes: Readonly<Record<string, AreaMode>>,
  entries: readonly MapEntry[],
) => {
  const existing = new Set(entries.map(mapEntryKey))
  const additions = new Set<string>()
  const present = new Set<string>()
  const records = trailLanguageGroups(data, trail).map(({ languageId }) => {
    const match = matchAtlasLanguage(languageId, data.languages, atlasLanguages)
    if (!match) return { languageId, status: 'unmatched' as const, reason: 'No unique atlas match' }
    const available = availability.get(match.id)
    const key = draftRepresentationKey(match.id, available, modes[match.id])
    if (!key || !available)
      return {
        languageId,
        status: 'unavailable' as const,
        reason: available
          ? areaStatus(available, modes[match.id] ?? (available.own ? 'own' : 'descendants'))
          : 'No available representation',
      }
    if (existing.has(key)) {
      present.add(match.id)
      return {
        languageId,
        status: 'present' as const,
        reason: 'Matching representation already on map',
      }
    }
    additions.add(match.id)
    return { languageId, status: 'eligible' as const, reason: 'Matching representation available' }
  })
  return {
    records,
    languageIds: [...additions],
    alreadyPresent: present.size,
    unmatched: records.filter(({ status }) => status === 'unmatched').length,
    unavailable: records.filter(({ status }) => status === 'unavailable').length,
  }
}
