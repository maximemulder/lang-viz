import type { EtymologyData } from './etymology.ts'

/** Validate the browser contract before indexing. Release checksum verification belongs to delivery. */
export function validateEtymologyData(value: unknown): asserts value is EtymologyData {
  const fail = (path: string): never => {
    throw new Error(`Invalid word-history data: ${path}.`)
  }
  const record = (v: unknown, path: string): Record<string, unknown> =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : fail(path)
  const array = (v: unknown, path: string): unknown[] => (Array.isArray(v) ? v : fail(path))
  const string = (v: unknown, path: string) => typeof v === 'string' || fail(path)
  const id = (v: unknown, path: string): string =>
    typeof v === 'string' && /^(0|[1-9]\d*)$/.test(v) ? v : fail(path)
  const integer = (v: unknown, path: string) => Number.isSafeInteger(v) || fail(path)
  const data = record(value, 'root')
  if (data.schemaVersion !== 1) fail('unsupported schema version')
  const provenance = record(data.provenance, 'provenance')
  if (provenance.adapterVersion !== 1) fail('unsupported adapter version')
  if (provenance.snapshot !== null) string(provenance.snapshot, 'snapshot')
  integer(provenance.placeholderSourceId, 'placeholder source')
  string(provenance.attribution, 'attribution')
  for (const entry of array(provenance.inputs, 'inputs')) {
    const input = record(entry, 'input')
    string(input.name, 'input name')
    if (typeof input.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(input.sha256)) fail('input hash')
    record(input.metadata, 'input metadata')
  }
  record(data.meta, 'metadata')
  for (const entry of array(data.diagnostics, 'diagnostics')) {
    const diagnostic = record(entry, 'diagnostic')
    id(diagnostic.languageId, 'diagnostic language')
    string(diagnostic.message, 'diagnostic message')
  }
  const languages = record(data.languages, 'languages')
  const words = record(data.lexemes, 'lexemes')
  const sources = record(data.sources, 'sources')
  const types = record(data.types, 'relationship types')
  const has = (r: Record<string, unknown>, key: string) => Object.hasOwn(r, key)
  for (const [key, entry] of Object.entries(sources)) {
    id(key, 'source id')
    const source = record(entry, 'source')
    string(source.CitationKey, 'source citation key')
    string(source.FullCitation, 'source citation')
    for (const field of ['Note', 'SourceType'])
      if (source[field] !== undefined) string(source[field], `source ${field}`)
  }
  const references = (v: unknown) => {
    for (const entry of array(v, 'references')) {
      const ref = record(entry, 'reference')
      integer(ref.FkSourceId, 'reference source id')
      if (!has(sources, String(ref.FkSourceId))) fail('unknown source reference')
      for (const field of ['LocationWithinSource', 'Note'])
        if (ref[field] !== undefined) string(ref[field], `reference ${field}`)
    }
  }
  for (const [key, entry] of Object.entries(languages)) {
    id(key, 'language id')
    const language = record(entry, 'language')
    for (const field of ['name', 'iso', 'glottocode', 'status', 'family'])
      string(language[field], `language ${field}`)
    for (const label of array(language.path, 'language path')) string(label, 'path label')
    for (const [field, limit] of [
      ['lat', 90],
      ['lon', 180],
    ] as const) {
      const number = language[field]
      if (
        number !== null &&
        (typeof number !== 'number' || !Number.isFinite(number) || Math.abs(number) > limit)
      )
        fail(`language ${field}`)
    }
    if ((language.lat === null) !== (language.lon === null)) fail('partial coordinates')
    const time = record(language.time, 'language time')
    for (const field of ['From', 'Until'])
      if (time[field] !== undefined) integer(time[field], `time ${field}`)
    if (typeof time.From === 'number' && typeof time.Until === 'number' && time.From > time.Until)
      fail('reversed time')
  }
  for (const [key, entry] of Object.entries(words)) {
    id(key, 'word id')
    const word = record(entry, 'word')
    if (!has(languages, id(word.l, 'word language'))) fail('unknown word language')
    for (const field of ['f', 'm', 'note', 'meaningNote', 'grammar', 'ipa', 'script'])
      string(word[field], `word ${field}`)
    if (typeof word.stub !== 'boolean') fail('placeholder flag')
    references(word.refs)
  }
  for (const [key, label] of Object.entries(types)) {
    id(key, 'relationship type')
    string(label, 'relationship label')
  }
  const edgeIds = new Set<string>()
  for (const entry of array(data.edges, 'relationships')) {
    const edge = record(entry, 'relationship')
    const key = id(edge.id, 'relationship id')
    if (edgeIds.has(key)) fail('duplicate relationship id')
    edgeIds.add(key)
    for (const field of ['p', 'c'])
      if (!has(words, id(edge[field], 'relationship endpoint')))
        fail('unknown relationship endpoint')
    integer(edge.t, 'relationship type')
    if (!has(types, String(edge.t))) fail('unknown relationship type')
    string(edge.note, 'relationship note')
    references(edge.refs)
  }
  const lists = new Set<string>()
  for (const entry of array(data.lists, 'collections')) {
    const list = record(entry, 'collection')
    const key = id(list.id, 'collection id')
    if (lists.has(key)) fail('duplicate collection id')
    lists.add(key)
    string(list.name, 'collection name')
  }
  for (const [key, entry] of Object.entries(record(data.concepts, 'concepts'))) {
    const concept = record(entry, 'concept')
    if (id(concept.id, 'concept id') !== key) fail('concept key')
    string(concept.name, 'concept name')
    for (const word of array(concept.lexemes, 'concept words'))
      if (!has(words, id(word, 'concept word'))) fail('unknown concept word')
    for (const entry of array(concept.groups, 'concept groups')) {
      const group = record(entry, 'concept group')
      if (!lists.has(id(group.list, 'group collection'))) fail('unknown group collection')
      string(group.category, 'group category')
    }
  }
}
