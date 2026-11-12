import type { WalsData } from './wals.ts'

/** Validate before indexing. Release inventory/checksums are a separate delivery contract. */
export function validateWalsData(value: unknown): asserts value is WalsData {
  const fail = (path: string): never => {
    throw new Error(`Invalid WALS data: ${path}.`)
  }
  const object = (v: unknown, path: string): Record<string, unknown> =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : fail(path)
  const array = (v: unknown, path: string): unknown[] => (Array.isArray(v) ? v : fail(path))
  const string = (v: unknown, path: string): string => (typeof v === 'string' ? v : fail(path))
  const nonempty = (v: unknown, path: string): string =>
    string(v, path).trim() ? (v as string) : fail(path)
  const integer = (v: unknown, path: string): number =>
    typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : fail(path)
  const link = (v: unknown, path: string) => {
    const text = string(v, path)
    if (!/^https:\/\//.test(text)) fail(path)
    try {
      const url = new URL(text)
      if (url.username || url.password) fail(path)
    } catch {
      fail(path)
    }
  }
  const strings = (v: unknown, path: string) => {
    for (const s of array(v, path)) string(s, path)
  }
  const data = object(value, 'root')
  if (data.schemaVersion !== 1 || data.adapterVersion !== 1)
    fail('unsupported schema/adapter version')
  const provenance = object(data.provenance, 'provenance')
  for (const field of ['snapshot', 'commit', 'sourceUrl'])
    if (provenance[field] !== null) nonempty(provenance[field], `provenance.${field}`)
  if (
    (provenance.snapshot === null) !== (provenance.commit === null) ||
    (provenance.commit === null) !== (provenance.sourceUrl === null)
  )
    fail('incomplete provenance')
  if (provenance.commit !== null && !/^[a-f0-9]{40}$/.test(string(provenance.commit, 'commit')))
    fail('commit')
  if (provenance.sourceUrl !== null) link(provenance.sourceUrl, 'source URL')
  nonempty(provenance.citation, 'citation')
  link(provenance.license, 'license')
  for (const [name, entry] of Object.entries(object(provenance.files, 'input files'))) {
    nonempty(name, 'input name')
    const file = object(entry, name)
    integer(file.bytes, `${name}.bytes`)
    if (!/^[a-f0-9]{64}$/.test(string(file.sha256, `${name}.sha256`))) fail(`${name}.sha256`)
  }
  const notices = object(data.sourceNotices, 'source notices')
  for (const field of ['errata', 'errataPolicy', 'notice'])
    string(notices[field], `notices.${field}`)
  const tables = new Map<string, Record<string, unknown>>()
  for (const name of [
    'records',
    'features',
    'categories',
    'observations',
    'references',
    'examples',
  ]) {
    const table = object(data[name], name)
    for (const [id, entry] of Object.entries(table)) {
      nonempty(id, `${name} ID`)
      object(entry, `${name}.${id}`)
    }
    tables.set(name, table)
  }
  const tableData = (name: string) => tables.get(name) ?? fail(`missing table ${name}`)
  const foreign = (table: string, v: unknown, path: string): string => {
    const id = nonempty(v, path)
    if (!Object.hasOwn(tableData(table), id)) fail(`${path}: unknown ${table} ID ${id}`)
    return id
  }
  const refs = (v: unknown, path: string) => {
    for (const entry of array(v, path)) {
      const ref = object(entry, path)
      foreign('references', ref.sourceId, `${path}.sourceId`)
      string(ref.pages, `${path}.pages`)
    }
  }
  for (const [id, entry] of Object.entries(tableData('references'))) {
    const ref = object(entry, id)
    nonempty(ref.type, `${id}.type`)
    link(ref.url, `${id}.url`)
    for (const [field, text] of Object.entries(object(ref.fields, `${id}.fields`)))
      string(text, `${id}.${field}`)
  }
  for (const [id, entry] of Object.entries(tableData('records'))) {
    if (/^(family|subfamily|genus)-/.test(id)) fail(`${id}: classification node`)
    const record = object(entry, id)
    nonempty(record.name, `${id}.name`)
    for (const field of ['macroarea', 'family', 'subfamily', 'genus'])
      string(record[field], `${id}.${field}`)
    for (const field of ['glottocode', 'iso6393'])
      if (record[field] !== null) nonempty(record[field], `${id}.${field}`)
    strings(record.isoCodes, `${id}.isoCodes`)
    if (record.coordinates !== null) {
      const point = array(record.coordinates, `${id}.coordinates`)
      if (
        point.length !== 2 ||
        point.some(
          (n, i) =>
            typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > (i === 0 ? 180 : 90),
        )
      )
        fail(`${id}.coordinates`)
    }
    refs(record.references, `${id}.references`)
    link(record.url, `${id}.url`)
  }
  for (const [id, entry] of Object.entries(tableData('features'))) {
    const feature = object(entry, id)
    for (const field of [
      'name',
      'description',
      'chapterId',
      'chapterTitle',
      'chapterCitation',
      'contributors',
      'area',
    ])
      string(feature[field], `${id}.${field}`)
    refs(feature.references, `${id}.references`)
    link(feature.url, `${id}.url`)
    link(feature.chapterUrl, `${id}.chapterUrl`)
  }
  const numbers = new Map<string, Set<number>>()
  for (const [id, entry] of Object.entries(tableData('categories'))) {
    const category = object(entry, id)
    const feature = foreign('features', category.featureId, `${id}.featureId`)
    const number = integer(category.number, `${id}.number`)
    const used = numbers.get(feature) ?? new Set<number>()
    if (number === 0 || used.has(number)) fail(`${id}: duplicate/invalid category number`)
    used.add(number)
    numbers.set(feature, used)
    string(category.name, `${id}.name`)
    string(category.description, `${id}.description`)
  }
  for (const [id, entry] of Object.entries(tableData('examples'))) {
    const example = object(entry, id)
    foreign('records', example.sourceId, `${id}.sourceId`)
    for (const field of ['text', 'analyzed', 'gloss', 'translation', 'comment'])
      string(example[field], `${id}.${field}`)
    link(example.url, `${id}.url`)
  }
  const pairs = new Map<string, Set<string>>()
  for (const [id, entry] of Object.entries(tableData('observations'))) {
    const observation = object(entry, id)
    const source = foreign('records', observation.sourceId, `${id}.sourceId`)
    const feature = foreign('features', observation.featureId, `${id}.featureId`)
    const category = foreign('categories', observation.categoryId, `${id}.categoryId`)
    if (object(tableData('categories')[category], category).featureId !== feature)
      fail(`${id}: category membership`)
    const used = pairs.get(source) ?? new Set<string>()
    if (used.has(feature)) fail(`${id}: duplicate source-feature observation`)
    used.add(feature)
    pairs.set(source, used)
    refs(observation.references, `${id}.references`)
    for (const example of array(observation.exampleIds, `${id}.exampleIds`))
      foreign('examples', example, `${id}.exampleIds`)
    string(observation.comment, `${id}.comment`)
    link(observation.url, `${id}.url`)
  }
  const diagnostics = object(data.diagnostics, 'diagnostics')
  for (const [name, n] of Object.entries(object(diagnostics.counts, 'counts')))
    integer(n, `counts.${name}`)
  for (const [id, n] of Object.entries(
    object(diagnostics.observationsByFeature, 'feature counts'),
  )) {
    foreign('features', id, 'feature count ID')
    integer(n, `feature counts.${id}`)
  }
  for (const entry of array(diagnostics.missingCoordinates, 'missing coordinates')) {
    const missing = object(entry, 'missing coordinate')
    const source = foreign('records', missing.sourceId, 'missing coordinate source')
    if (
      object(tableData('records')[source], source).coordinates !== null ||
      !['missing', 'incomplete'].includes(string(missing.reason, 'coordinate reason'))
    )
      fail('missing coordinate diagnostic')
  }
  for (const id of array(diagnostics.referencesWithoutTitle, 'references without title'))
    foreign('references', id, 'reference without title')
  strings(diagnostics.checks, 'checks')
}
