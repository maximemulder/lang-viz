import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classifyRings, VectorTile } from '@mapbox/vector-tile'
import { type Feature, fromVectorTileJs, GeoJSONWrapper } from '@maplibre/vt-pbf'
import { PbfReader } from 'pbf'
import { dissolveOutlineTile } from '../src/features/map/outlineGeometry.ts'

import { OUTLINE_LAYER, outlineGroupsKey } from '../src/features/map/outlineSelection.ts'

const box = (left: number, top: number, right: number, bottom: number): [number, number][] => [
  [left, top],
  [right, top],
  [right, bottom],
  [left, bottom],
  [left, top],
]
const tile = (features: { id: string; rings: [number, number][][] }[]) => {
  const layer = new GeoJSONWrapper(
    features.map(
      ({ id, rings }): Feature => ({
        type: 3,
        tags: { variant_id: id },
        geometry: rings,
      }),
    ),
    { extent: 4096, version: 2 },
  )
  layer.name = 'areas'
  return fromVectorTileJs({ layers: { areas: layer } })
}
const decode = (bytes: Uint8Array) => {
  if (!bytes.length) return []
  const layer = new VectorTile(new PbfReader(bytes)).layers[OUTLINE_LAYER]
  assert.ok(layer)
  return Array.from({ length: layer.length }, (_, i) => layer.feature(i))
}
const area = (feature: ReturnType<typeof decode>[number]) =>
  feature.loadGeometry().reduce(
    (sum, ring) =>
      sum +
      ring.slice(1).reduce((area, b, i) => {
        const a = ring[i]
        assert.ok(a)
        return area + (a.x * b.y - b.x * a.y) / 2
      }, 0),
    0,
  )

test('family outlines dissolve contained, overlapping and adjacent descendant edges', async () => {
  const source = tile([
    { id: 'parent', rings: [box(100, 100, 600, 600)] },
    { id: 'contained', rings: [box(200, 200, 400, 400)] },
    { id: 'overlap', rings: [box(500, 300, 800, 700)] },
    { id: 'adjacent', rings: [box(800, 300, 1000, 700)] },
    { id: 'other-family', rings: [box(1500, 100, 2000, 700)] },
  ])
  const features = decode(
    await dissolveOutlineTile(source, 'areas', [['parent', 'contained', 'overlap', 'adjacent']]),
  )
  assert.equal(features.length, 1)
  const merged = features[0]
  assert.ok(merged)
  assert.equal(merged.loadGeometry().length, 1, 'No internal descendant rings remain')
  assert.equal(
    area(merged),
    420_000,
    'The union retains descendant spillover and excludes other families',
  )
  assert.deepEqual(JSON.parse(String(merged.properties.variant_ids)), [
    'adjacent',
    'contained',
    'overlap',
    'parent',
  ])
  for (const ring of merged.loadGeometry())
    for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1],
        b = ring[i]
      assert.ok(a && b)
      assert.ok(
        a.x !== b.x || ![200, 400, 800].includes(a.x),
        'No descendant border inside the union',
      )
    }
})

test('union outlines preserve islands and uncovered holes, and remove covered parts of holes', async () => {
  const source = tile([
    { id: 'parent', rings: [box(100, 100, 900, 900), box(300, 300, 700, 700).reverse()] },
    { id: 'child', rings: [box(300, 300, 500, 700)] },
    { id: 'island', rings: [box(1200, 200, 1300, 300)] },
  ])
  const features = decode(
    await dissolveOutlineTile(source, 'areas', [['parent', 'child', 'island']]),
  )
  const merged = features[0]
  assert.ok(merged)
  const polygons = classifyRings(merged.loadGeometry())
  assert.equal(polygons.length, 2)
  assert.equal(polygons.flat().length, 3, 'One remaining genuine hole and two island exteriors')
  assert.equal(area(merged), 570_000)
})

test('separate inspected families retain independent boundaries', async () => {
  const source = tile([
    { id: 'a', rings: [box(100, 100, 600, 600)] },
    { id: 'b', rings: [box(400, 100, 900, 600)] },
  ])
  const features = decode(await dissolveOutlineTile(source, 'areas', [['a'], ['b']]))
  assert.equal(features.length, 2)
  assert.deepEqual(features.map(area), [250_000, 250_000])
})

test('outlines retain source buffers so tile cuts do not create visible borders', async () => {
  const source = tile([
    { id: 'parent', rings: [box(-80, 100, 4176, 600)] },
    { id: 'child', rings: [box(1000, 100, 3000, 600)] },
  ])
  const merged = decode(await dissolveOutlineTile(source, 'areas', [['parent', 'child']]))[0]
  assert.ok(merged)
  const points = merged.loadGeometry().flat()
  assert.equal(Math.min(...points.map(({ x }) => x)), -80)
  assert.equal(Math.max(...points.map(({ x }) => x)), 4176)
  assert.ok(points.every(({ x }) => x !== 0 && x !== 4096))
  assert.equal(area(merged), 4256 * 500)
})

test('empty/missing selections and cancellation never return a stale outline', async () => {
  const source = tile([{ id: 'a', rings: [box(100, 100, 600, 600)] }])
  for (const [bytes, layer, groups] of [
    [new Uint8Array(), 'areas', [['a']]],
    [source, 'missing', [['a']]],
    [source, 'areas', [['missing']]],
    [source, 'areas', []],
  ] as const)
    assert.equal((await dissolveOutlineTile(bytes, layer, groups)).length, 0)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(dissolveOutlineTile(source, 'areas', [['a']], controller.signal), {
    name: 'AbortError',
  })
  assert.equal(decode(await dissolveOutlineTile(source, 'areas', [['a', 'a']])).length, 1)
  assert.equal(outlineGroupsKey([['b', 'a', 'a'], [], ['a', 'b']]), '[["a","b"]]')
})
