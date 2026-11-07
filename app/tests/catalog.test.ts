import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AtlasData, GeometryVariant, Language } from '../src/domain/atlas.ts'
import { languageSearchText, searchCatalog } from '../src/domain/catalog.ts'

const entry = (id: string, level: Language['level'], mapped: boolean): Language => ({
  id,
  name: id,
  level,
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
const variants: GeometryVariant[] = languages.flatMap((language) =>
  language.geometryVariantIds.map((id) => ({
    id,
    languageId: language.id,
    datasetId: 'example',
    layer: 'contemporary',
    label: 'Example contemporary areas',
    featureId: 1,
    featureCount: 2,
    geometryKind: 'source',
    sourceFile: 'features.geojson',
    sourceFeatureIds: ['a', 'b'],
    color: '#abcdef',
    temporalCoverage: {
      kind: 'named-period',
      viewId: 'contemporary',
      label: 'Contemporary',
      quality: 'approximate',
    },
    sourceYear: 2007,
  })),
)
const data: AtlasData = {
  manifest: {
    schemaVersion: 3,
    languoidCount: 4,
    languoidWithGeometryCount: 3,
    geometryVariantCount: 3,
    vectorLayer: 'language_areas',
    archive: 'language-areas.pmtiles',
  },
  languages,
  variants,
  datasets: [],
  languageById: new Map(languages.map((language) => [language.id, language])),
  variantById: new Map(variants.map((variant) => [variant.id, variant])),
  searchTextByLanguageId: new Map(
    languages.map((language) => [language.id, languageSearchText(language)]),
  ),
}

test('all levels and unmappable entries are discoverable; bulk selection uses polygons only', () => {
  const result = searchCatalog(data, '', null, 'all', 'all')
  assert.equal(result.languages.length, 4)
  assert.deepEqual(result.showableIds, ['family', 'language', 'mapped dialect'])
})

test('alternative names find an unmapped dialect in Latin and original scripts', () => {
  for (const query of [' shanghai ', '上海']) {
    const result = searchCatalog(data, query, null, 'all', 'all')
    assert.deepEqual(
      result.languages.map(({ id }) => id),
      ['dialect'],
    )
    assert.deepEqual(result.showableIds, [])
  }
})

test('source and period selections affect mappability without erasing search results', () => {
  for (const [period, sources] of [
    ['year-1750', 'all'],
    ['all', []],
    ['all', ['other-source']],
  ] as const) {
    const result = searchCatalog(data, '', null, period, sources)
    assert.equal(result.languages.length, 4)
    assert.deepEqual(result.showableIds, [])
  }
})

test('the explicitly selected viewport scope still limits the catalog', () => {
  const result = searchCatalog(data, '', new Set(['mapped dialect']), 'all', 'all')
  assert.deepEqual(
    result.languages.map(({ id }) => id),
    ['mapped dialect'],
  )
  assert.deepEqual(result.showableIds, ['mapped dialect'])
})
