import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildGeographyAvailability, mapAreaSelectionKey } from '../src/domain/aggregation.ts'
import type { AtlasData, GeometryVariant, Language } from '../src/domain/atlas.ts'
import { buildColorTopology, buildSemanticPalette } from '../src/domain/colors.ts'
import { prepareExploreResults } from '../src/domain/exploration.ts'
import { buildLanguageHierarchy } from '../src/domain/hierarchy.ts'
import { resolveMapEntries } from '../src/domain/mapEntries.ts'
import {
  addMapGroupEntries,
  buildMapGroupEntries,
  groupMapEntries,
} from '../src/domain/mapGroups.ts'

const languages = [
  { id: 'family', parentId: null },
  { id: 'child', parentId: 'family' },
  { id: 'dialect', parentId: 'child' },
  { id: 'other', parentId: null },
  { id: 'empty', parentId: null },
].map((language) => ({
  ...language,
  name: language.id,
  level: 'family',
  latitude: null,
  longitude: null,
  geometryVariantIds: language.id === 'empty' ? [] : [`a:${language.id}`, `b:${language.id}`],
})) as Language[]
const variants = languages.flatMap((language) =>
  language.geometryVariantIds.map((id) => ({
    id,
    languageId: language.id,
    datasetId: id.split(':')[0],
    temporalCoverage: { viewId: 'contemporary', label: 'Contemporary', quality: 'direct' },
  })),
) as GeometryVariant[]
const data = {
  languages,
  variants,
  languageById: new Map(languages.map((language) => [language.id, language])),
  variantById: new Map(variants.map((variant) => [variant.id, variant])),
} as AtlasData
const hierarchy = buildLanguageHierarchy(languages)
const topology = buildColorTopology(hierarchy)
const availability = buildGeographyAvailability(data, hierarchy, 'contemporary', ['a'], {})
const colors = buildSemanticPalette(hierarchy, topology, ['family', 'other']).colors
const required = <T>(value: T | undefined): T => {
  assert.ok(value)
  return value
}
const plan = (ids: string[], coverage: 'branch' | 'own' = 'branch', source = 'a') =>
  buildMapGroupEntries(
    ids,
    hierarchy,
    buildGeographyAvailability(data, hierarchy, 'contemporary', [source], {}),
    { sources: [source], period: 'contemporary' },
    coverage,
    'hierarchy',
    topology,
  )

test('branch groups include mapped parents and every descendant; overlapping roots deduplicate', () => {
  const entries = plan(['child', 'family', 'family', 'other', 'empty'])
  const groups = groupMapEntries(entries)
  assert.deepEqual(groups.map(({ group }) => group.rootId).sort(), ['family', 'other'])
  const family = groups.find(({ group }) => group.rootId === 'family')
  assert.deepEqual(family?.entries.map(({ languageId }) => languageId).sort(), [
    'child',
    'dialect',
    'family',
  ])
  assert.deepEqual(
    resolveMapEntries(entries, data, colors)
      .find(({ languageId }) => languageId === 'dialect')
      ?.refines?.sort(),
    ['a:child', 'a:family'],
  )
  assert.equal(plan(['empty']).length, 0)
  const own = plan(['family', 'child'], 'own')
  assert.equal(groupMapEntries(own).length, 2)
  assert.deepEqual(own.map(({ languageId }) => languageId).sort(), ['child', 'family'])
  assert.ok(resolveMapEntries(own, data, colors).every((area) => !area.refines))
})

test('repeated Add to map preserves IDs and styles, and restores removed group members', () => {
  const initial = addMapGroupEntries([], plan(['family']))
  const styled = initial.map((entry) => ({
    ...entry,
    colorOverride: '#ff0000',
    group: { ...required(entry.group), coloring: 'uniform' as const, color: '#123456' },
  }))
  assert.deepEqual(addMapGroupEntries(styled, plan(['family'])), styled)
  const partial = styled.filter(({ languageId }) => languageId !== 'child')
  const restored = addMapGroupEntries(partial, plan(['family']))
  assert.equal(restored.length, styled.length)
  assert.equal(groupMapEntries(restored).length, 1)
  assert.equal(restored.find(({ languageId }) => languageId === 'child')?.group?.color, '#123456')
  const broadenedContext = plan(['family']).map((entry) => ({
    ...entry,
    context: { ...entry.context, sources: ['a', 'b'] },
  }))
  const comparison = addMapGroupEntries(partial, broadenedContext)
  assert.equal(
    groupMapEntries(comparison).length,
    2,
    'A different context does not absorb an existing partial group',
  )
  assert.deepEqual(comparison.slice(0, partial.length), partial)
})

test('overlapping groups and sources remain independent comparisons with unique entry identities', () => {
  const initial = addMapGroupEntries([], plan(['child']))
  const combined = addMapGroupEntries(initial, plan(['family']))
  assert.equal(groupMapEntries(combined).length, 2)
  assert.equal(new Set(combined.map(({ id }) => id)).size, combined.length)
  const areas = resolveMapEntries(combined, data, colors)
  const familyChild = required(
    combined.find((entry) => entry.languageId === 'child' && entry.group?.rootId === 'family'),
  )
  const familyParent = required(combined.find((entry) => entry.languageId === 'family'))
  const familyDialect = required(
    combined.find((entry) => entry.languageId === 'dialect' && entry.group?.rootId === 'family'),
  )
  const childDialect = required(
    combined.find((entry) => entry.languageId === 'dialect' && entry.group?.rootId === 'child'),
  )
  assert.deepEqual(
    areas.find(({ id }) => id === familyDialect.id)?.refines?.sort(),
    [familyChild.id, familyParent.id].sort(),
  )
  assert.deepEqual(areas.find(({ id }) => id === childDialect.id)?.refines, [
    required(initial.find(({ languageId }) => languageId === 'child')).id,
  ])
  const own = addMapGroupEntries(combined, plan(['child'], 'own'))
  const key = JSON.parse(mapAreaSelectionKey(resolveMapEntries(own, data, colors)))
  assert.equal(key.variantGroups['a:child'].length, 3)
  const otherSource = addMapGroupEntries(own, plan(['family'], 'branch', 'b'))
  assert.equal(groupMapEntries(otherSource).length, 4)
  assert.deepEqual(otherSource.slice(0, own.length), own)
})

test('uniform and hierarchy colors use identical coverage; entry overrides win', () => {
  const entries = plan(['family'])
  const uniform = entries.map((entry) => ({
    ...entry,
    group: { ...required(entry.group), coloring: 'uniform' as const, color: '#123456' },
  }))
  const detailed = resolveMapEntries(entries, data, colors)
  const flat = resolveMapEntries(uniform, data, colors)
  assert.equal(mapAreaSelectionKey(flat), mapAreaSelectionKey(detailed))
  assert.deepEqual(
    detailed.map(({ color }) => color),
    entries.map(({ languageId }) => colors.get(languageId)),
  )
  assert.deepEqual([...new Set(flat.map(({ color }) => color))], ['#123456'])
  const overridden = resolveMapEntries(
    uniform.map((entry, i) => (i ? entry : { ...entry, colorOverride: '#abcdef' })),
    data,
    colors,
  )
  assert.equal(overridden[0]?.color, '#abcdef')
  const groupId = required(required(entries[0]).group).id
  const customPalette = buildSemanticPalette(hierarchy, topology, ['family'], {
    family: '#cc5500',
  }).colors
  const recolored = resolveMapEntries(entries, data, colors, new Map([[groupId, customPalette]]))
  assert.equal(recolored.find(({ languageId }) => languageId === 'family')?.color, '#cc5500')
  assert.equal(mapAreaSelectionKey(recolored), mapAreaSelectionKey(detailed))
})

test('viewport search finds deeply mapped descendants even when their mapped parent is outside', () => {
  const result = prepareExploreResults({
    matches: languages,
    hierarchy,
    browseRoots: false,
    viewportLanguageIds: new Set(['dialect']),
    availability,
    modes: {},
    coverage: 'branch',
  })
  assert.deepEqual(result.showableIds.sort(), ['child', 'dialect', 'family'])
  const own = prepareExploreResults({
    matches: languages,
    hierarchy,
    browseRoots: false,
    viewportLanguageIds: new Set(['dialect']),
    availability,
    modes: {},
    coverage: 'own',
  })
  assert.deepEqual(own.showableIds, ['dialect'])
})
