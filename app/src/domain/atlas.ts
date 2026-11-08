import type { LanguageSearchIndex } from './catalog.ts'

export type LanguageId = string
export type LanguoidLevel = 'family' | 'language' | 'dialect'
export type GeometryVariantId = string
export type GeographyDatasetId = string
export type GeographyDatasetSelection = 'all' | readonly GeographyDatasetId[]
export type TemporalViewId = 'contemporary' | 'time-of-contact' | 'year-1750' | 'mixed-periods'
export type TemporalViewSelection = 'all' | TemporalViewId
export type TemporalQuality = 'direct' | 'approximate' | 'proxy' | 'mixed'

export type TemporalCoverage =
  | {
      readonly kind: 'named-period'
      readonly viewId: Exclude<TemporalViewId, 'year-1750'>
      readonly label: string
      readonly quality: TemporalQuality
    }
  | {
      readonly kind: 'snapshot'
      readonly viewId: 'year-1750'
      readonly label: string
      readonly quality: TemporalQuality
      readonly year: number
    }

/** A Glottolog languoid of any level; the legacy catalog name is retained. */
export interface Language {
  readonly id: LanguageId
  readonly name: string
  readonly level: LanguoidLevel
  /** Immediate classification parent, including intermediate groups and dialects. */
  readonly parentId: LanguageId | null
  /** Language-level ancestor for dialects; distinct from the immediate parent. */
  readonly parentLanguageId: LanguageId | null
  readonly alternativeNames: readonly string[]
  readonly iso6393: string | null
  readonly familyId: LanguageId | null
  readonly familyName: string | null
  readonly macroarea: string | null
  readonly countries: readonly string[]
  readonly latitude: number | null
  readonly longitude: number | null
  readonly geometryVariantIds: readonly GeometryVariantId[]
}

export interface GeometryVariant {
  readonly id: GeometryVariantId
  readonly languageId: LanguageId
  readonly datasetId: GeographyDatasetId
  readonly layer: 'contemporary' | 'traditional' | 'snapshot' | 'mixed-periods'
  readonly label: string
  readonly featureId: number
  readonly featureCount: number
  readonly geometryKind: 'source' | 'dataset-family' | 'dataset-language' | 'dataset-dialect'
  readonly sourceFile: string
  readonly sourceFeatureIds: readonly string[]
  /** Legacy categorical seed. Runtime presentation uses the languoid color resolver. */
  readonly color: string
  readonly temporalCoverage: TemporalCoverage
  readonly sourceYear: number
}

export interface GeographyDataset {
  readonly id: GeographyDatasetId
  readonly name: string
  readonly shortName: string
  readonly citation: string
  readonly license: string
}

export interface AtlasManifest {
  readonly schemaVersion: number
  readonly languoidCount: number
  readonly languoidWithGeometryCount: number
  readonly geometryVariantCount: number
  readonly vectorLayer: string
  readonly archive: string
}

export interface AtlasData {
  readonly manifest: AtlasManifest
  readonly languages: readonly Language[]
  readonly variants: readonly GeometryVariant[]
  readonly datasets: readonly GeographyDataset[]
  readonly languageById: ReadonlyMap<LanguageId, Language>
  readonly variantById: ReadonlyMap<GeometryVariantId, GeometryVariant>
  readonly languageSearchIndex: LanguageSearchIndex
}
