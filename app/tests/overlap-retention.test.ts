import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { maplibreTileRetention, patchTileRetention } from '../build/maplibreTileRetention.ts'
import { retainCoverageChildren } from '../src/features/map/overlap/tileRetention.ts'

const tileId = (z: number, x: number, y: number, overscaledZ = z) => ({
  key: `${overscaledZ}/${z}/${x}/${y}`,
  canonical: { z, x, y },
  isChildOf(parent: { key: string; canonical: { z: number } }) {
    const scale = 2 ** (z - parent.canonical.z)
    const coordinate = parent as ReturnType<typeof tileId>
    return (
      this.key !== parent.key &&
      scale >= 1 &&
      Math.floor(x / scale) === coordinate.canonical.x &&
      Math.floor(y / scale) === coordinate.canonical.y
    )
  },
})

test('mixed loaded generations retain every branch and stop seeking parents when complete', () => {
  const target = tileId(0, 0, 0)
  const coarse = [tileId(1, 0, 0), tileId(1, 1, 0), tileId(1, 0, 1)]
  const fine = [tileId(2, 2, 2), tileId(2, 3, 2), tileId(2, 2, 3), tileId(2, 3, 3)]
  const retained = {}
  const incomplete = retainCoverageChildren(retained, new Set([target]), {
    [target.key]: [...coarse, ...fine].map((tileID) => ({ tileID })),
  })
  assert.equal(Object.keys(retained).length, 7, 'a coarse sibling must not discard the fine branch')
  assert.equal(incomplete.size, 0, 'mixed generations can completely cover their parent')
})

test('a loaded covering ancestor replaces only its own descendants, avoiding duplicate opacity', () => {
  const target = tileId(0, 0, 0)
  const ancestor = tileId(1, 0, 0)
  const sibling = tileId(6, 63, 63)
  const descendants = [tileId(2, 0, 0), tileId(3, 1, 1), ancestor, sibling]
  const retained = {}
  const incomplete = retainCoverageChildren(retained, new Set([target]), {
    [target.key]: descendants.map((tileID) => ({ tileID })),
  })
  assert.deepEqual(Object.keys(retained).sort(), [ancestor.key, sibling.key].sort())
  assert.equal(incomplete.has(target), true, 'uncovered branches still seek a loaded parent')
})

test('large zoom-outs retain existing deep children; empty branches still request parents', () => {
  const target = tileId(0, 0, 0)
  const other = tileId(0, 1, 0)
  const child = tileId(8, 128, 127)
  const retained = {}
  const incomplete = retainCoverageChildren(retained, new Set([target, other]), {
    [target.key]: [{ tileID: child }],
  })
  assert.deepEqual(retained, { [child.key]: child })
  assert.equal(incomplete.has(target), true)
  assert.equal(incomplete.has(other), true)
})

test('overscaled children cover their canonical area rather than a smaller zoom fraction', () => {
  const target = tileId(2, 1, 1)
  const child = tileId(2, 1, 1, 5)
  const retained = {}
  assert.equal(
    retainCoverageChildren(retained, new Set([target]), {
      [target.key]: [{ tileID: child }],
    }).size,
    0,
  )
  assert.deepEqual(retained, { [child.key]: child })
})

test('the workaround matches both installed MapLibre builds and rejects changed integration points', () => {
  const transform = maplibreTileRetention().transform
  assert.equal(typeof transform, 'function')
  if (typeof transform !== 'function') return
  for (const name of ['maplibre-gl.mjs', 'maplibre-gl-dev.mjs']) {
    const original = readFileSync(
      new URL(`../node_modules/maplibre-gl/dist/${name}`, import.meta.url),
      'utf8',
    )
    const patched = patchTileRetention(original)
    assert.equal(patched.split("this.id.startsWith('language-overlap-')").length, 2)
    assert.ok(patched.includes('return atlasRetainChildren('))
    assert.ok(patched.includes('._getLoadedDescendents('))
    for (const query of ['', '?v=development-version'])
      assert.deepEqual(
        Reflect.apply(transform, null, [
          original,
          `/node_modules/maplibre-gl/dist/${name}${query}`,
        ]),
        { code: patched, map: null },
      )
  }
  assert.equal(Reflect.apply(transform, null, ['unrelated', '/another-module.mjs']), undefined)
  assert.throws(() => patchTileRetention('changed API'), /method changed/)
})
