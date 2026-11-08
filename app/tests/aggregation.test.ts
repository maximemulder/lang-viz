import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  type AreaMode,
  areaMode,
  areaStatus,
  buildGeographyAvailability,
  inspectedMapAreaIds,
  inspectedSourceVariantIds,
  isAreaAvailable,
  mapAreaMemberships,
  mapAreaSelectionKey,
  mapAreaSourceColors,
  mappedBranchForLanguage,
  mappedBranchForLanguages,
} from '../src/domain/aggregation.ts'
import type { AtlasData, GeometryVariant, Language } from '../src/domain/atlas.ts'
import { buildBranchMapEntries } from '../src/domain/branches.ts'
import { buildLanguageSearchIndex, searchCatalog } from '../src/domain/catalog.ts'
import {
  aggregateColor,
  buildColorTopology,
  buildSemanticPalette,
  DEFAULT_COLOR_CONFIGURATION,
  resolveLanguageColors,
} from '../src/domain/colors.ts'
import { prepareExploreResults } from '../src/domain/exploration.ts'
import { buildLanguageHierarchy, flattenLanguageHierarchy } from '../src/domain/hierarchy.ts'
import {
  addMapEntries,
  draftRepresentationKey,
  geographyContextKey,
  mapEntryKey,
  pinMapEntry,
  replaceSubtreeMapEntries,
  resolveMapEntries,
} from '../src/domain/mapEntries.ts'

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
  languageSearchIndex: buildLanguageSearchIndex(languages),
}
const hierarchy = buildLanguageHierarchy(languages)
const colors = resolveLanguageColors(
  data,
  { ...DEFAULT_COLOR_CONFIGURATION, strategy: 'categorical' },
  buildSemanticPalette(hierarchy, buildColorTopology(hierarchy)),
)
const resolveMapAreas = (
  ids: readonly string[],
  available: ReturnType<typeof buildGeographyAvailability>,
  modes: Readonly<Record<string, AreaMode>>,
  catalog: AtlasData = data,
) =>
  resolveMapEntries(
    ids.flatMap((id) => {
      const entry = pinMapEntry(id, available.get(id), modes[id], { sources: 'all', period: 'all' })
      return entry ? [entry] : []
    }),
    catalog,
    colors,
  )
const availability = (
  period: Parameters<typeof buildGeographyAvailability>[2] = 'all',
  sources: Parameters<typeof buildGeographyAvailability>[3] = 'all',
  overrides = {},
) => buildGeographyAvailability(data, hierarchy, period, sources, overrides)
const required = <T>(value: T | undefined): T => {
  assert.ok(value)
  return value
}

const explore = (
  matches: readonly Language[],
  overrides: Partial<Parameters<typeof prepareExploreResults>[0]> = {},
) =>
  prepareExploreResults({
    matches,
    hierarchy,
    browseRoots: false,
    viewportLanguageIds: null,
    availability: availability(),
    modes: {},
    ...overrides,
  })

test('branch plans pin mapped ancestors and descendants under topmost requested roots across gaps', () => {
  const context = { sources: ['modern', 'historic', 'modern'], period: 'all' as const }
  const available = availability('all', 'all', { language: 'historic:language' })
  const plan = buildBranchMapEntries(
    ['dialect', 'family', 'other-dialect', 'family', 'unknown'],
    hierarchy,
    available,
    context,
  )
  assert.deepEqual(plan.languageIds, ['nested', 'dialect', 'language', 'other-dialect', 'family'])
  assert.ok(plan.subtreeIds.has('gap-leaf'), 'Unmapped descendants are part of the replacement')
  assert.ok(!plan.subtreeIds.has('isolate'))
  assert.deepEqual(
    plan.entries.map(({ languageId, mode, branchRootId, colorRootId, context }) => ({
      languageId,
      mode,
      branchRootId,
      colorRootId,
      context,
    })),
    plan.languageIds.map((languageId) => ({
      languageId,
      mode: 'own',
      branchRootId: 'family',
      colorRootId: 'family',
      context: { sources: ['historic', 'modern'], period: 'all' },
    })),
  )
  assert.deepEqual(plan.entries.find(({ languageId }) => languageId === 'language')?.variantIds, [
    'historic:language',
  ])
  const focused = buildBranchMapEntries(['dialect'], hierarchy, available, context)
  assert.deepEqual(focused.languageIds, ['nested', 'dialect'])
  assert.ok(focused.entries.every(({ branchRootId }) => branchRootId === 'dialect'))
  assert.deepEqual(buildBranchMapEntries(['isolate'], hierarchy, available, context).entries, [])
})

test('Explore groups available representations stably without erasing unavailable text matches', () => {
  const matches = searchCatalog(data.languageSearchIndex, '')
  const result = explore(matches)
  assert.deepEqual(result.showableIds, [
    'family',
    'language',
    'dialect',
    'nested',
    'unmapped',
    'other-dialect',
  ])
  assert.deepEqual(
    result.roots.map(({ id }) => id),
    [...result.showableIds, 'gap', 'gap-leaf', 'isolate'],
  )
  assert.equal(matches.length, languages.length)
  for (const available of [availability('year-1750'), availability('all', [])]) {
    const filtered = explore(matches, { availability: available })
    assert.deepEqual(filtered.roots, matches)
    assert.deepEqual(filtered.showableIds, [])
  }
  const ownOnly = explore(matches, { modes: { unmapped: 'own' } })
  assert.ok(!ownOnly.showableIds.includes('unmapped'))
  assert.equal(ownOnly.roots.length, languages.length)
})

test('empty world search groups classification roots and preserves expanded branches', () => {
  // Put the unavailable isolate before the family in catalog order to exercise grouping.
  const reversed = buildLanguageHierarchy([...languages].reverse())
  const result = explore([], { hierarchy: reversed, browseRoots: true })
  assert.deepEqual(
    result.roots.map(({ id }) => id),
    ['family', 'isolate'],
  )
  assert.deepEqual(result.showableIds, ['family'])
  const rows = flattenLanguageHierarchy(reversed, result.roots, new Set(['family']))
  assert.deepEqual(
    rows.map(({ language }) => language.id),
    ['family', 'gap', 'unmapped', 'language', 'isolate'],
  )
})

test('viewport scope follows chosen own or descendant geometry, including empty viewports', () => {
  const matches = searchCatalog(data.languageSearchIndex, '')
  const visible = new Set(['other-dialect'])
  assert.deepEqual(
    explore(matches, { viewportLanguageIds: visible }).roots.map(({ id }) => id),
    ['unmapped', 'other-dialect'],
  )
  assert.deepEqual(
    explore(matches, {
      viewportLanguageIds: visible,
      modes: { family: 'descendants', unmapped: 'own' },
    }).roots.map(({ id }) => id),
    ['family', 'other-dialect'],
  )
  assert.deepEqual(explore(matches, { viewportLanguageIds: new Set() }).roots, [])
  assert.deepEqual(
    explore(searchCatalog(data.languageSearchIndex, 'nested'), { viewportLanguageIds: visible })
      .roots,
    [],
    'Geographic scope intersects text matches rather than introducing nonmatching entries',
  )
})

test('mapped branches preserve mapped ancestors and visit every descendant', () => {
  const branch = mappedBranchForLanguage('family', hierarchy, availability())
  assert.deepEqual(branch.languageIds, ['nested', 'dialect', 'language', 'other-dialect', 'family'])
  assert.deepEqual(
    [...branch.subtreeIds].sort(),
    languages
      .filter(({ id }) => id !== 'isolate')
      .map(({ id }) => id)
      .sort(),
    'All subtree entries are visited, including unmapped and collapsed branches',
  )
  const modes = Object.fromEntries(branch.languageIds.map((id) => [id, 'own' as const]))
  const areas = resolveMapAreas(branch.languageIds, availability(), modes)
  assert.deepEqual(
    areas.map(({ id }) => id),
    [
      'modern:nested',
      'modern:dialect',
      'historic:language',
      'modern:other-dialect',
      'historic:family',
    ],
  )
  assert.ok(areas.every(({ mode, variants }) => mode === 'own' && variants.length === 1))
})

test('mapped branches apply source and period filters before selection', () => {
  assert.deepEqual(
    mappedBranchForLanguage('family', hierarchy, availability('all', ['historic'])).languageIds,
    ['language', 'family'],
    'A mapped ancestor is retained when all its finer geography is filtered out',
  )
  assert.deepEqual(
    mappedBranchForLanguage('family', hierarchy, availability('time-of-contact')).languageIds,
    ['language', 'family'],
  )
  assert.deepEqual(
    mappedBranchForLanguage('family', hierarchy, availability('contemporary')).languageIds,
    ['nested', 'dialect', 'language', 'other-dialect'],
  )
  assert.deepEqual(
    mappedBranchForLanguage('family', hierarchy, availability('all', [])).languageIds,
    [],
  )
})

test('bulk mapped branches deduplicate overlapping matches in any order', () => {
  for (const roots of [
    ['family', 'language', 'nested', 'family'],
    ['nested', 'language', 'family'],
  ]) {
    const branch = mappedBranchForLanguages(roots, hierarchy, availability())
    assert.deepEqual(branch.languageIds, [
      'nested',
      'dialect',
      'language',
      'other-dialect',
      'family',
    ])
    assert.deepEqual(
      branch.subtreeIds,
      mappedBranchForLanguage('family', hierarchy, availability()).subtreeIds,
    )
  }
})

test('bulk mapped branches include only matched branches and respect geography filters', () => {
  assert.deepEqual(
    mappedBranchForLanguages(['language', 'gap', 'unknown'], hierarchy, availability()).languageIds,
    ['nested', 'dialect', 'language'],
  )
  assert.deepEqual(
    mappedBranchForLanguages(['language', 'unmapped'], hierarchy, availability()).languageIds,
    ['nested', 'dialect', 'language', 'other-dialect'],
  )
  assert.deepEqual(
    mappedBranchForLanguages(['nested', 'family'], hierarchy, availability('time-of-contact'))
      .languageIds,
    ['language', 'family'],
  )
  assert.deepEqual(
    mappedBranchForLanguages(['family', 'language'], hierarchy, availability('all', []))
      .languageIds,
    [],
  )
  assert.deepEqual(mappedBranchForLanguages([], hierarchy, availability()).languageIds, [])
})

test('mapped branches handle subgroups, mapped roots with unmapped children, and missing geography', () => {
  assert.deepEqual(mappedBranchForLanguage('unmapped', hierarchy, availability()).languageIds, [
    'other-dialect',
  ])
  assert.deepEqual(mappedBranchForLanguage('nested', hierarchy, availability()).languageIds, [
    'nested',
  ])
  assert.deepEqual(
    mappedBranchForLanguage('language', hierarchy, availability('time-of-contact')).languageIds,
    ['language'],
  )
  for (const id of ['gap', 'isolate', 'unknown']) {
    assert.deepEqual(mappedBranchForLanguage(id, hierarchy, availability()).languageIds, [])
  }
})

test('mapped branches preserve contributor source overrides', () => {
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
  const branch = mappedBranchForLanguage('family', hierarchy, available)
  assert.deepEqual(branch.languageIds, ['nested', 'dialect', 'language', 'other-dialect', 'family'])
  assert.equal(
    resolveMapAreas(branch.languageIds, available, { nested: 'own' }, withAlternate)[0]?.id,
    alternate.id,
  )
})

test('mapped branch traversal terminates on malformed cyclic classifications', () => {
  const cyclic = buildLanguageHierarchy([entry('a', 'b'), entry('b', 'a')])
  const branch = mappedBranchForLanguage('a', cyclic, new Map())
  assert.deepEqual([...branch.subtreeIds], ['a', 'b'])
  assert.deepEqual(branch.languageIds, [])
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
  const familyId = required(areas[0]).id
  assert.match(familyId, /^descendants:family:/)
  assert.deepEqual(mapAreaMemberships(areas), {
    'historic:language': [familyId, 'historic:language'],
    'modern:other-dialect': [familyId],
  })
  assert.deepEqual(inspectedMapAreaIds(['historic:language', familyId], areas), [
    familyId,
    'historic:language',
  ])
  assert.deepEqual(inspectedSourceVariantIds([familyId], areas), [
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

test('one languoid has independently pinned sources and periods; identical additions deduplicate', () => {
  const historic = required(
    pinMapEntry('language', availability('time-of-contact').get('language'), 'own', {
      sources: ['historic'],
      period: 'time-of-contact',
    }),
  )
  const modern = required(
    pinMapEntry('language', availability('contemporary').get('language'), 'own', {
      sources: ['modern'],
      period: 'contemporary',
    }),
  )
  const selected = addMapEntries([], [historic, modern, historic])
  assert.equal(selected.length, 2)
  assert.notEqual(historic.id, modern.id)
  assert.equal(
    draftRepresentationKey('language', availability('contemporary').get('language'), 'own'),
    mapEntryKey(modern),
  )
  assert.deepEqual(
    resolveMapEntries(selected, data, colors).map(({ variants }) => variants[0]?.id),
    ['historic:language', 'modern:language'],
  )
  const styled = { ...modern, colorOverride: '#ff0000' }
  assert.deepEqual(
    addMapEntries([styled], [{ ...modern, context: { sources: 'all', period: 'all' } }]),
    [styled],
  )
  assert.equal(
    pinMapEntry('isolate', availability().get('isolate'), 'own', { sources: 'all', period: 'all' }),
    null,
  )
  assert.equal(
    pinMapEntry('language', availability('all', []).get('language'), 'own', {
      sources: [],
      period: 'all',
    }),
    null,
  )
})

test('different sources for the same period remain distinct representations', () => {
  const base = required(availability('contemporary').get('language'))
  const variant = required(base.own)
  const alternate = { ...variant, id: 'alternate:language', datasetId: 'alternate' }
  const own = required(
    pinMapEntry('language', base, 'own', { sources: ['modern'], period: 'contemporary' }),
  )
  const other = required(
    pinMapEntry('language', { ...base, own: alternate, ownVariants: [alternate] }, 'own', {
      sources: ['alternate'],
      period: 'contemporary',
    }),
  )
  const selected = addMapEntries([], [own, other])
  assert.equal(selected.length, 2)
  assert.notEqual(mapEntryKey(own), mapEntryKey(other))
})

test('aggregate comparisons pin contributor variants and gaps and carry independent overlap memberships', () => {
  const all = required(
    pinMapEntry('family', availability().get('family'), 'descendants', {
      sources: 'all',
      period: 'all',
    }),
  )
  const modern = required(
    pinMapEntry('family', availability('contemporary').get('family'), 'descendants', {
      sources: ['modern'],
      period: 'contemporary',
    }),
  )
  assert.notEqual(all.id, modern.id)
  assert.deepEqual(all.variantIds, ['historic:language', 'modern:other-dialect'])
  assert.deepEqual(modern.variantIds, ['modern:language', 'modern:other-dialect'])
  assert.deepEqual(all.uncoveredBranchIds, ['gap'])
  const areas = resolveMapEntries([all, modern], data, colors)
  assert.deepEqual(mapAreaMemberships(areas)['modern:other-dialect'], [all.id, modern.id])
  assert.deepEqual(inspectedMapAreaIds(['modern:other-dialect'], areas), [all.id, modern.id].sort())
  assert.notEqual(mapAreaSelectionKey(areas), mapAreaSelectionKey([required(areas[0])]))
  const reordered = { ...all, id: 'another-id', variantIds: [...all.variantIds].reverse() }
  assert.deepEqual(
    addMapEntries([all], [reordered]),
    [all],
    'Contributor ordering does not make a new representation',
  )
  availability('all', [], { language: 'modern:language' })
  assert.deepEqual(
    resolveMapEntries([all], data, colors)[0]?.variants.map(({ id }) => id),
    all.variantIds,
    'Later filter/override changes cannot alter pinned contributors',
  )
})

test('branch replacement preserves other comparison contexts and individual color overrides', () => {
  const historicContext = { sources: ['historic'], period: 'time-of-contact' } as const
  const modernContext = { sources: ['modern'], period: 'contemporary' } as const
  const historic = required(
    pinMapEntry(
      'family',
      availability('time-of-contact').get('family'),
      'descendants',
      historicContext,
    ),
  )
  const modern = required(
    pinMapEntry('family', availability('contemporary').get('family'), 'descendants', modernContext),
  )
  const unrelated = required(
    pinMapEntry('language', availability().get('language'), 'own', {
      sources: 'all',
      period: 'all',
    }),
  )
  const branch = mappedBranchForLanguage('family', hierarchy, availability('contemporary'))
  const candidates = branch.languageIds.map((id) =>
    required(pinMapEntry(id, availability('contemporary').get(id), 'own', modernContext, 'family')),
  )
  const manual = { ...required(candidates[0]), colorRootId: null, colorOverride: '#ff0000' }
  const replaced = replaceSubtreeMapEntries(
    [historic, modern, unrelated, manual],
    candidates,
    branch.subtreeIds,
    modernContext,
  )
  assert.ok(replaced.includes(historic) && replaced.includes(unrelated))
  assert.ok(!replaced.some(({ id }) => id === modern.id))
  assert.equal(replaced.find(({ id }) => id === manual.id)?.colorOverride, '#ff0000')
  assert.equal(replaced.find(({ id }) => id === manual.id)?.colorRootId, 'family')
  assert.deepEqual(
    replaceSubtreeMapEntries(replaced, candidates, branch.subtreeIds, modernContext),
    replaced,
  )
  assert.equal(
    geographyContextKey({ sources: ['a', 'b', 'a'], period: 'all' }),
    geographyContextKey({ sources: ['b', 'a'], period: 'all' }),
  )
})

test('per-entry colors override genealogy independently and never enter geometry cache identity', () => {
  const historic = required(
    pinMapEntry('language', availability('time-of-contact').get('language'), 'own', {
      sources: 'all',
      period: 'all',
    }),
  )
  const modern = required(
    pinMapEntry('language', availability('contemporary').get('language'), 'own', {
      sources: 'all',
      period: 'all',
    }),
  )
  const initial = resolveMapEntries([historic, modern], data, colors)
  const styled = resolveMapEntries(
    [{ ...historic, colorOverride: '#ff0000' }, modern],
    data,
    new Map([['language', '#0000ff']]),
  )
  assert.deepEqual(
    styled.map(({ color }) => color),
    ['#ff0000', '#0000ff'],
  )
  assert.equal(mapAreaSelectionKey(initial), mapAreaSelectionKey(styled))
})

test('missing pinned geometry hides a complete entry rather than displaying a partial aggregate', () => {
  const entry = required(
    pinMapEntry('family', availability().get('family'), 'descendants', {
      sources: 'all',
      period: 'all',
    }),
  )
  const missing = { ...data, variantById: new Map(data.variantById) }
  missing.variantById.delete(required(entry.variantIds[0]))
  assert.deepEqual(resolveMapEntries([entry], missing, colors), [])
})
