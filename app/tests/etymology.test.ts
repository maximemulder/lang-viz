import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Language } from '../src/domain/atlas.ts'
import {
  buildWordTrail,
  type EtymologyData,
  type EtymologyRepository,
  indexEtymology,
  type Lexeme,
  type LexicalLanguage,
  matchAtlasLanguage,
  matchLexicalLanguage,
  searchLexemes,
  type WordRelationship,
} from '../src/domain/etymology.ts'
import {
  splitFocalLink,
  trailLineFeatures,
  trailLocations,
} from '../src/domain/wordTrailGeography.ts'
import { layoutTrail } from '../src/domain/wordTrailLayout.ts'

const language = (overrides: Partial<LexicalLanguage> = {}): LexicalLanguage => ({
  name: 'Latin',
  iso: 'lat',
  glottocode: 'lati1261',
  lat: 0,
  lon: 0,
  status: 'Attested',
  time: {},
  path: ['Indo-European', 'Latin'],
  family: 'Indo-European',
  ...overrides,
})
const word = (overrides: Partial<Lexeme> = {}): Lexeme => ({
  l: '10',
  f: 'vīnum',
  m: 'wine',
  note: '',
  meaningNote: '',
  grammar: '',
  ipa: '',
  script: '',
  refs: [],
  stub: false,
  ...overrides,
})
const edge = (p: string, c: string, id = `${p}-${c}`): WordRelationship => ({
  id,
  p,
  c,
  t: 1,
  refs: [],
  note: '',
})
const fixture = (
  edges: readonly WordRelationship[] = [],
  lexemes: Record<string, Lexeme> = { root: word() },
): EtymologyRepository => {
  const data: EtymologyData = {
    schemaVersion: 1,
    languages: { '10': language() },
    lexemes: Object.fromEntries([
      ...edges.flatMap(({ p, c }) => [
        [p, word()],
        [c, word()],
      ]),
      ...Object.entries(lexemes),
    ]),
    edges,
    concepts: {},
    lists: [],
    sources: {},
    types: { '1': 'Inherited' },
    meta: {},
    diagnostics: [],
    provenance: {
      adapterVersion: 1,
      snapshot: null,
      placeholderSourceId: 999,
      attribution: '',
      inputs: [],
    },
  }
  return { data, index: indexEtymology(data) }
}
const options = { depth: 4, branches: false, placeholders: false, expanded: new Set<string>() }

const atlasLanguage = (id: string, overrides: Partial<Language> = {}): Language => ({
  id,
  classification: { kind: 'glottolog', glottocode: 'lati1261' },
  name: 'Latin',
  level: 'language',
  parentId: null,
  parentLanguageId: null,
  alternativeNames: [],
  iso6393: 'lat',
  familyId: null,
  familyName: null,
  macroarea: null,
  countries: [],
  latitude: null,
  longitude: null,
  geometryVariantIds: [],
  ...overrides,
})

test('forward matching uses classification metadata, never an opaque catalog ID', () => {
  const lexical = { '10': language() }
  const atlas = atlasLanguage('catalog:latin')
  assert.equal(matchAtlasLanguage('10', lexical, [atlas]), atlas)
  const source = atlasLanguage('lati1261', {
    classification: { kind: 'source', datasetId: 'source', label: 'Latin area', note: '' },
  })
  assert.equal(matchAtlasLanguage('10', lexical, [source]), undefined)
  assert.equal(matchAtlasLanguage('10', lexical, [atlas, { ...atlas, id: 'duplicate' }]), undefined)
  assert.equal(matchAtlasLanguage('unknown', lexical, [atlas]), undefined)
})

test('an unmatched explicit Glottocode never falls back to a modern ISO match', () => {
  const lexical = { '10': language({ glottocode: 'historic' }) }
  assert.equal(matchAtlasLanguage('10', lexical, [atlasLanguage('modern')]), undefined)
})

test('ISO fallback requires uniqueness on both complete lexical and atlas catalogs', () => {
  const latin = language({ glottocode: '' })
  const lexical = { '10': latin }
  const atlas = atlasLanguage('latin')
  assert.equal(matchAtlasLanguage('10', lexical, [atlas]), atlas)
  assert.equal(matchAtlasLanguage('10', { ...lexical, old: latin }, [atlas]), undefined)
  assert.equal(matchAtlasLanguage('10', lexical, [atlas, { ...atlas, id: 'old' }]), undefined)
  assert.equal(
    matchAtlasLanguage('10', { '10': language({ iso: '', glottocode: '' }) }, [atlas]),
    undefined,
  )
})

test('reverse matching requires a unique exact Glottocode and rejects source classifications', () => {
  const lexical = { '10': language() }
  assert.equal(matchLexicalLanguage(atlasLanguage('opaque'), lexical), '10')
  assert.equal(
    matchLexicalLanguage(atlasLanguage('opaque'), { ...lexical, old: language() }),
    undefined,
  )
  assert.equal(
    matchLexicalLanguage(atlasLanguage('opaque'), { '10': language({ glottocode: '' }) }),
    undefined,
  )
  assert.equal(
    matchLexicalLanguage(
      atlasLanguage('lati1261', {
        classification: { kind: 'source', datasetId: 'source', label: 'Latin', note: '' },
      }),
      lexical,
    ),
    undefined,
  )
})

test('placeholder hiding interrupts ancestry without inventing shortcut relationships', () => {
  const repo = fixture([edge('ancestor', 'stub'), edge('stub', 'root')], {
    stub: word({ stub: true }),
  })
  const hidden = buildWordTrail(repo, 'root', options)
  assert.deepEqual(hidden, { ids: ['root'], edges: [], hiddenPlaceholders: 1, omitted: 0 })
  assert.deepEqual(buildWordTrail(repo, 'root', { ...options, placeholders: true }).ids, [
    'root',
    'stub',
    'ancestor',
  ])
})

test('cycles terminate and multiple parent edges remain visible', () => {
  const repo = fixture([edge('a', 'b'), edge('b', 'a'), edge('a', 'root'), edge('b', 'root')])
  const trail = buildWordTrail(repo, 'root', { ...options, depth: 100 })
  assert.equal(trail.ids.length, 3)
  assert.equal(trail.edges.length, 4)
  const layout = layoutTrail(trail)
  assert.equal(layout.cyclic, true)
  assert.equal(layout.points.size, 3)
  assert.ok(Number.isFinite(layout.width) && Number.isFinite(layout.height))
})

test('cap omissions count distinct unseen forms even when several edges reach them', () => {
  const edges = Array.from({ length: 90 }, (_, i) => edge(String(i), 'root'))
  edges.push(edge('89', 'root', 'duplicate-evidence'))
  const trail = buildWordTrail(fixture(edges), 'root', options)
  assert.equal(trail.ids.length, 60)
  assert.equal(trail.omitted, 31)
})

test('side branches are bounded, and explicit expansion clears their omissions', () => {
  const repo = fixture([
    edge('parent', 'root'),
    ...['a', 'b', 'c', 'd'].map((id) => edge('parent', id)),
  ])
  const small = buildWordTrail(repo, 'root', { ...options, branches: true })
  assert.deepEqual(small.ids, ['root', 'parent', 'a', 'b'])
  assert.equal(small.omitted, 2)
  const expanded = buildWordTrail(repo, 'root', {
    ...options,
    branches: true,
    expanded: new Set(['parent']),
  })
  assert.equal(expanded.ids.length, 6)
  assert.equal(expanded.omitted, 0)
})

test('restored nested expansions are reachable and independent of set insertion order', () => {
  const repo = fixture([
    edge('root', 'a'),
    edge('a', 'b'),
    edge('b', 'c'),
    edge('unrelated', 'other'),
  ])
  const a = buildWordTrail(repo, 'root', {
    ...options,
    expanded: new Set(['a', 'root', 'unrelated']),
  })
  const b = buildWordTrail(repo, 'root', {
    ...options,
    expanded: new Set(['root', 'a', 'unrelated']),
  })
  assert.deepEqual(a, b)
  assert.deepEqual(a.ids, ['root', 'a', 'b'])
})

test('unknown roots are empty and invalid traversal depths fail explicitly', () => {
  assert.deepEqual(buildWordTrail(fixture(), 'unknown', options).ids, [])
  for (const depth of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => buildWordTrail(fixture(), 'root', { ...options, depth }), RangeError)
  }
})

test('acyclic layout respects multiple parents and identifies self-links as cycles', () => {
  const trail = buildWordTrail(fixture([edge('a', 'root'), edge('b', 'root')]), 'root', options)
  const layout = layoutTrail(trail)
  assert.equal(layout.cyclic, false)
  assert.ok((layout.points.get('a')?.x ?? 0) < (layout.points.get('root')?.x ?? 0))
  assert.equal(
    layoutTrail(buildWordTrail(fixture([edge('root', 'root')]), 'root', options)).cyclic,
    true,
  )
  assert.ok(layoutTrail({ ids: [], edges: [], hiddenPlaceholders: 0, omitted: 0 }).width > 0)
})

test('normalized search ranks forms before meanings and honors language and placeholder scopes', () => {
  const repo = fixture([], {
    '10': word({ f: 'VĪNUM' }),
    '2': word({ f: 'vinum' }),
    '3': word({ f: 'vino', m: 'vinum' }),
    '4': word({ f: 'vinum', stub: true }),
    '5': word({ l: '20', f: 'vinum' }),
  })
  const data = {
    ...repo.data,
    languages: { ...repo.data.languages, '20': language({ name: 'Other' }) },
  }
  const repository = { data, index: indexEtymology(data) }
  assert.deepEqual(
    searchLexemes(repository, ' vīnum ', false).map(({ id }) => id),
    ['2', '5', '10', '3'],
  )
  assert.deepEqual(
    searchLexemes(repository, '', false, '20').map(({ id }) => id),
    ['5'],
  )
  assert.ok(searchLexemes(repository, 'vinum', true).some(({ id }) => id === '4'))
  assert.deepEqual(searchLexemes(repository, '', false), [])
  assert.deepEqual(searchLexemes(repository, 'absent', false), [])
})

test('index retains distinct word-concept memberships and all relationship evidence', () => {
  const repo = fixture([edge('a', 'root', 'first'), edge('a', 'root', 'second')])
  const data = {
    ...repo.data,
    concepts: { wine: { id: 'wine', name: 'wine', groups: [], lexemes: ['root'] } },
  }
  const index = indexEtymology(data)
  assert.deepEqual(index.wordConcepts.get('root'), ['wine'])
  assert.equal(index.incoming.get('root')?.length, 2)
  assert.equal(index.byLanguage.get('10')?.length, 2)
})

test('focal links split safely across the antimeridian in both directions', () => {
  assert.deepEqual(splitFocalLink([170, 10], [-170, 30]), [
    [
      [170, 10],
      [180, 20],
    ],
    [
      [-180, 20],
      [-170, 30],
    ],
  ])
  assert.deepEqual(splitFocalLink([-170, 30], [170, 10]), [
    [
      [-170, 30],
      [-180, 20],
    ],
    [
      [180, 20],
      [170, 10],
    ],
  ])
  assert.deepEqual(splitFocalLink([0, 0], [10, 10]), [
    [
      [0, 0],
      [10, 10],
    ],
  ])
  assert.deepEqual(splitFocalLink([-180, 0], [180, 10]), [
    [
      [-180, 0],
      [-180, 10],
    ],
  ])
})

test('map helpers retain zero coordinates, group shared stages, and leave graph membership intact', () => {
  const repo = fixture([edge('ancestor', 'root')])
  const trail = buildWordTrail(repo, 'root', options)
  assert.equal(trailLocations(repo.data, trail).length, 1)
  assert.equal(trailLocations(repo.data, trail)[0]?.ids.length, 2)
  assert.equal(trailLineFeatures(repo.data, trail).features.length, 1)
  for (const point of [{ lat: null }, { lon: 181 }, { lat: Number.NaN }]) {
    const data = { ...repo.data, languages: { '10': language(point) } }
    assert.equal(trailLocations(data, trail).length, 0)
    assert.equal(trailLineFeatures(data, trail).features.length, 0)
    assert.equal(trail.ids.length, 2)
  }
})
