import type {
  AtlasData,
  GeographyDatasetSelection,
  Language,
  TemporalViewSelection,
} from './atlas.ts'
import { geographyVariantsForLanguage } from './geography.ts'

export const normalizeLanguageQuery = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    .toLocaleLowerCase()

// An ancestor's name provides context, not a direct match for every descendant.
export const languageSearchText = (language: Language) =>
  normalizeLanguageQuery(
    [language.name, ...language.alternativeNames, language.id, language.iso6393]
      .filter(Boolean)
      .join(' '),
  )

const matchRank = (language: Language, query: string) => {
  const name = normalizeLanguageQuery(language.name)
  if (language.id === query || language.iso6393 === query || name === query) return 0
  const aliases = language.alternativeNames.map(normalizeLanguageQuery)
  if (aliases.includes(query)) return 1
  if (name.startsWith(query)) return 2
  if (aliases.some((alias) => alias.startsWith(query))) return 3
  if (name.split(/\s+/).some((word) => word.startsWith(query))) return 4
  return 5
}

export const searchCatalog = (
  data: AtlasData,
  query: string,
  viewportIds: ReadonlySet<string> | null,
  temporalSelection: TemporalViewSelection,
  datasetSelection: GeographyDatasetSelection,
) => {
  const normalizedQuery = normalizeLanguageQuery(query.trim())
  const languages = data.languages.filter(
    (language) =>
      (!normalizedQuery ||
        data.searchTextByLanguageId.get(language.id)?.includes(normalizedQuery)) &&
      (viewportIds === null || viewportIds.has(language.id)),
  )
  if (normalizedQuery) {
    const ranks = new Map(
      languages.map((language) => [language.id, matchRank(language, normalizedQuery)]),
    )
    languages.sort((a, b) => (ranks.get(a.id) ?? 0) - (ranks.get(b.id) ?? 0))
  }
  const showableIds = languages
    .filter(
      (language) =>
        geographyVariantsForLanguage(data, language, temporalSelection, datasetSelection).length >
        0,
    )
    .map(({ id }) => id)
  return { languages, showableIds }
}
