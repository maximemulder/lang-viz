export type LanguageId = string
export type GeometryVariantId = string
export type GeographyDatasetId = string

export interface Language {
  readonly id: LanguageId
  readonly name: string
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
  readonly layer: 'contemporary' | 'traditional' | 'historical' | 'mixed'
  readonly label: string
  readonly featureId: number
  readonly color: string
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
  readonly languageCount: number
  readonly languageWithGeometryCount: number
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
  readonly searchTextByLanguageId: ReadonlyMap<LanguageId, string>
}
