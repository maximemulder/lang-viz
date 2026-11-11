import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { Language } from '../../src/domain/atlas.ts'
import {
  buildWordTrail,
  type EtymologyData,
  indexEtymology,
  matchAtlasLanguage,
  searchLexemes,
} from '../../src/domain/etymology.ts'
import { validateEtymologyData } from '../../src/domain/etymologyValidation.ts'
import { trailLineFeatures, trailLocations } from '../../src/domain/wordTrailGeography.ts'

// Deliberately fail when data is absent: this command is an explicit snapshot gate.
const data = JSON.parse(
  readFileSync(new URL('../../public/etymology/word-trails.json', import.meta.url), 'utf8'),
) as EtymologyData
const repository = { data, index: indexEtymology(data) }
const options = { depth: 4, branches: false, placeholders: false, expanded: new Set<string>() }

test('reviewed snapshot retains its schema, source hashes, and recorded counts', () => {
  validateEtymologyData(data)
  assert.equal(data.schemaVersion, 1)
  assert.equal(data.provenance.adapterVersion, 1)
  assert.equal(data.provenance.snapshot, 'diacl-2026-10-24')
  assert.deepEqual(
    data.provenance.inputs.map(({ sha256 }) => sha256),
    [
      'afc87a38a473c191719266818dd823fcada2de9dda8190451f8ac2019e35062b',
      '73211efaf8a5eefd39a297d95f97e314d2a249c4164d7a55d0277f8bc2626255',
    ],
  )
  assert.equal(Object.keys(data.lexemes).length, 74635)
  assert.equal(data.edges.length, 46351)
  assert.equal(Object.keys(data.languages).length, 466)
  assert.equal(Object.keys(data.concepts).length, 1269)
  assert.deepEqual(data.diagnostics, [])
})

test('real wine ancestry retains borrowing evidence separately from the word citations', () => {
  const trail = buildWordTrail(repository, '69562', options)
  assert.deepEqual(
    trail.ids.map((id) => data.languages[data.lexemes[id]?.l ?? '']?.name),
    ['English', 'Middle English', 'Old English', 'Proto-Germanic', 'Latin'],
  )
  const borrowing = trail.edges.find(({ p, c }) => p === '69421' && c === '69470')
  assert.ok(borrowing)
  assert.equal(borrowing.t, 4)
  assert.equal(data.types[borrowing.t], 'Certainly borrowed')
  assert.ok(borrowing.refs.length > 0)
  assert.notDeepEqual(borrowing.refs, data.lexemes['69562']?.refs)
  assert.ok(trail.edges.every((edge) => edge.refs.every((ref) => data.sources[ref.FkSourceId])))
  assert.equal(trailLocations(data, trail).length, 5)
  assert.equal(trailLineFeatures(data, trail).features.length, 4)
  assert.ok(searchLexemes(repository, 'VĪNUM', false).some(({ id }) => id === '69421'))
})

test('all snapshot relationships and concepts resolve; catalog matching uses current atlas types', () => {
  for (const edge of data.edges) {
    assert.ok(data.lexemes[edge.p] && data.lexemes[edge.c])
    assert.ok(data.types[edge.t])
  }
  for (const concept of Object.values(data.concepts)) {
    assert.ok(concept.lexemes.every((id) => data.lexemes[id]))
  }
  const atlas = JSON.parse(
    readFileSync(new URL('../../public/data/languages.json', import.meta.url), 'utf8'),
  ) as Language[]
  const english = matchAtlasLanguage('41500', data.languages, atlas)
  assert.equal(english?.id, 'stan1293')
  assert.equal(english?.classification.kind, 'glottolog')
})
