import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  areaMode,
  areaStatus,
  buildGeographyAvailability,
  inspectedMapAreaIds,
  inspectedSourceVariantIds,
  isAreaAvailable,
  mapAreaMemberships,
  mapAreaSelectionKey,
  mapAreaSourceColors,
  mappedLeavesForLanguage,
  mappedLeavesForLanguages,
  resolveMapAreas as resolveAreas,
} from '../src/domain/aggregation.ts'
import type { AtlasData, GeometryVariant, Language } from '../src/domain/atlas.ts'
import {
  aggregateColor,
  buildColorTopology,
  buildSemanticPalette,
  DEFAULT_COLOR_CONFIGURATION,
  resolveLanguageColors,
} from '../src/domain/colors.ts'
import { buildLanguageHierarchy } from '../src/domain/hierarchy.ts'

const entry = (
  id: string,
  parentId: string | null,
  level: Language['level'] = 'family',
): Language => ({
  id,
  name: id,
  parentId,
  level,
  parentLanguageId: null,
  familyId: null,
  familyName: null,
  alternativeNames: [],
  iso6393: null,
  macroarea: null,
  countries: [],
  latitude: null,
  longitude: null,
  geometryVariantIds: [],
})
const variants: GeometryVariant[] = [
  ['family', 'historic'],
  ['language', 'historic'],
  ['language', 'modern'],
  ['dialect', 'modern'],
  ['nested', 'modern'],
  ['other-dialect', 'modern'],
].map(([languageId = '', datasetId = '']) => ({
  id: `${datasetId}:${languageId}`,
  languageId,
  datasetId,
  layer: datasetId === 'historic' ? 'traditional' : 'contemporary',
  label: datasetId,
  featureId: 1,
  featureCount: 1,
  geometryKind: 'source',
  sourceFile: 'fixture',
  sourceFeatureIds: ['1'],
  color: datasetId === 'historic' ? '#123456' : '#abcdef',
  sourceYear: 2007,
  temporalCoverage: {
    kind: 'named-period',
    viewId: datasetId === 'historic' ? 'time-of-contact' : 'contemporary',
    label: datasetId,
    quality: 'direct',
  },
}))
const languages = [
  entry('family', null),
  entry('language', 'family', 'language'),
  entry('dialect', 'language', 'dialect'),
  entry('nested', 'dialect', 'dialect'),
  entry('unmapped', 'family', 'language'),
  entry('other-dialect', 'unmapped', 'dialect'),
  entry('gap', 'family'),
  entry('gap-leaf', 'gap', 'language'),
  entry('isolate', null, 'language'),
].map((language) => ({
  ...language,
  geometryVariantIds: variants
    .filter((variant) => variant.languageId === language.id)
    .map(({ id }) => id),
}))
const data: AtlasData = {
  manifest: {
    schemaVersion: 4,
    languoidCount: languages.length,
    languoidWithGeometryCount: 5,
    geometryVariantCount: variants.length,
    vectorLayer: 'areas',
    archive: 'fixture',
  },
  languages,
  variants,
  datasets: [],
  languageById: new Map(languages.map((language) => [language.id, language])),
  variantById: new Map(variants.map((variant) => [variant.id, variant])),
  searchTextByLanguageId: new Map(),
}
const hierarchy = buildLanguageHierarchy(languages)
const colors = resolveLanguageColors(
  data,
  { ...DEFAULT_COLOR_CONFIGURATION, strategy: 'categorical' },
  buildSemanticPalette(hierarchy, buildColorTopology(hierarchy)),
)
const resolveMapAreas = (
  ...args: [
    Parameters<typeof resolveAreas>[0],
    Parameters<typeof resolveAreas>[1],
    Parameters<typeof resolveAreas>[2],
  ]
) => resolveAreas(...args, colors)
const availability = (
  period: Parameters<typeof buildGeographyAvailability>[2] = 'all',
  sources: Parameters<typeof buildGeographyAvailability>[3] = 'all',
  overrides = {},
) => buildGeographyAvailability(data, hierarchy, period, sources, overrides)
const required = <T>(value: T | undefined): T => {
  assert.ok(value)
  return value
}

test('mapped leaves traverse every branch to its deepest available geography', () => {
  const leaves = mappedLeavesForLanguage('family', hierarchy, availability())
  assert.deepEqual(leaves.languageIds, ['nested', 'other-dialect'])
  assert.deepEqual(
    [...leaves.subtreeIds].sort(),
    languages
      .filter(({ id }) => id !== 'isolate')
      .map(({ id }) => id)
      .sort(),
    'All subtree entries are visited, including unmapped and collapsed branches',
  )
  const modes = Object.fromEntries(leaves.languageIds.map((id) => [id, 'own' as const]))
  const areas = resolveMapAreas(leaves.languageIds, availability(), modes)
  assert.deepEqual(
    areas.map(({ id }) => id),
    ['modern:nested', 'modern:other-dialect'],
  )
  assert.ok(areas.every(({ mode, variants }) => mode === 'own' && variants.length === 1))
})

test('mapped leaves apply source and period filters before determining the frontier', () => {
  assert.deepEqual(
    mappedLeavesForLanguage('family', hierarchy, availability('all', ['historic'])).languageIds,
    ['language'],
    'A mapped ancestor is retained when all its finer geography is filtered out',
  )
  assert.deepEqual(
    mappedLeavesForLanguage('family', hierarchy, availability('time-of-contact')).languageIds,
    ['language'],
  )
  assert.deepEqual(
    mappedLeavesForLanguage('family', hierarchy, availability('contemporary')).languageIds,
    ['nested', 'other-dialect'],
  )
  assert.deepEqual(
    mappedLeavesForLanguage('family', hierarchy, availability('all', [])).languageIds,
    [],
  )
})

test('bulk mapped leaves deduplicate overlapping matches in any order', () => {
  for (const roots of [
    ['family', 'language', 'nested', 'family'],
    ['nested', 'language', 'family'],
  ]) {
    const leaves = mappedLeavesForLanguages(roots, hierarchy, availability())
    assert.deepEqual(leaves.languageIds, ['nested', 'other-dialect'])
    assert.deepEqual(
      leaves.subtreeIds,
      mappedLeavesForLanguage('family', hierarchy, availability()).subtreeIds,
    )
  }
})

test('bulk mapped leaves include only matched branches and respect geography filters', () => {
  assert.deepEqual(
    mappedLeavesForLanguages(['language', 'gap', 'unknown'], hierarchy, availability()).languageIds,
    ['nested'],
  )
  assert.deepEqual(
    mappedLeavesForLanguages(['language', 'unmapped'], hierarchy, availability()).languageIds,
    ['nested', 'other-dialect'],
  )
  assert.deepEqual(
    mappedLeavesForLanguages(['nested', 'family'], hierarchy, availability('time-of-contact'))
      .languageIds,
    ['language'],
  )
  assert.deepEqual(
    mappedLeavesForLanguages(['family', 'language'], hierarchy, availability('all', []))
      .languageIds,
    [],
  )
  assert.deepEqual(mappedLeavesForLanguages([], hierarchy, availability()).languageIds, [])
})

test('mapped leaves handle subgroups, mapped roots with unmapped children, and missing geography', () => {
  assert.deepEqual(mappedLeavesForLanguage('unmapped', hierarchy, availability()).languageIds, [
    'other-dialect',
  ])
  assert.deepEqual(mappedLeavesForLanguage('nested', hierarchy, availability()).languageIds, [
    'nested',
  ])
  assert.deepEqual(
    mappedLeavesForLanguage('language', hierarchy, availability('time-of-contact')).languageIds,
    ['language'],
  )
  for (const id of ['gap', 'isolate', 'unknown']) {
    assert.deepEqual(mappedLeavesForLanguage(id, hierarchy, availability()).languageIds, [])
  }
})

test('mapped leaves preserve contributor source overrides', () => {
  const alternate = { ...required(data.variantById.get('modern:nested')), id: 'alternate:nested' }
  const withAlternate = {
    ...data,
    languages: languages.map((language) =>
      language.id === 'nested'
        ? { ...language, geometryVariantIds: [...language.geometryVariantIds, alternate.id] }
        : language,
    ),
    variantById: new Map([...data.variantById, [alternate.id, alternate]]),
  }
  const available = buildGeographyAvailability(
    withAlternate,
    buildLanguageHierarchy(withAlternate.languages),
    'all',
    'all',
    { nested: alternate.id },
  )
  const leaves = mappedLeavesForLanguage('family', hierarchy, available)
  assert.deepEqual(leaves.languageIds, ['nested', 'other-dialect'])
  assert.equal(
    resolveMapAreas(leaves.languageIds, available, { nested: 'own' })[0]?.id,
    alternate.id,
  )
})

test('mapped leaf traversal terminates on malformed cyclic classifications', () => {
  const cyclic = buildLanguageHierarchy([entry('a', 'b'), entry('b', 'a')])
  const leaves = mappedLeavesForLanguage('a', cyclic, new Map())
  assert.deepEqual([...leaves.subtreeIds], ['a', 'b'])
  assert.deepEqual(leaves.languageIds, [])
})

test('aggregation excludes the entry itself and stops at the first mapped descendant per branch', () => {
  const all = availability()
  const family = required(all.get('family'))
  assert.equal(areaMode(family), 'own')
  assert.deepEqual(
    family.descendants.map(({ id }) => id),
    ['historic:language', 'modern:other-dialect'],
  )
  assert.deepEqual(
    family.uncoveredBranches.map(({ id }) => id),
    ['gap'],
  )
  assert.equal(areaMode(required(all.get('unmapped'))), 'descendants')
  assert.deepEqual(
    required(all.get('dialect')).descendants.map(({ id }) => id),
    ['modern:nested'],
    'Nested dialect groups aggregate too',
  )
})

test('filters and per-contributor overrides choose one source, then descend past unavailable polygons', () => {
  const modern = required(availability('contemporary').get('family'))
  assert.equal(modern.own, undefined)
  assert.equal(areaMode(modern), 'descendants')
  assert.deepEqual(
    modern.descendants.map(({ id }) => id),
    ['modern:language', 'modern:other-dialect'],
  )
  const historic = required(availability('all', ['historic']).get('family'))
  assert.deepEqual(
    historic.descendants.map(({ id }) => id),
    ['historic:language'],
  )
  assert.deepEqual(
    historic.uncoveredBranches.map(({ id }) => id),
    ['unmapped', 'gap'],
  )
  const overridden = required(
    availability('all', 'all', { language: 'modern:language' }).get('family'),
  )
  assert.deepEqual(
    overridden.descendants.map(({ id }) => id),
    ['modern:language', 'modern:other-dialect'],
  )
  assert.equal(
    required(availability('all', ['historic'], { language: 'modern:language' }).get('language')).own
      ?.id,
    'historic:language',
  )
  const withoutLanguage = {
    ...data,
    languages: data.languages.map((entry) =>
      entry.id === 'language' ? { ...entry, geometryVariantIds: [] } : entry,
    ),
  }
  const descended = required(
    buildGeographyAvailability(
      withoutLanguage,
      buildLanguageHierarchy(withoutLanguage.languages),
      'all',
      'all',
      {},
    ).get('family'),
  )
  assert.deepEqual(
    descended.descendants.map(({ id }) => id),
    ['modern:dialect', 'modern:other-dialect'],
  )
})

test('explicit representation remains chosen when filters make it unavailable', () => {
  const all = availability('contemporary')
  const family = required(all.get('family'))
  assert.equal(areaMode(family, 'own'), 'own')
  assert.equal(areaStatus(family, 'own'), 'Own unavailable')
  assert.equal(isAreaAvailable(family, 'own'), false)
  assert.deepEqual(resolveMapAreas(['family'], all, { family: 'own' }), [])
  assert.equal(resolveMapAreas(['family'], all, { family: 'descendants' }).length, 1)
})

test('no geography anywhere is distinct from geography hidden by source or period filters', () => {
  const all = availability('all', [])
  assert.equal(areaStatus(required(all.get('family')), 'descendants'), 'Filtered out')
  assert.equal(areaStatus(required(all.get('isolate')), 'descendants'), 'No areas')
  assert.equal(isAreaAvailable(undefined), false)
})

test('an aggregate is one selection and can coexist with an independently selected contributor', () => {
  const areas = resolveMapAreas(['family', 'language'], availability(), { family: 'descendants' })
  assert.equal(areas.length, 2)
  assert.equal(areas[0]?.id, 'descendants:family')
  assert.deepEqual(mapAreaMemberships(areas), {
    'historic:language': ['descendants:family', 'historic:language'],
    'modern:other-dialect': ['descendants:family'],
  })
  assert.deepEqual(inspectedMapAreaIds(['historic:language', 'descendants:family'], areas), [
    'descendants:family',
    'historic:language',
  ])
  assert.deepEqual(inspectedSourceVariantIds(['descendants:family'], areas), [
    'historic:language',
    'modern:other-dialect',
  ])
  assert.equal(mapAreaSourceColors(areas)['historic:language'], '#123456')
  assert.equal(mapAreaSourceColors(areas)['modern:other-dialect'], colors.get('family'))
})

test('cache keys include membership and presentation, independent of selection order', () => {
  const all = availability()
  const areas = resolveMapAreas(['family', 'language'], all, { family: 'descendants' })
  assert.equal(mapAreaSelectionKey(areas), mapAreaSelectionKey([...areas].reverse()))
  assert.notEqual(mapAreaSelectionKey(areas), mapAreaSelectionKey(areas, 'blending'))
  assert.notEqual(
    mapAreaSelectionKey(areas),
    mapAreaSelectionKey(resolveMapAreas(['language', 'other-dialect'], all, {})),
  )
  assert.equal(mapAreaSelectionKey(resolveMapAreas(['family'], all, {})), '["historic:family"]')
  assert.match(aggregateColor('family'), /^#[a-f0-9]{6}$/)
})

test('availability terminates defensively with malformed cyclic classifications', () => {
  const cyclic = [entry('a', 'b'), entry('b', 'a')]
  const available = buildGeographyAvailability(
    { ...data, languages: cyclic },
    buildLanguageHierarchy(cyclic),
    'all',
    'all',
    {},
  )
  assert.equal(available.size, 2)
  assert.equal(available.get('a')?.hasAnyAreas, false)
})

test('switching representation and sources preserves the entry color', () => {
  const own = required(resolveMapAreas(['family'], availability(), {})[0])
  const combined = required(
    resolveMapAreas(['family'], availability(), { family: 'descendants' })[0],
  )
  const filtered = required(
    resolveMapAreas(['family'], availability('contemporary'), { family: 'descendants' })[0],
  )
  assert.equal(combined.color, own.color)
  assert.equal(filtered.color, combined.color)
  const unmapped = required(resolveMapAreas(['unmapped'], availability(), {})[0])
  assert.match(unmapped.color, /^#[a-f0-9]{6}$/)
})
