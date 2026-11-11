import type { Language } from './atlas.ts'

export interface LexicalLanguage {
  readonly name: string
  readonly iso: string
  readonly glottocode: string
  readonly lat: number | null
  readonly lon: number | null
  readonly status: string
  readonly time: { readonly From?: number; readonly Until?: number }
  readonly path: readonly string[]
  readonly family: string
}

export interface SourceReference {
  readonly FkSourceId: number
  readonly LocationWithinSource?: string
  readonly Note?: string
}

export interface Lexeme {
  readonly l: string
  readonly f: string
  readonly m: string
  readonly note: string
  readonly meaningNote: string
  readonly grammar: string
  readonly ipa: string
  readonly script: string
  readonly refs: readonly SourceReference[]
  readonly stub: boolean
}

export interface WordRelationship {
  readonly id: string
  readonly p: string
  readonly c: string
  readonly t: number
  readonly refs: readonly SourceReference[]
  readonly note: string
}

export interface Concept {
  readonly id: string
  readonly name: string
  readonly groups: readonly { readonly list: string; readonly category: string }[]
  readonly lexemes: readonly string[]
}

export interface EtymologyData {
  readonly schemaVersion: 1
  readonly languages: Readonly<Record<string, LexicalLanguage>>
  readonly lexemes: Readonly<Record<string, Lexeme>>
  readonly edges: readonly WordRelationship[]
  readonly concepts: Readonly<Record<string, Concept>>
  readonly lists: readonly { readonly id: string; readonly name: string }[]
  readonly sources: Readonly<
    Record<
      string,
      {
        readonly CitationKey: string
        readonly FullCitation: string
        readonly Note?: string
        readonly SourceType?: string
      }
    >
  >
  readonly types: Readonly<Record<string, string>>
  readonly meta: Readonly<Record<string, unknown>>
  readonly diagnostics: readonly { readonly languageId: string; readonly message: string }[]
  readonly provenance: {
    readonly adapterVersion: number
    readonly snapshot: string | null
    readonly placeholderSourceId: number
    readonly attribution: string
    readonly inputs: readonly {
      readonly name: string
      readonly sha256: string
      readonly metadata: Readonly<Record<string, unknown>>
    }[]
  }
}

export interface WordTrail {
  readonly ids: readonly string[]
  readonly edges: readonly WordRelationship[]
  readonly hiddenPlaceholders: number
  readonly omitted: number
}

export const MAX_TRAIL_FORMS = 60

export const normalizeWordQuery = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    .toLowerCase()

export const indexEtymology = (data: EtymologyData) => {
  const incoming = new Map<string, WordRelationship[]>()
  const outgoing = new Map<string, WordRelationship[]>()
  const byLanguage = new Map<string, string[]>()
  const wordConcepts = new Map<string, string[]>()
  const append = <T>(map: Map<string, T[]>, id: string, value: T) => {
    const values = map.get(id) ?? []
    values.push(value)
    map.set(id, values)
  }
  for (const edge of data.edges) {
    append(incoming, edge.c, edge)
    append(outgoing, edge.p, edge)
  }
  for (const [id, word] of Object.entries(data.lexemes)) {
    const words = byLanguage.get(word.l) ?? []
    words.push(id)
    byLanguage.set(word.l, words)
  }
  for (const concept of Object.values(data.concepts)) {
    for (const id of concept.lexemes) {
      append(wordConcepts, id, concept.id)
    }
  }
  const search = Object.entries(data.lexemes).map(([id, word]) => ({
    id,
    form: normalizeWordQuery(word.f),
    meaning: normalizeWordQuery(word.m),
    language: normalizeWordQuery(data.languages[word.l]?.name ?? ''),
  }))
  return { incoming, outgoing, byLanguage, wordConcepts, search }
}
export type EtymologyIndex = ReturnType<typeof indexEtymology>
export type EtymologyRepository = { readonly data: EtymologyData; readonly index: EtymologyIndex }

export const buildWordTrail = (
  repository: EtymologyRepository,
  root: string,
  options: {
    depth: number
    branches: boolean
    placeholders: boolean
    expanded: ReadonlySet<string>
  },
): WordTrail => {
  const { data, index } = repository
  if (!Number.isSafeInteger(options.depth) || options.depth < 0)
    throw new RangeError('Trail depth must be a nonnegative safe integer')
  if (!data.lexemes[root]) return { ids: [], edges: [], hiddenPlaceholders: 0, omitted: 0 }
  const ids = new Set([root])
  const hidden = new Set<string>()
  const omitted = new Set<string>()
  const eligible = (id: string) => {
    const word = data.lexemes[id]
    if (!word) return false
    if (word.stub && !options.placeholders) {
      hidden.add(id)
      return false
    }
    return true
  }
  const add = (id: string) => {
    if (ids.has(id) || !eligible(id)) return false
    if (ids.size >= MAX_TRAIL_FORMS) {
      omitted.add(id)
      return false
    }
    ids.add(id)
    return true
  }
  let frontier = [root]
  for (let step = 0; step < options.depth && frontier.length; step++) {
    const next: string[] = []
    for (const id of frontier) {
      for (const edge of index.incoming.get(id) ?? []) if (add(edge.p)) next.push(edge.p)
    }
    frontier = next
  }
  if (options.branches) {
    for (const id of [...ids]) {
      const neighbors = [...new Set((index.outgoing.get(id) ?? []).map((edge) => edge.c))].filter(
        (other) => !ids.has(other) && eligible(other),
      )
      for (const neighbor of neighbors.slice(0, 2)) add(neighbor)
      for (const neighbor of neighbors.slice(2)) omitted.add(neighbor)
    }
  }
  // Expand only reachable forms. Revisit newly visible forms so a restored set of
  // nested expansions does not depend on the set's insertion order.
  const expanded = new Set<string>()
  for (const id of ids) {
    if (!options.expanded.has(id) || expanded.has(id)) continue
    expanded.add(id)
    for (const edge of [...(index.incoming.get(id) ?? []), ...(index.outgoing.get(id) ?? [])]) {
      add(edge.p === id ? edge.c : edge.p)
    }
  }
  return {
    ids: [...ids],
    edges: data.edges.filter((edge) => ids.has(edge.p) && ids.has(edge.c)),
    hiddenPlaceholders: hidden.size,
    omitted: [...omitted].filter((id) => !ids.has(id)).length,
  }
}

// An explicit Glottocode takes precedence. An ISO fallback must be unique on both
// sides; historical stages sharing an ISO code must never be merged by accident.
export const matchAtlasLanguage = (
  lexicalId: string,
  lexicalLanguages: Readonly<Record<string, LexicalLanguage>>,
  atlasLanguages: readonly Language[],
): Language | undefined => {
  const language = lexicalLanguages[lexicalId]
  if (!language) return undefined
  if (language.glottocode) {
    const matches = atlasLanguages.filter(
      (entry) =>
        entry.classification.kind === 'glottolog' &&
        entry.classification.glottocode === language.glottocode,
    )
    return matches.length === 1 ? matches[0] : undefined
  }
  if (!language.iso) return undefined
  const lexicalMatches = Object.values(lexicalLanguages).filter(
    (entry) => entry.iso === language.iso,
  )
  const atlasMatches = atlasLanguages.filter((entry) => entry.iso6393 === language.iso)
  return lexicalMatches.length === 1 && atlasMatches.length === 1 ? atlasMatches[0] : undefined
}

/** Reverse navigation requires a unique exact Glottocode; ISO cannot identify a stage. */
export const matchLexicalLanguage = (
  atlasLanguage: Language,
  lexicalLanguages: Readonly<Record<string, LexicalLanguage>>,
): string | undefined => {
  const classification = atlasLanguage.classification
  if (classification.kind !== 'glottolog' || !classification.glottocode) return undefined
  const matches = Object.entries(lexicalLanguages).filter(
    ([, language]) => language.glottocode === classification.glottocode,
  )
  return matches.length === 1 ? matches[0]?.[0] : undefined
}

const compareWordIds = new Intl.Collator('en', { numeric: true }).compare

export const searchLexemes = (
  { data, index }: EtymologyRepository,
  query: string,
  placeholders: boolean,
  languageId = '',
) => {
  const q = normalizeWordQuery(query.trim())
  const results: { id: string; score: number }[] = []
  if (!q && !languageId) return results
  for (const entry of index.search) {
    const word = data.lexemes[entry.id]
    if (!word || (!placeholders && word.stub) || (languageId && word.l !== languageId)) continue
    const score =
      !q || entry.form === q
        ? 0
        : entry.meaning === q
          ? 1
          : entry.form.startsWith(q)
            ? 2
            : entry.language === q
              ? 3
              : entry.form.includes(q) || entry.meaning.includes(q)
                ? 4
                : entry.language.includes(q)
                  ? 5
                  : 99
    if (score < 99) results.push({ id: entry.id, score })
  }
  return results.sort((a, b) => a.score - b.score || compareWordIds(a.id, b.id))
}

export const hasLanguagePoint = (language: LexicalLanguage) =>
  language.lat !== null &&
  language.lon !== null &&
  Number.isFinite(language.lat) &&
  Number.isFinite(language.lon) &&
  Math.abs(language.lat) <= 90 &&
  Math.abs(language.lon) <= 180
