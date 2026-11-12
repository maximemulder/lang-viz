/** Versioned WALS source evidence. Catalog associations never live in this bundle. */
export interface WalsReference {
  readonly sourceId: string
  readonly pages: string
}
export interface WalsRecord {
  readonly name: string
  readonly macroarea: string
  readonly coordinates: readonly [number, number] | null
  readonly glottocode: string | null
  readonly iso6393: string | null
  readonly isoCodes: readonly string[]
  readonly family: string
  readonly subfamily: string
  readonly genus: string
  readonly references: readonly WalsReference[]
  readonly url: string
}
export interface WalsFeature {
  readonly name: string
  readonly description: string
  readonly chapterId: string
  readonly chapterTitle: string
  readonly chapterCitation: string
  readonly contributors: string
  readonly area: string
  readonly references: readonly WalsReference[]
  readonly url: string
  readonly chapterUrl: string
}
export interface WalsCategory {
  readonly featureId: string
  readonly number: number
  readonly name: string
  readonly description: string
}
export interface WalsObservation {
  readonly sourceId: string
  readonly featureId: string
  readonly categoryId: string
  readonly references: readonly WalsReference[]
  readonly comment: string
  readonly exampleIds: readonly string[]
  readonly url: string
}
export interface WalsData {
  readonly schemaVersion: 1
  readonly adapterVersion: 1
  readonly provenance: {
    readonly snapshot: string | null
    readonly commit: string | null
    readonly sourceUrl: string | null
    readonly citation: string
    readonly license: string
    readonly files: Readonly<Record<string, { readonly bytes: number; readonly sha256: string }>>
  }
  readonly sourceNotices: {
    readonly errata: string
    readonly errataPolicy: string
    readonly notice: string
  }
  readonly records: Readonly<Record<string, WalsRecord>>
  readonly features: Readonly<Record<string, WalsFeature>>
  readonly categories: Readonly<Record<string, WalsCategory>>
  readonly observations: Readonly<Record<string, WalsObservation>>
  readonly references: Readonly<
    Record<
      string,
      {
        readonly type: string
        readonly fields: Readonly<Record<string, string>>
        readonly url: string
      }
    >
  >
  readonly examples: Readonly<
    Record<
      string,
      {
        readonly sourceId: string
        readonly text: string
        readonly analyzed: string
        readonly gloss: string
        readonly translation: string
        readonly comment: string
        readonly url: string
      }
    >
  >
  readonly diagnostics: {
    readonly counts: Readonly<Record<string, number>>
    readonly observationsByFeature: Readonly<Record<string, number>>
    readonly missingCoordinates: readonly {
      readonly sourceId: string
      readonly reason: 'missing' | 'incomplete'
    }[]
    readonly referencesWithoutTitle: readonly string[]
    readonly checks: readonly string[]
  }
}
export interface WalsRepository {
  readonly data: WalsData
  readonly index: {
    /** Source ID -> feature ID -> observation ID. Includes records without observations. */
    readonly bySource: ReadonlyMap<string, ReadonlyMap<string, string>>
    readonly byFeature: ReadonlyMap<string, readonly string[]>
    readonly byCategory: ReadonlyMap<string, readonly string[]>
    readonly byGlottocode: ReadonlyMap<string, readonly string[]>
    readonly byIso: ReadonlyMap<string, readonly string[]>
  }
}

export const appendWalsIndex = (index: Map<string, string[]>, key: string, id: string) => {
  const values = index.get(key)
  if (values) values.push(id)
  else index.set(key, [id])
}

/** Called only after validation; sorting makes choices independent of JSON object order. */
export const indexWals = (data: WalsData): WalsRepository => {
  const bySource = new Map<string, Map<string, string>>()
  const byFeature = new Map(
    Object.keys(data.features)
      .sort()
      .map((id) => [id, [] as string[]]),
  )
  const byCategory = new Map(
    Object.keys(data.categories)
      .sort()
      .map((id) => [id, [] as string[]]),
  )
  const byGlottocode = new Map<string, string[]>()
  const byIso = new Map<string, string[]>()
  for (const [id, record] of Object.entries(data.records).sort(([a], [b]) => a.localeCompare(b))) {
    bySource.set(id, new Map())
    if (record.glottocode) appendWalsIndex(byGlottocode, record.glottocode, id)
    if (record.iso6393) appendWalsIndex(byIso, record.iso6393, id)
  }
  for (const [id, observation] of Object.entries(data.observations).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    bySource.get(observation.sourceId)?.set(observation.featureId, id)
    appendWalsIndex(byFeature, observation.featureId, id)
    appendWalsIndex(byCategory, observation.categoryId, id)
  }
  return { data, index: { bySource, byFeature, byCategory, byGlottocode, byIso } }
}
