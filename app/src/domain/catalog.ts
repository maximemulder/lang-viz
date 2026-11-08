import type { Language, LanguageId } from './atlas.ts'

export interface LanguageSearchEntry {
  readonly language: Language
  readonly text: string
  readonly name: string
  readonly aliases: readonly string[]
  readonly words: readonly string[]
}

/** Insertion order is catalog order, which breaks relevance ties. */
export type LanguageSearchIndex = ReadonlyMap<LanguageId, LanguageSearchEntry>

export const normalizeLanguageQuery = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    .toLocaleLowerCase()

/** Build once when loading the catalog, independently of geometry and map selection. */
export const buildLanguageSearchIndex = (languages: readonly Language[]): LanguageSearchIndex =>
  new Map(
    languages.map((language) => {
      const name = normalizeLanguageQuery(language.name)
      const aliases = language.alternativeNames.map(normalizeLanguageQuery)
      // An ancestor's name provides context, not a direct match for every descendant.
      const text = normalizeLanguageQuery(
        [language.name, ...language.alternativeNames, language.id, language.iso6393]
          .filter(Boolean)
          .join(' '),
      )
      return [language.id, { language, text, name, aliases, words: name.split(/\s+/) }]
    }),
  )

/** The caller normalizes/trims once for a batch of candidates. */
export const matchesLanguageQuery = (
  entry: LanguageSearchEntry | undefined,
  normalizedQuery: string,
) => Boolean(entry && (!normalizedQuery || entry.text.includes(normalizedQuery)))

const matchRank = ({ language, name, aliases, words }: LanguageSearchEntry, query: string) => {
  if (language.id === query || language.iso6393 === query || name === query) return 0
  if (aliases.includes(query)) return 1
  if (name.startsWith(query)) return 2
  if (aliases.some((alias) => alias.startsWith(query))) return 3
  if (words.some((word) => word.startsWith(query))) return 4
  return 5
}

/** Text matches only. Geographic scope and availability belong to result preparation. */
export const searchCatalog = (index: LanguageSearchIndex, query: string): readonly Language[] => {
  const normalizedQuery = normalizeLanguageQuery(query.trim())
  const matches = [...index.values()].filter((entry) =>
    matchesLanguageQuery(entry, normalizedQuery),
  )
  if (!normalizedQuery) return matches.map(({ language }) => language)
  return matches
    .map((entry) => ({ language: entry.language, rank: matchRank(entry, normalizedQuery) }))
    .sort((a, b) => a.rank - b.rank)
    .map(({ language }) => language)
}
