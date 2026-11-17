/** CLDR territory observations. IDs and numeric source strings are retained verbatim. */
export interface Territory {
  readonly code: string
  readonly unContainmentCodes: string
  readonly population: string
  readonly gdpUsd: string
  readonly literacyPercent: string
}

export type OfficialStatus =
  | 'unspecified'
  | 'official'
  | 'official_regional'
  | 'de_facto_official'
  | 'official_minority'

export interface Observation {
  readonly territoryCode: string
  readonly sourceLanguageCode: string
  readonly populationPercent: string
  readonly speakerCount: string
  readonly officialStatus: OfficialStatus
  readonly languageLiteracyPercent: string | null
  readonly languageWritingPercent: string | null
}

export interface LanguageAssociation {
  readonly sourceLanguageCode: string
  readonly glottocode: string | null
  readonly matchMethod: 'source_join_verified_against_pinned_glottolog' | 'unresolved'
  readonly glottologLevel: 'language' | 'dialect' | 'family' | null
  readonly glottologLanguageParentId: string | null
  readonly iso6393: string | null
  readonly name: string
  readonly familyId: string | null
  readonly macroareas: readonly string[]
  /** Glottolog catalog coordinate, never a territory speaker location. */
  readonly latitude: string | null
  readonly longitude: string | null
  readonly glottologCountries: readonly string[]
}

export interface AtlasAssociation {
  readonly glottocode: string
  readonly status: 'unresolved'
  readonly matchMethod: null
  readonly atlasLanguageId: null
}

export interface AdministrativeSupplement {
  readonly schemaVersion: 3
  readonly manifest: {
    readonly sourceBranchCommit: string
    readonly cldrRelease: string | null
    readonly cldrSourceFile: string | null
    readonly cldrSupplemental: {
      readonly url: string
      readonly sha256: string
      readonly bytes: number
    }
    readonly cldrEnglish: { readonly url: string; readonly sha256: string; readonly bytes: number }
    readonly producerRevision: string
    readonly joinedCsv: { readonly sha256: string; readonly bytes: number }
    readonly glottolog: { readonly sha256: string; readonly bytes: number; readonly commit: string }
    readonly attribution: readonly {
      readonly name: string
      readonly sourceUrl: string
      readonly license: string
    }[]
    readonly coverage: {
      readonly observationCount: number
      readonly territoryCount: number
      readonly sourceLanguageCount: number
      readonly glottocodeCount: number
      readonly familyCount: number
      readonly unresolvedLanguageCount: number
      readonly unresolvedObservationCount: number
      readonly territoriesWithoutObservations: readonly string[]
    }
  }
  readonly territories: readonly Territory[]
  readonly observations: readonly Observation[]
  readonly languageAssociations: readonly LanguageAssociation[]
  readonly families: readonly { readonly id: string; readonly name: string }[]
  readonly atlasAssociations: readonly AtlasAssociation[]
}

export interface AdministrativeRepository {
  readonly data: AdministrativeSupplement
  readonly territoryByCode: ReadonlyMap<string, Territory>
  readonly languageByCode: ReadonlyMap<string, LanguageAssociation>
  readonly familyById: ReadonlyMap<string, { readonly id: string; readonly name: string }>
  readonly observationsByTerritory: ReadonlyMap<string, readonly Observation[]>
  readonly observationsByLanguage: ReadonlyMap<string, readonly Observation[]>
  readonly observationsByFamily: ReadonlyMap<string, readonly Observation[]>
  readonly familyIds: readonly string[]
}
