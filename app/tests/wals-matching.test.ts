import assert from 'node:assert/strict'
import { test } from 'node:test'
import { indexWals } from '../src/domain/wals.ts'
import { associateWals } from '../src/integrations/wals/languageMatching.ts'
import { catalogLanguage, walsCatalog, walsData, walsRepository } from './fixtures/wals.ts'

test('classification Glottocodes associate distinct varieties; opaque IDs are never identifiers', () => {
  const result = associateWals(walsRepository(), walsCatalog())
  assert.deepEqual(result.byAtlas.get('atlas:irish'), ['ird', 'iri'])
  assert.equal(result.bySource.get('ird')?.status, 'associated')
  assert.equal(result.bySource.get('orphan')?.status, 'unmatched')
  assert.equal(result.bySource.get('empty')?.status, 'unmatched')
  assert.equal(result.diagnostics.method.glottocode, 7)
  assert.equal(result.diagnostics.status.unmatched, 2)
  assert.equal(result.diagnostics.level.family, 1)
  assert.equal(result.diagnostics.scope.broader, 1)
})

test('an explicit unresolved or ambiguous Glottocode never falls back to a unique ISO', () => {
  const data = walsData()
  assert.ok(data.records.orphan)
  const repository = indexWals({
    ...data,
    records: { ...data.records, orphan: { ...data.records.orphan, glottocode: 'missing' } },
  })
  const iso = catalogLanguage('iso-only', { iso6393: 'xxx' })
  let match = associateWals(repository, [iso]).bySource.get('orphan')
  assert.equal(match?.status, 'unmatched')
  if (match?.status !== 'associated') assert.equal(match?.reason, 'unresolved-glottocode')
  match = associateWals(walsRepository(), [
    iso,
    catalogLanguage('a', { classification: { kind: 'glottolog', glottocode: 'gone1234' } }),
    catalogLanguage('b', { classification: { kind: 'glottolog', glottocode: 'gone1234' } }),
  ]).bySource.get('orphan')
  assert.equal(match?.status, 'ambiguous')
  if (match?.status !== 'associated') assert.deepEqual(match?.candidateAtlasIds, ['a', 'b'])
})

test('ISO fallback requires absent Glottocode and uniqueness across both COMPLETE catalogs', () => {
  const original = walsData()
  const record = original.records.orphan
  assert.ok(record)
  const data = {
    ...original,
    records: { ...original.records, orphan: { ...record, glottocode: null } },
  }
  const target = catalogLanguage('target', { iso6393: 'xxx' })
  const match = associateWals(indexWals(data), [target]).bySource.get('orphan')
  assert.equal(match?.status, 'associated')
  if (match?.status === 'associated') assert.equal(match.method, 'unique-iso')
  // A second WALS record without shortlisted values still makes ISO ambiguous.
  const repository = indexWals({
    ...data,
    records: { ...data.records, extra: { ...record, glottocode: 'other' } },
  })
  const sourceConflict = associateWals(repository, [target]).bySource.get('orphan')
  if (sourceConflict?.status !== 'associated')
    assert.equal(sourceConflict?.reason, 'duplicate-source-iso')
  else assert.fail('Must not merge source varieties')
  // A family/source-defined entry without geometry also counts in target uniqueness.
  const targetConflict = associateWals(indexWals(data), [
    target,
    catalogLanguage('family', { level: 'family', iso6393: 'xxx' }),
  ]).bySource.get('orphan')
  if (targetConflict?.status !== 'associated')
    assert.equal(targetConflict?.reason, 'duplicate-target-iso')
  else assert.fail('Must use the full target catalog')
  const absent = associateWals(indexWals(data), []).bySource.get('orphan')
  if (absent?.status !== 'associated') assert.equal(absent?.reason, 'unresolved-iso')
})

test('source-defined ISO associations disclose scope; auxiliary ISO lists do not drive matches', () => {
  const data = walsData()
  const original = data.records.orphan
  assert.ok(original)
  const repository = indexWals({
    ...data,
    records: { ...data.records, orphan: { ...original, glottocode: null } },
  })
  const source = catalogLanguage('custom:id', {
    iso6393: 'xxx',
    classification: { kind: 'source', datasetId: 'test', label: 'Test', note: '' },
  })
  const match = associateWals(repository, [source]).bySource.get('orphan')
  assert.equal(match?.status, 'associated')
  if (match?.status === 'associated') assert.equal(match.scope, 'source-defined')
  const auxiliary = indexWals({
    ...data,
    records: {
      ...data.records,
      orphan: { ...original, glottocode: null, iso6393: null, isoCodes: ['xxx'] },
    },
  })
  assert.equal(associateWals(auxiliary, [source]).bySource.get('orphan')?.status, 'unmatched')
})

test('broader family/group links remain on the recorded source and never substitute descendants', () => {
  for (const level of ['family', 'group'] as const) {
    const result = associateWals(walsRepository(), [
      catalogLanguage('broa1234', { level }),
      catalogLanguage('child', { parentId: 'broa1234', parentLanguageId: 'broa1234' }),
    ])
    const association = result.bySource.get('broad')
    assert.equal(association?.status, 'associated')
    if (association?.status === 'associated') {
      assert.equal(association.atlasId, 'broa1234')
      assert.equal(association.scope, 'broader')
      assert.match(association.explanation, /only WALS Recorded variety/)
    }
    assert.equal(result.byAtlas.has('child'), false)
  }
})

test('reviewed overrides require reasons, expected source identifiers, and a real unique target ID', () => {
  const repository = walsRepository()
  const catalog = walsCatalog()
  const override = {
    sourceId: 'orphan',
    expectedGlottocode: 'gone1234',
    expectedIso: 'xxx',
    atlasId: 'nuuc1236',
    reason: 'Synthetic reviewed exception',
  }
  const match = associateWals(repository, catalog, [override]).bySource.get('orphan')
  assert.equal(match?.status, 'associated')
  if (match?.status === 'associated') assert.equal(match.method, 'reviewed-override')
  for (const patch of [
    { reason: '' },
    { expectedGlottocode: null },
    { expectedIso: null },
    { atlasId: 'missing' },
    { sourceId: 'missing' },
  ])
    assert.throws(
      () => associateWals(repository, catalog, [{ ...override, ...patch }]),
      /Invalid or stale/,
    )
  assert.throws(() => associateWals(repository, catalog, [override, override]), /Invalid or stale/)
  assert.ok(catalog[0])
  assert.throws(() => associateWals(repository, [...catalog, catalog[0]]), /Duplicate atlas ID/)
})
