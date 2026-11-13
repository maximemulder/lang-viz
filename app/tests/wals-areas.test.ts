import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { GeometryVariant } from '../src/domain/atlas.ts'
import { indexWals } from '../src/domain/wals.ts'
import { matchWalsAreas } from '../src/integrations/wals/areaMatching.ts'
import { associateWals } from '../src/integrations/wals/languageMatching.ts'
import { walsCatalog, walsData } from './fixtures/wals.ts'

const variant = (languageId: string): GeometryVariant => ({
  id: `source:${languageId}`,
  languageId,
  datasetId: 'test',
  layer: 'contemporary',
  label: 'Original source',
  featureId: 1,
  featureCount: 1,
  geometryKind: 'source',
  color: '#667755',
  sourceYear: 2020,
  temporalCoverage: {
    kind: 'named-period',
    viewId: 'contemporary',
    label: 'Contemporary',
    quality: 'direct',
  },
})
test('matching uses the exact category and the original language polygons without family expansion', () => {
  const repository = indexWals(walsData()),
    associations = associateWals(repository, walsCatalog())
  const polygons = [
    variant('atlas:irish'),
    variant('nuuc1236'),
    variant('unrelated'),
    variant('broa1234'),
  ]
  const result = matchWalsAreas(repository, associations, 'iri', '81A', polygons)
  assert.deepEqual(
    result.variants.map((v) => v.languageId),
    ['atlas:irish', 'nuuc1236'],
  )
  assert.ok(result.withoutAreas.includes('aleu1260'))
  assert.strictEqual(result.variants[0], polygons[0])
  const broad = matchWalsAreas(repository, associations, 'broad', '12A', polygons)
  assert.ok(!broad.mappedIds.has('broa1234'))
  assert.ok(broad.unresolved > 0)
})
test('conflicting varieties are not generalized across a whole language area', () => {
  const data = walsData(),
    original = data.observations['81A-iri']!
  const repository = indexWals({
    ...data,
    categories: {
      ...data.categories,
      '81A-2': { ...data.categories['81A-1']!, number: 2, name: 'Other' },
    },
    observations: {
      ...data.observations,
      '81A-ird': { ...original, sourceId: 'ird', categoryId: '81A-2' },
    },
  })
  const result = matchWalsAreas(
    repository,
    associateWals(repository, walsCatalog()),
    'iri',
    '81A',
    [variant('atlas:irish')],
  )
  assert.ok(result.conflicts.has('atlas:irish'))
  assert.equal(result.variants.length, 0)
})
test('missing observations or absent geometry never create polygons', () => {
  const repository = indexWals(walsData()),
    associations = associateWals(repository, walsCatalog())
  assert.equal(
    matchWalsAreas(repository, associations, 'empty', '81A', [variant('atlas:irish')]).variants
      .length,
    0,
  )
  const noShapes = matchWalsAreas(repository, associations, 'iri', '81A', [])
  assert.equal(noShapes.variants.length, 0)
  assert.equal(noShapes.withoutAreas.length, 3)
})
