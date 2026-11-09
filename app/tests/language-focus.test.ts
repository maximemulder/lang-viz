import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { GeographyAvailability } from '../src/domain/aggregation.ts'
import type { AtlasData, GeometryVariant, Language } from '../src/domain/atlas.ts'
import { buildLanguageHierarchy } from '../src/domain/hierarchy.ts'
import { combinedBounds, targetGeometry } from '../src/domain/languageFocus.ts'
import type { MapEntry } from '../src/domain/mapEntries.ts'

const own = { id: 'modern:parent', languageId: 'parent' } as GeometryVariant
const child = { id: 'modern:child', languageId: 'child' } as GeometryVariant
const historic = { id: 'historic:parent', languageId: 'parent' } as GeometryVariant
const hierarchy = buildLanguageHierarchy([
  { id: 'parent', name: 'Parent', parentId: null },
  { id: 'child', name: 'Child', parentId: 'parent' },
] as Language[])
const data = { variantById: new Map([own, child, historic].map((v) => [v.id, v])) } as AtlasData
const available = new Map<string, GeographyAvailability>([
  [
    'parent',
    {
      own,
      ownVariants: [own],
      descendants: [child],
      uncoveredBranches: [],
      hasAnyAreas: true,
    },
  ],
  [
    'child',
    { own: child, ownVariants: [child], descendants: [], uncoveredBranches: [], hasAnyAreas: true },
  ],
])
const pinned = [{ id: 'comparison', languageId: 'parent', variantIds: [historic.id] }] as MapEntry[]

test('search/profile previews resolve current geography without changing selection', () => {
  const before = structuredClone(pinned)
  assert.deepEqual(
    targetGeometry({ languageId: 'parent' }, data, available, 'own', hierarchy, pinned),
    [own],
  )
  assert.deepEqual(
    targetGeometry({ languageId: 'parent' }, data, available, 'branch', hierarchy, pinned),
    [child, own],
  )
  assert.deepEqual(
    targetGeometry({ languageId: 'unknown' }, data, available, 'own', hierarchy, pinned),
    [],
  )
  assert.deepEqual(targetGeometry(null, data, available, 'own', hierarchy, pinned), [])
  assert.deepEqual(pinned, before)
})

test('pinned previews keep exact source/period independently of current geography filters', () => {
  const target = { languageId: 'parent', entryId: 'comparison' }
  assert.deepEqual(targetGeometry(target, data, new Map(), 'branch', hierarchy, pinned), [historic])
  assert.deepEqual(
    targetGeometry({ ...target, languageId: 'child' }, data, available, 'own', hierarchy, pinned),
    [],
  )
  assert.deepEqual(
    targetGeometry(target, data, available, 'branch', hierarchy, []),
    [],
    'Removed entries never fall back to a different area',
  )
  const incomplete = [{ ...pinned[0], variantIds: [historic.id, 'missing'] }] as MapEntry[]
  assert.deepEqual(targetGeometry(target, data, available, 'branch', hierarchy, incomplete), [])
})

test('pinned groups preview all original members despite filters, and never fall back after removal', () => {
  const group = {
    id: 'group',
    rootId: 'parent',
    coverage: 'branch' as const,
    coloring: 'hierarchy' as const,
    color: null,
  }
  const entries = [
    { ...pinned[0], languageId: 'parent', group },
    { id: 'child-entry', languageId: 'child', variantIds: [child.id], group },
  ] as MapEntry[]
  const target = { languageId: 'parent', groupId: group.id }
  assert.deepEqual(targetGeometry(target, data, new Map(), 'own', hierarchy, entries), [
    historic,
    child,
  ])
  assert.deepEqual(targetGeometry(target, data, available, 'branch', hierarchy, []), [])
  assert.deepEqual(
    targetGeometry(
      { ...target, languageId: 'other' },
      data,
      available,
      'branch',
      hierarchy,
      entries,
    ),
    [],
  )
  assert.deepEqual(
    targetGeometry(target, data, available, 'branch', hierarchy, [
      ...entries,
      { id: 'missing', languageId: 'child', variantIds: ['missing'], group } as MapEntry,
    ]),
    [],
  )
})

test('camera bounds cover entire footprints and preserve broad geometry', () => {
  assert.deepEqual(
    combinedBounds([
      [-5, 40, 10, 55],
      [4, 38, 15, 60],
    ]),
    [-5, 38, 15, 60],
  )
  assert.deepEqual(combinedBounds([[-140, -5, 120, 10]]), [-140, -5, 120, 10])
  assert.deepEqual(combinedBounds([[-180, -90, 180, 90]]), [-180, -85, 180, 85])
  assert.equal(combinedBounds([]), null)
  assert.equal(combinedBounds([[Number.NaN, 0, 1, 1]]), null)
  assert.equal(combinedBounds([[10, 0, 0, 1]]), null)
})

test('dateline-crossing islands frame locally rather than across the whole world', () => {
  assert.deepEqual(
    combinedBounds([
      [170, -20, 179, -10],
      [-179, -22, -170, -5],
    ]),
    [170, -22, 190, -5],
  )
  assert.deepEqual(combinedBounds([[178, 0, 183, 4]]), [178, 0, 183, 4])
})
