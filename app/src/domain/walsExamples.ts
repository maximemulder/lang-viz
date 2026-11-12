import type { FeatureCollection, Point } from 'geojson'
import type { WalsRepository } from './wals.ts'

export const WALS_MAX_EXAMPLES = 12
export type WalsPoint = readonly [number, number]
export interface WalsExample {
  readonly sourceId: string
  readonly observationId: string
  readonly coordinates: WalsPoint | null
}
export interface WalsLocatedExample extends WalsExample {
  readonly coordinates: WalsPoint
}
export interface WalsExampleSelection {
  readonly featureId: string
  readonly categoryId: string
  readonly origin: WalsExample
  /** Exact source observations in deterministic geographic selection order. */
  readonly examples: readonly WalsLocatedExample[]
  readonly counts: {
    /** All exact-category source records, INCLUDING the origin. */
    readonly matchingRecords: number
    /** Matching records with usable WALS coordinates, INCLUDING a located origin. */
    readonly locatedRecords: number
    /** Located matching records EXCLUDING the origin, regardless of atlas association. */
    readonly candidateRecords: number
    /** Distinct candidate positions, including any position shared with the origin. */
    readonly groupedCandidates: number
    /** Selected source observations, EXCLUDING the origin; at most 12. */
    readonly displayedExamples: number
  }
}

/** Canonical positions merge the two dateline spellings and longitudes at each pole. */
export const walsPoint = (coordinates: WalsPoint | null): WalsPoint | null => {
  if (!coordinates) return null
  const [longitude, latitude] = coordinates
  if (
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude) ||
    Math.abs(longitude) > 180 ||
    Math.abs(latitude) > 90
  )
    return null
  return [Math.abs(latitude) === 90 ? 0 : longitude === 180 ? -180 : longitude || 0, latitude || 0]
}
const pointKey = ([longitude, latitude]: WalsPoint) => `${longitude},${latitude}`
const vector = ([longitude, latitude]: WalsPoint): readonly [number, number, number] => {
  const radians = Math.PI / 180
  const radius = Math.cos(latitude * radians)
  return [
    radius * Math.cos(longitude * radians),
    radius * Math.sin(longitude * radians),
    Math.sin(latitude * radians),
  ]
}
type Vector = ReturnType<typeof vector>
// Squared chord distance is monotone in great-circle distance, including antipodes.
const distance = (a: Vector, b: Vector) =>
  (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
const limitExamples = (limit: number) =>
  Math.min(WALS_MAX_EXAMPLES, Math.max(0, Math.floor(Number.isFinite(limit) ? limit : 12)))

/** Pure source-evidence selection. Atlas matching and polygon availability have no role. */
export const selectWalsExamples = (
  repository: WalsRepository,
  sourceId: string,
  featureId: string,
  limit = WALS_MAX_EXAMPLES,
): WalsExampleSelection | null => {
  const observationId = repository.index.bySource.get(sourceId)?.get(featureId)
  const observation = observationId ? repository.data.observations[observationId] : undefined
  const record = repository.data.records[sourceId]
  if (!observationId || !observation || !record) return null
  const origin: WalsExample = {
    sourceId,
    observationId,
    coordinates: walsPoint(record.coordinates),
  }
  const matching = repository.index.byCategory.get(observation.categoryId) ?? []
  const candidates: WalsLocatedExample[] = []
  let locatedRecords = 0
  for (const id of matching) {
    const value = repository.data.observations[id]
    const source = value ? repository.data.records[value.sourceId] : undefined
    const coordinates = source ? walsPoint(source.coordinates) : null
    if (!value || value.featureId !== featureId || !coordinates) continue
    locatedRecords++
    if (value.sourceId !== sourceId)
      candidates.push({ sourceId: value.sourceId, observationId: id, coordinates })
  }
  // Code-unit ordering avoids locale-dependent ties or JSON/index insertion order.
  candidates.sort((a, b) => (a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0))
  const groupedCandidates = new Set(candidates.map((value) => pointKey(value.coordinates))).size
  const originVector = origin.coordinates ? vector(origin.coordinates) : null
  const remaining = candidates.map((example) => {
    const position = vector(example.coordinates)
    return {
      example,
      position,
      spacing: originVector ? distance(originVector, position) : Infinity,
    }
  })
  const examples: WalsLocatedExample[] = []
  const maximum = limitExamples(limit)
  // Greedy farthest-first: maximize distance to the closest already selected point.
  // With no origin point the first source ID seeds the selection. Ties retain ID order.
  while (remaining.length && examples.length < maximum) {
    let best = 0
    for (let i = 1; i < remaining.length; i++) {
      const current = remaining[i]
      const previous = remaining[best]
      if (current && previous && current.spacing > previous.spacing + 1e-12) best = i
    }
    const next = remaining.splice(best, 1)[0]
    if (!next) break
    examples.push(next.example)
    for (const candidate of remaining)
      candidate.spacing = Math.min(candidate.spacing, distance(candidate.position, next.position))
  }
  return {
    featureId,
    categoryId: observation.categoryId,
    origin,
    examples,
    counts: {
      matchingRecords: matching.length,
      locatedRecords,
      candidateRecords: candidates.length,
      groupedCandidates,
      displayedExamples: examples.length,
    },
  }
}

export interface WalsPointProperties {
  readonly role: 'origin' | 'example' | 'origin-and-example'
  readonly sourceIds: readonly string[]
  readonly observationIds: readonly string[]
  readonly originSourceId: string
  readonly featureId: string
  readonly categoryId: string
}

/** Static, unanimated points. Colocation groups rendering, never source identity or counts. */
export const walsExampleGeometry = (
  selection: WalsExampleSelection,
): FeatureCollection<Point, WalsPointProperties> => {
  const groups = new Map<string, { coordinates: WalsPoint; records: WalsExample[] }>()
  for (const example of [selection.origin, ...selection.examples]) {
    if (!example.coordinates) continue
    const key = pointKey(example.coordinates)
    let group = groups.get(key)
    if (!group) {
      group = { coordinates: example.coordinates, records: [] }
      groups.set(key, group)
    }
    group.records.push(example)
  }
  return {
    type: 'FeatureCollection',
    features: [...groups].map(([id, { coordinates, records }]) => {
      const containsOrigin = records.some((record) => record.sourceId === selection.origin.sourceId)
      return {
        type: 'Feature',
        id,
        geometry: { type: 'Point', coordinates: [...coordinates] },
        properties: {
          role: containsOrigin ? (records.length > 1 ? 'origin-and-example' : 'origin') : 'example',
          sourceIds: records.map((record) => record.sourceId),
          observationIds: records.map((record) => record.observationId),
          originSourceId: selection.origin.sourceId,
          featureId: selection.featureId,
          categoryId: selection.categoryId,
        },
      }
    }),
  }
}
