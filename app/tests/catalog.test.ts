import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Language } from '../src/domain/atlas.ts'
import { buildLanguageSearchIndex, searchCatalog } from '../src/domain/catalog.ts'

const entry = (id: string, level: Language['level'], mapped: boolean): Language => ({
  id,
  classification: { kind: 'glottolog', glottocode: id },
  name: id,
  level,
  parentId: level === 'family' ? null : level === 'language' ? 'family' : 'language',
  parentLanguageId: level === 'dialect' ? 'language' : null,
  alternativeNames: id === 'dialect' ? ['Shànghǎi', '上海'] : [],
  iso6393: null,
  familyId: 'family',
  familyName: 'Example family',
  macroarea: null,
  countries: [],
  latitude: null,
  longitude: null,
  geometryVariantIds: mapped ? [`source:${id}`] : [],
})

const languages = [
  entry('family', 'family', true),
  entry('language', 'language', true),
  entry('dialect', 'dialect', false),
  entry('mapped dialect', 'dialect', true),
]
const index = buildLanguageSearchIndex(languages)

test('empty and whitespace queries retain every level and unmappable entry in catalog order', () => {
  for (const query of ['', '  ']) assert.deepEqual(searchCatalog(index, query), languages)
})

test('alternative names find an unmapped dialect in Latin and original scripts', () => {
  for (const query of [' SHANGHAI ', 'shànghǎi', '上海']) {
    const result = searchCatalog(index, query)
    assert.deepEqual(
      result.map(({ id }) => id),
      ['dialect'],
    )
  }
})

test('ancestor names do not turn every descendant into a direct match', () => {
  assert.deepEqual(searchCatalog(index, 'Example family'), [])
})

test('exact names and identifiers rank before prefixes and incidental alias matches', () => {
  const entries = [
    {
      ...entry('incidental', 'language', false),
      name: 'A language',
      alternativeNames: ['Old English variety'],
    },
    { ...entry('word', 'language', false), name: 'Old English' },
    {
      ...entry('alias-prefix', 'language', false),
      name: 'Creole',
      alternativeNames: ['English creole'],
    },
    { ...entry('prefix', 'language', false), name: 'English-based creole' },
    { ...entry('eng', 'language', false), name: 'English' },
    { ...entry('alias', 'dialect', false), name: 'Another name', alternativeNames: ['English'] },
  ]
  const fixture = buildLanguageSearchIndex(entries)
  assert.deepEqual(
    searchCatalog(fixture, 'english').map(({ id }) => id),
    ['eng', 'alias', 'prefix', 'alias-prefix', 'word', 'incidental'],
  )
  assert.equal(searchCatalog(fixture, 'eng')[0]?.id, 'eng')
})

test('Glottocode and ISO matches rank first even when names do not match', () => {
  const entries = [
    { ...entry('prefix', 'language', false), name: 'Abc lang1234' },
    { ...entry('lang1234', 'language', false), name: 'Example', iso6393: 'abc' },
  ]
  const fixture = buildLanguageSearchIndex(entries)
  for (const query of [' ABC ', 'LANG1234'])
    assert.equal(searchCatalog(fixture, query)[0]?.id, 'lang1234')
})

test('source-defined names, labels and namespaced IDs are searchable without Glottocodes', () => {
  const source: Language = {
    ...entry('dlac1987china:danzhou', 'dialect', true),
    name: 'Danzhou',
    parentId: null,
    parentLanguageId: null,
    classification: {
      kind: 'source',
      datasetId: 'dlac1987china',
      label: 'Danzhou Dialect (Unclassified)',
      note: 'No reviewed equivalent.',
    },
  }
  const fixture = buildLanguageSearchIndex([...languages, source])
  for (const query of ['danzhou', 'DLAC1987CHINA:DANZHOU', 'Dialect (Unclassified)']) {
    assert.deepEqual(searchCatalog(fixture, query), [source])
  }
  assert.deepEqual(searchCatalog(fixture, 'no reviewed equivalent'), [])
})

test('Glottocode lookup is independent of the opaque catalog key', () => {
  const fixture = buildLanguageSearchIndex([
    {
      ...entry('catalog-key', 'language', true),
      classification: { kind: 'glottolog', glottocode: 'lang1234' },
    },
  ])
  assert.equal(searchCatalog(fixture, 'LANG1234')[0]?.id, 'catalog-key')
})

test('relevance ties retain catalog order across queries without mutating the index', () => {
  const entries = [
    { ...entry('a', 'language', false), name: 'Old English' },
    { ...entry('b', 'language', false), name: 'Middle English' },
    { ...entry('c', 'language', false), name: 'English' },
  ]
  const fixture = buildLanguageSearchIndex(entries)
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(searchCatalog(fixture, 'english'), [entries[2], entries[0], entries[1]])
    assert.deepEqual(searchCatalog(fixture, ''), entries)
    assert.deepEqual(searchCatalog(fixture, 'no such name'), [])
  }
})
