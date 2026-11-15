import type { AdministrativeRepository, AdministrativeSupplement, Observation } from './model.ts'

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const string = (value: unknown): value is string => typeof value === 'string'
const nullableString = (value: unknown): value is string | null => value === null || string(value)
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(string)
const code = (value: unknown, pattern: RegExp): value is string =>
  string(value) && pattern.test(value)
const numberString = (value: unknown, max?: number): value is string =>
  string(value) &&
  /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(value) &&
  Number.isFinite(Number(value)) &&
  Number(value) >= 0 &&
  (max === undefined || Number(value) <= max)
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0
function fail(reason: string): never {
  throw new Error(`Invalid administrative supplement: ${reason}`)
}

/** Validate all joins before publishing any data to the administrative view. */
export function indexAdministrative(value: unknown): AdministrativeRepository {
  if (!record(value) || value.schemaVersion !== 2 || !record(value.manifest)) fail('schema')
  const { manifest } = value
  if (
    !code(manifest.sourceBranchCommit, /^[a-f0-9]{40}$/) ||
    !code(manifest.producerRevision, /^sha256:[a-f0-9]{64}$/) ||
    !nullableString(manifest.cldrRelease) ||
    !nullableString(manifest.cldrSourceFile) ||
    !record(manifest.joinedCsv) ||
    !code(manifest.joinedCsv.sha256, /^[a-f0-9]{64}$/) ||
    !count(manifest.joinedCsv.bytes) ||
    !record(manifest.glottolog) ||
    !code(manifest.glottolog.sha256, /^[a-f0-9]{64}$/) ||
    !code(manifest.glottolog.commit, /^[a-f0-9]{40}$/) ||
    !count(manifest.glottolog.bytes) ||
    !record(manifest.coverage) ||
    !Array.isArray(manifest.attribution) ||
    !manifest.attribution.length ||
    !manifest.attribution.every(
      (item) => record(item) && string(item.name) && string(item.sourceUrl) && string(item.license),
    )
  )
    fail('manifest')
  const coverage = manifest.coverage
  if (
    !count(coverage.observationCount) ||
    !count(coverage.territoryCount) ||
    !count(coverage.sourceLanguageCount) ||
    !count(coverage.glottocodeCount) ||
    !count(coverage.familyCount) ||
    !Array.isArray(value.territories) ||
    !Array.isArray(value.observations) ||
    !Array.isArray(value.languageAssociations) ||
    !Array.isArray(value.atlasAssociations) ||
    !Array.isArray(value.families)
  )
    fail('collections')

  const territoryByCode = new Map<string, AdministrativeSupplement['territories'][number]>()
  for (const territory of value.territories) {
    if (
      !record(territory) ||
      !code(territory.code, /^[A-Z]{2}$/) ||
      !string(territory.unContainmentCodes) ||
      !numberString(territory.population) ||
      !numberString(territory.gdpUsd) ||
      !numberString(territory.literacyPercent, 100) ||
      territoryByCode.has(territory.code)
    )
      fail('territory record or duplicate code')
    territoryByCode.set(
      territory.code,
      territory as unknown as AdministrativeSupplement['territories'][number],
    )
  }
  const languageByCode = new Map<string, AdministrativeSupplement['languageAssociations'][number]>()
  const glottocodes = new Set<string>()
  for (const language of value.languageAssociations) {
    if (
      !record(language) ||
      !code(language.sourceLanguageCode, /^[a-z]{2,3}(?:_[A-Za-z0-9]+)*$/) ||
      !code(language.glottocode, /^[a-z]{4}[0-9]{4}$/) ||
      language.matchMethod !== 'source_join_verified_against_pinned_glottolog' ||
      !['language', 'dialect', 'family'].includes(String(language.glottologLevel)) ||
      !nullableString(language.glottologLanguageParentId) ||
      !nullableString(language.iso6393) ||
      !string(language.name) ||
      !language.name ||
      !nullableString(language.familyId) ||
      !strings(language.macroareas) ||
      !nullableString(language.latitude) ||
      !nullableString(language.longitude) ||
      !strings(language.glottologCountries) ||
      languageByCode.has(language.sourceLanguageCode)
    )
      fail('language association or duplicate code')
    if (
      (language.latitude === null) !== (language.longitude === null) ||
      (language.latitude !== null &&
        (!/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(language.latitude) ||
          !/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(
            language.longitude ?? '',
          ) ||
          !Number.isFinite(Number(language.latitude)) ||
          Number(language.latitude) < -90 ||
          Number(language.latitude) > 90 ||
          !Number.isFinite(Number(language.longitude)) ||
          Number(language.longitude) < -180 ||
          Number(language.longitude) > 180))
    )
      fail('language coordinates')
    languageByCode.set(
      language.sourceLanguageCode,
      language as unknown as AdministrativeSupplement['languageAssociations'][number],
    )
    glottocodes.add(language.glottocode)
  }
  const atlasIds = new Set<string>()
  for (const association of value.atlasAssociations) {
    if (
      !record(association) ||
      !code(association.glottocode, /^[a-z]{4}[0-9]{4}$/) ||
      !glottocodes.has(association.glottocode) ||
      atlasIds.has(association.glottocode) ||
      association.status !== 'unresolved' ||
      association.matchMethod !== null ||
      association.atlasLanguageId !== null
    )
      fail('atlas association')
    atlasIds.add(association.glottocode)
  }
  if (atlasIds.size !== glottocodes.size) fail('missing atlas association')
  const familyById = new Map<string, { readonly id: string; readonly name: string }>()
  for (const family of value.families) {
    if (
      !record(family) ||
      !code(family.id, /^[a-z]{4}[0-9]{4}$/) ||
      !string(family.name) ||
      !family.name.trim() ||
      familyById.has(family.id)
    )
      fail('family record or duplicate ID')
    familyById.set(family.id, { id: family.id, name: family.name })
  }
  const referencedFamilies = new Set(
    [...languageByCode.values()].flatMap((language) =>
      language.familyId ? [language.familyId] : [],
    ),
  )
  if (
    familyById.size !== coverage.familyCount ||
    familyById.size !== referencedFamilies.size ||
    [...referencedFamilies].some((id) => !familyById.has(id))
  )
    fail('family coverage')

  const byTerritory = new Map<string, Observation[]>()
  const byLanguage = new Map<string, Observation[]>()
  const byFamily = new Map<string, Observation[]>()
  const keys = new Set<string>()
  for (const item of value.observations) {
    if (
      !record(item) ||
      !string(item.territoryCode) ||
      !territoryByCode.has(item.territoryCode) ||
      !string(item.sourceLanguageCode) ||
      !languageByCode.has(item.sourceLanguageCode) ||
      !numberString(item.populationPercent, 100) ||
      !numberString(item.speakerCount) ||
      !Number.isSafeInteger(Number(item.speakerCount)) ||
      Math.abs(
        Number(item.speakerCount) -
          (Number(territoryByCode.get(item.territoryCode)?.population) *
            Number(item.populationPercent)) /
            100,
      ) > 1 ||
      ![
        'unspecified',
        'official',
        'official_regional',
        'de_facto_official',
        'official_minority',
      ].includes(String(item.officialStatus)) ||
      !(item.languageLiteracyPercent === null || numberString(item.languageLiteracyPercent, 100)) ||
      !(item.languageWritingPercent === null || numberString(item.languageWritingPercent, 100))
    )
      fail('observation')
    const key = `${item.territoryCode}\0${item.sourceLanguageCode}`
    if (keys.has(key)) fail('duplicate observation')
    keys.add(key)
    const observation = item as unknown as Observation
    const add = (map: Map<string, Observation[]>, id: string) =>
      map.set(id, [...(map.get(id) ?? []), observation])
    add(byTerritory, item.territoryCode)
    add(byLanguage, item.sourceLanguageCode)
    const family = languageByCode.get(item.sourceLanguageCode)?.familyId
    if (family) add(byFamily, family)
  }
  if (
    value.territories.length !== coverage.territoryCount ||
    value.languageAssociations.length !== coverage.sourceLanguageCount ||
    value.observations.length !== coverage.observationCount ||
    glottocodes.size !== coverage.glottocodeCount ||
    [...territoryByCode.keys()].some((id) => !byTerritory.has(id)) ||
    [...languageByCode.keys()].some((id) => !byLanguage.has(id))
  )
    fail('coverage')
  return {
    data: value as unknown as AdministrativeSupplement,
    territoryByCode,
    languageByCode,
    familyById,
    observationsByTerritory: byTerritory,
    observationsByLanguage: byLanguage,
    observationsByFamily: byFamily,
    familyIds: [...byFamily.keys()].sort(),
  }
}

/** A failed fetch or validation is retryable; successful and concurrent calls share one result. */
export function createAdministrativeLoader(request: () => Promise<Response>) {
  let pending: Promise<AdministrativeRepository> | undefined
  return () => {
    pending ??= Promise.resolve()
      .then(request)
      .then(async (response) => {
        if (!response.ok)
          throw new Error(`Could not load administrative data (HTTP ${response.status}).`)
        const body = await response.text()
        if (body.trimStart().startsWith('<'))
          throw new Error('Administrative data is not installed in this workspace.')
        return indexAdministrative(JSON.parse(body) as unknown)
      })
      .catch((error: unknown) => {
        pending = undefined
        throw error
      })
    return pending
  }
}

export const loadAdministrative = createAdministrativeLoader(() =>
  fetch(`${import.meta.env.BASE_URL}administrative/observations.json`),
)
