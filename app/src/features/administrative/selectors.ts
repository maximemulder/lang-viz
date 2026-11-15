import type {
  AdministrativeRepository,
  LanguageAssociation,
  Observation,
  OfficialStatus,
  Territory,
} from './model.ts'

export interface ReportedObservation {
  readonly observation: Observation
  readonly language: LanguageAssociation
  readonly estimatedSpeakers: number
  readonly populationPercent: number
}

export type AdministrativeMetric =
  | { readonly kind: 'territory-population' }
  | { readonly kind: 'territory-literacy' }
  | { readonly kind: 'language-estimate'; readonly sourceLanguageCode: string }
  | { readonly kind: 'family-estimate'; readonly familyId: string }

const ranked = (
  repository: AdministrativeRepository,
  rows: readonly Observation[],
): ReportedObservation[] =>
  rows
    .map((observation) => {
      const language = repository.languageByCode.get(observation.sourceLanguageCode)
      if (!language) throw new Error('Missing validated language association')
      return {
        observation,
        language,
        estimatedSpeakers: Number(observation.speakerCount),
        populationPercent: Number(observation.populationPercent),
      }
    })
    .sort(
      (a, b) =>
        b.estimatedSpeakers - a.estimatedSpeakers ||
        a.observation.sourceLanguageCode.localeCompare(b.observation.sourceLanguageCode),
    )

export function selectTerritory(repository: AdministrativeRepository, code: string) {
  const territory = repository.territoryByCode.get(code)
  if (!territory) return null
  const observations = ranked(repository, repository.observationsByTerritory.get(code) ?? [])
  return {
    territory,
    observations,
    /** CLDR language percentages may overlap; this is a disclosure, not a population share. */
    overlappingPercentages:
      observations.reduce((sum, item) => sum + item.populationPercent, 0) > 100,
  }
}

export function selectLanguage(repository: AdministrativeRepository, sourceLanguageCode: string) {
  const language = repository.languageByCode.get(sourceLanguageCode)
  if (!language) return null
  const observations = ranked(
    repository,
    repository.observationsByLanguage.get(sourceLanguageCode) ?? [],
  )
  return {
    language,
    observations,
    /** Sum of reported estimates, not a count of distinct people. */
    sumOfReportedEstimates: observations.reduce((sum, item) => sum + item.estimatedSpeakers, 0),
  }
}

export function selectFamily(repository: AdministrativeRepository, familyId: string) {
  const rows = repository.observationsByFamily.get(familyId)
  if (!rows) return null
  const observations = ranked(repository, rows)
  const languageCodes = [...new Set(rows.map((row) => row.sourceLanguageCode))].sort()
  return {
    familyId,
    familyName: repository.familyById.get(familyId)?.name ?? familyId,
    languages: languageCodes.flatMap((code) => {
      const language = repository.languageByCode.get(code)
      return language ? [language] : []
    }),
    observations,
    /** Rows can overlap within a territory and across script variants. */
    sumOfReportedEstimates: observations.reduce((sum, item) => sum + item.estimatedSpeakers, 0),
  }
}

export function selectTerritoryMetric(
  repository: AdministrativeRepository,
  territoryCode: string,
  metric: AdministrativeMetric,
): number | null {
  const territory = repository.territoryByCode.get(territoryCode)
  if (!territory) return null
  switch (metric.kind) {
    case 'territory-population':
      return Number(territory.population)
    case 'territory-literacy':
      return Number(territory.literacyPercent)
    case 'language-estimate': {
      const row = repository.observationsByLanguage
        .get(metric.sourceLanguageCode)
        ?.find((row) => row.territoryCode === territoryCode)
      return row ? Number(row.speakerCount) : null
    }
    case 'family-estimate': {
      const rows = repository.observationsByFamily
        .get(metric.familyId)
        ?.filter((row) => row.territoryCode === territoryCode)
      return rows?.length ? rows.reduce((sum, row) => sum + Number(row.speakerCount), 0) : null
    }
  }
}

/** Searches source IDs and names only. Callers supply a local territory label if desired. */
export function searchTerritories(
  repository: AdministrativeRepository,
  query: string,
  label: (territory: Territory) => string = (territory) => territory.code,
): readonly Territory[] {
  const needle = query.trim().toLocaleLowerCase()
  return [...repository.territoryByCode.values()].filter(
    (territory) =>
      !needle ||
      territory.code.toLocaleLowerCase().includes(needle) ||
      label(territory).toLocaleLowerCase().includes(needle),
  )
}

export function searchLanguages(repository: AdministrativeRepository, query: string) {
  const needle = query.trim().toLocaleLowerCase()
  return [...repository.languageByCode.values()].filter(
    (language) =>
      !needle ||
      [
        language.sourceLanguageCode,
        language.glottocode,
        language.iso6393 ?? '',
        language.name,
      ].some((value) => value.toLocaleLowerCase().includes(needle)),
  )
}

export function searchFamilies(repository: AdministrativeRepository, query: string) {
  const needle = query.trim().toLocaleLowerCase()
  return [...repository.familyById.values()].filter(
    (family) =>
      !needle ||
      family.id.toLocaleLowerCase().includes(needle) ||
      family.name.toLocaleLowerCase().includes(needle),
  )
}

export function selectOfficialStatus(
  repository: AdministrativeRepository,
  territoryCode: string,
  sourceLanguageCode: string,
): OfficialStatus | null {
  return (
    repository.observationsByLanguage
      .get(sourceLanguageCode)
      ?.find((row) => row.territoryCode === territoryCode)?.officialStatus ?? null
  )
}
