import assert from 'node:assert/strict'
import { test } from 'node:test'
import { lazyResource } from '../src/features/map/overlap/lazyResource.ts'

test('failed initialization is shared, then retried; successful resources remain shared', async () => {
  let attempts = 0
  const resource = {}
  const load = lazyResource(async () => {
    if (++attempts === 1) throw new Error('Initialization unavailable')
    return resource
  })
  const first = load()
  assert.equal(load(), first)
  await assert.rejects(first, /Initialization unavailable/)
  const retry = load()
  assert.equal(load(), retry)
  assert.equal(await retry, resource)
  assert.equal(await load(), resource)
  assert.equal(attempts, 2)
})
