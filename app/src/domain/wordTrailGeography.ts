import type { Feature, FeatureCollection, MultiLineString } from 'geojson'
import { type EtymologyData, hasLanguagePoint, type WordTrail } from './etymology.ts'

export const RELATIONSHIP_COLORS: Readonly<Record<number, string>> = {
  0: '#70776d',
  1: '#267665',
  2: '#966710',
  4: '#ad5225',
  8: '#b15c6c',
  16: '#52759a',
  32: '#866599',
}

// Split at the antimeridian so the renderer never draws a long route across the
// wrong side of the world. These are focal-point connections, not travel routes.
export const splitFocalLink = (a: [number, number], b: [number, number]): [number, number][][] => {
  if (Math.abs(a[0] - b[0]) <= 180) return [[a, b]]
  const adjusted = b[0] + (b[0] > a[0] ? -360 : 360)
  // -180 and +180 name the same meridian; interpolation would divide by zero.
  if (adjusted === a[0]) return [[a, [a[0], b[1]]]]
  const boundary = adjusted > a[0] ? 180 : -180
  const lat = a[1] + ((b[1] - a[1]) * (boundary - a[0])) / (adjusted - a[0])
  return [
    [a, [boundary, lat]],
    [[-boundary, lat], b],
  ]
}

export const trailLocations = (data: EtymologyData, trail: WordTrail) => {
  const groups = new Map<string, string[]>()
  for (const id of trail.ids) {
    const word = data.lexemes[id]
    const language = word ? data.languages[word.l] : undefined
    if (!word || !language || !hasLanguagePoint(language)) continue
    groups.set(word.l, [...(groups.get(word.l) ?? []), id])
  }
  return [...groups]
    .map(([languageId, ids]) => ({ languageId, ids, language: data.languages[languageId] }))
    .filter((point) => point.language !== undefined)
}

export const trailLineFeatures = (
  data: EtymologyData,
  trail: WordTrail,
): FeatureCollection<MultiLineString> => {
  const features: Feature<MultiLineString>[] = []
  for (const edge of trail.edges) {
    const a = data.languages[data.lexemes[edge.p]?.l ?? ''],
      b = data.languages[data.lexemes[edge.c]?.l ?? '']
    if (
      !a ||
      !b ||
      !hasLanguagePoint(a) ||
      !hasLanguagePoint(b) ||
      a.lon === null ||
      a.lat === null ||
      b.lon === null ||
      b.lat === null
    )
      continue
    features.push({
      type: 'Feature',
      properties: { type: edge.t, color: RELATIONSHIP_COLORS[edge.t] ?? RELATIONSHIP_COLORS[0] },
      geometry: {
        type: 'MultiLineString',
        coordinates: splitFocalLink([a.lon, a.lat], [b.lon, b.lat]),
      },
    })
  }
  return { type: 'FeatureCollection', features }
}
