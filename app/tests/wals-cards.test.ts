import assert from 'node:assert/strict'
import { test } from 'node:test'
import { indexWals } from '../src/domain/wals.ts'
import {
  regionalWalsFeatures,
  walsCardFeatures,
  walsWordOrderIllustration,
} from '../src/features/wals/cards.ts'
import { profileWalsData } from './fixtures/wals-profile.ts'

test('required summary slots retain unknown values and do not inherit another variety’s data', () => {
  const repository = indexWals(profileWalsData())
  assert.equal(regionalWalsFeatures(repository).get('Test'), '12A')
  assert.deepEqual(walsCardFeatures(repository, 'iri'), ['81A', '12A', '13A'])
  assert.equal(repository.index.bySource.get('iri')?.has('12A'), false)
  assert.deepEqual(walsCardFeatures(repository, 'empty'), ['81A', '12A'])
  assert.deepEqual(walsCardFeatures(repository, 'unknown'), [])
})

test('regional coverage includes unmatched source varieties and ties follow editorial order', () => {
  const original = profileWalsData()
  const data = { ...original, observations: { ...original.observations } }
  for (const id of Object.keys(data.observations)) {
    const observation = data.observations[id]
    if (observation && !['81A', '12A', '13A'].includes(observation.featureId))
      delete data.observations[id]
  }
  // Four 12A observations versus one 13A. Fill three more varieties to tie.
  const observation = original.observations['13A-iri']
  assert.ok(observation)
  for (const sourceId of ['ird', 'aea', 'orphan']) {
    data.observations[`13A-${sourceId}`] = {
      ...observation,
      sourceId,
    }
  }
  const repository = indexWals(data)
  assert.equal(regionalWalsFeatures(repository).get('Test'), '13A')
  assert.strictEqual(regionalWalsFeatures(repository), regionalWalsFeatures(repository))
  // Removing an unmatched source observation breaks the tie; the source was counted.
  delete data.observations['13A-orphan']
  assert.equal(regionalWalsFeatures(indexWals(data)).get('Test'), '12A')
})

test('zero-coverage regions keep a comparison slot and never manufacture an optional card', () => {
  const data = profileWalsData()
  const repository = indexWals({ ...data, observations: {} })
  assert.deepEqual(walsCardFeatures(repository, 'iri'), ['81A', '13A'])
})

test('inspection reveals an exact observation outside all three summary slots without duplication', () => {
  const repository = indexWals(profileWalsData())
  assert.deepEqual(walsCardFeatures(repository, 'iri', '87A'), ['81A', '12A', '13A', '87A'])
  assert.deepEqual(walsCardFeatures(repository, 'iri', '13A'), ['81A', '12A', '13A'])
  assert.deepEqual(walsCardFeatures(repository, 'ird', '87A'), ['81A', '12A'])
})

test('all six word-order illustrations label subject, object and verb consistently', () => {
  const tokens: Record<string, string> = { S: 'Sam', V: 'eats', O: 'rice' }
  for (const order of ['SVO', 'SOV', 'VSO', 'VOS', 'OVS', 'OSV'])
    assert.equal(
      walsWordOrderIllustration(order)?.toLowerCase(),
      [...order]
        .map((role) => tokens[role])
        .join(' ')
        .toLowerCase(),
    )
  for (const category of ['No dominant order', 'Unknown', '', 'Not applicable'])
    assert.equal(walsWordOrderIllustration(category), null)
})
