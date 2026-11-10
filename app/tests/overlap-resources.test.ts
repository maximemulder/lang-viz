import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ByteCache } from '../src/features/map/overlap/byteCache.ts'
import { type DeliveryTile, encodeCoverageTile } from '../src/features/map/overlap/delivery.ts'
import { DeliveryStore } from '../src/features/map/overlap/deliveryStore.ts'
import { FallbackCache, fallbackMaskKey } from '../src/features/map/overlap/fallbackCache.ts'

test('byte cache evicts least recently used entries and bounds empty and oversized payloads', () => {
  const cache = new ByteCache(2, 5)
  cache.set('a', new Uint8Array(2))
  cache.set('b', new Uint8Array(2))
  assert.ok(cache.get('a'))
  cache.set('c', new Uint8Array(2))
  assert.equal(cache.get('b'), undefined)
  assert.ok(cache.get('a'))
  cache.set('c', new Uint8Array(9))
  assert.equal(cache.get('c'), undefined)
  assert.equal(cache.bytes, 2)
  for (let i = 0; i < 100; i++) cache.set(String(i), new Uint8Array())
  assert.equal(cache.size, 2)
  assert.equal(cache.bytes, 0)
})

const nativeTile = (x: number, color: string): DeliveryTile =>
  encodeCoverageTile({
    tile: { z: 2, x, y: 0 },
    extent: 16,
    features: [
      {
        type: 'Feature',
        properties: { pattern: color, variantIds: [color] },
        geometry: {
          type: 'MultiPolygon',
          coordinates: [
            [
              [
                [0, 0],
                [16, 0],
                [16, 16],
                [0, 16],
                [0, 0],
              ],
            ],
          ],
        },
      },
    ],
    vertices: 5,
  })

test('parent delivery caches local descendants, invalidates changed geometry, and releases snapshot references', () => {
  const store = new DeliveryStore()
  const a = nativeTile(0, 'a')
  const b = nativeTile(3, 'b')
  const replacement = nativeTile(0, 'new-selection')
  const target = { z: 1, x: 0, y: 0 }
  store.register(1, [1], [[1, a]])
  const first = store.get(1, target)
  assert.ok(first.byteLength)
  store.register(2, [2, 1], [[2, b]])
  assert.equal(store.get(2, target), first, 'unrelated additions should reuse parent bytes')
  assert.equal(store.stats().parentCacheHits, 1)
  store.register(3, [3], [[3, replacement]])
  assert.notDeepEqual(store.get(3, target), first)
  store.release(1)
  store.release(2)
  assert.equal(store.stats().tiles, 1)
  store.release(3)
  assert.equal(store.stats().tiles, 0)
  assert.equal(store.stats().nativeBytes, 0)
  assert.equal(store.stats().snapshots, 0)
  assert.ok(store.stats().parentBytes <= 8 * 1024 * 1024)
})

test('fallback cache keys ignore unrelated coverage, reuse raw data for changed local masks, and isolate archives', async () => {
  const cache = new FallbackCache()
  let fetches = 0
  const archive = {
    getZxy: async () => {
      fetches++
      return undefined
    },
  }
  const tile = { z: 1, x: 0, y: 0 }
  const local = { z: 2, x: 0, y: 0 }
  const outside = { z: 2, x: 3, y: 3 }
  const signal = new AbortController().signal
  assert.equal(fallbackMaskKey(tile, [local, outside]), fallbackMaskKey(tile, [local]))
  const first = await cache.get(archive, 'a', tile, [local], signal)
  assert.equal(await cache.get(archive, 'a', tile, [outside, local], signal), first)
  assert.equal(fetches, 1)
  assert.equal(cache.stats().cacheHits, 1)
  await cache.get(archive, 'a', tile, [{ z: 2, x: 1, y: 1 }], signal)
  assert.equal(fetches, 1)
  assert.equal(cache.stats().rawCacheHits, 1)
  await cache.get(archive, 'b', tile, [local], signal)
  assert.equal(fetches, 2)
  await cache.get(archive, 'a', tile, [tile], signal)
  assert.equal(fetches, 2, 'wholly covered tiles need no archive read')
  await assert.rejects(cache.get(archive, 'a', tile, [], AbortSignal.abort()), {
    name: 'AbortError',
  })
})
