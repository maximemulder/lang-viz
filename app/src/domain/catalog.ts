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

export const languageSearchText = (language: Language) =>
  normalizeLanguageQuery(
    [
      language.name,
      ...language.alternativeNames,
      language.id,
      language.iso6393,
      language.familyName,
    ]
      .filter(Boolean)
      .join(' '),
  )

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
  const showableIds = languages
    .filter(
      (language) =>
        geographyVariantsForLanguage(data, language, temporalSelection, datasetSelection).length >
        0,
    )
    .map(({ id }) => id)
  return { languages, showableIds }
}
