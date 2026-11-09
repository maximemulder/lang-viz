import type { LanguageSearchIndex } from './catalog.ts'
import type { PreparedColorsManifest } from './preparedColors.ts'

/** Opaque catalog key: a Glottocode or a stable dataset-namespaced ID. */
export type LanguageId = string
export type LanguoidLevel = 'family' | 'language' | 'dialect' | 'group'
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

export type LanguageClassification =
  | { readonly kind: 'glottolog'; readonly glottocode: string }
  | {
      readonly kind: 'source'
      readonly datasetId: GeographyDatasetId
      readonly label: string
      readonly note: string
    }

/** A languoid from Glottolog or a source-defined entry; the legacy name is retained. */
export interface Language {
  readonly id: LanguageId
  readonly classification: LanguageClassification
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
  readonly sourceFile?: string
  readonly sourceFeatureIds?: readonly string[]
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
  readonly preparedColors?: PreparedColorsManifest
  readonly schemaVersion: number
  readonly languoidCount: number
  readonly languoidWithGeometryCount: number
  readonly geometryVariantCount: number
  readonly vectorLayer: string
  readonly archive: string
  /** Highest native source LOD; higher camera zooms retain this geometry. */
  readonly geometryMaxZoom?: number
  readonly geometryIndex?: string
  readonly geometryBounds?: string
  readonly geometryProvenance?: string
  readonly geometryProfiles?: readonly {
    readonly datasetId: GeographyDatasetId
    readonly viewId: TemporalViewId
    readonly archive: string
  }[]
  readonly geometryBuild?: {
    readonly kind: 'shared-coverage'
    readonly fingerprint: string
    readonly report: string
  }
  readonly branchCoverage?: {
    readonly directory: string
    readonly maxZoom: number
    readonly signatures: readonly string[]
  }
  readonly coverageParts?: {
    readonly directory: string
    readonly maxZoom: number
    readonly profiles: readonly {
      readonly id: string
      readonly datasetId: GeographyDatasetId
      readonly viewId: TemporalViewId
      /** Complete levels; omitted tiles at these levels are known empty. */
      readonly maxZoom?: number
      /** Small availability index, fetched only for an active profile. */
      readonly tileIndex?: string
      readonly tiles?: Readonly<Record<string, readonly string[]>>
    }[]
  }
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
