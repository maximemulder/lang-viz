import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classifyRings, VectorTile } from '@mapbox/vector-tile'
import { type Feature, fromVectorTileJs, GeoJSONWrapper } from '@maplibre/vt-pbf'
import { PbfReader } from 'pbf'
import { clipFallbackTile } from '../src/features/map/overlap/fallback.ts'
import { coverageRectangles } from '../src/features/map/overlap/tiles.ts'

const ring = (l: number, t: number, r: number, b: number): [number, number][] => [
  [l, t],
  [r, t],
  [r, b],
  [l, b],
  [l, t],
]
const sourceFeatures: Feature[] = [
  {
    type: 3,
    id: 7,
    tags: { variant_id: 'A', color: '#ff0000' },
    geometry: [ring(0, 0, 16, 16), ring(2, 2, 6, 6).reverse()],
  },
  { type: 3, id: 8, tags: { variant_id: 'B', color: '#0000ff' }, geometry: [ring(0, 0, 16, 16)] },
]
const sourceLayer = new GeoJSONWrapper(sourceFeatures, { extent: 16, version: 2 })
sourceLayer.name = 'language_areas'
const data = fromVectorTileJs({ layers: { language_areas: sourceLayer } })
const tile = { z: 0, x: 0, y: 0 }
const area = (rings: [number, number][][]) =>
  rings.reduce((sum, points) => {
    let signed = 0
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]
      const b = points[i]
      if (a && b) signed += a[0] * b[1] - b[0] * a[1]
    }
    return sum + signed / 2
  }, 0)

test('coverage masks align across zoom levels and include empty computed tiles', () => {
  assert.deepEqual(coverageRectangles(tile, [{ z: 1, x: 0, y: 0 }], 16), [[0, 0, 8, 8]])
  assert.deepEqual(coverageRectangles({ z: 3, x: 0, y: 0 }, [tile], 16), [[0, 0, 16, 16]])
  assert.deepEqual(coverageRectangles({ z: 3, x: 7, y: 7 }, [{ z: 1, x: 0, y: 0 }], 16), [])
})

test('fallback passes uncovered tiles through and omits fully covered tiles', async () => {
  assert.equal(await clipFallbackTile(data, tile, []), data)
  assert.equal((await clipFallbackTile(data, tile, [tile])).length, 0)
  assert.equal((await clipFallbackTile(data, { z: 4, x: 3, y: 5 }, [tile])).length, 0)
})

test('fallback removes only covered interiors while preserving holes, IDs, colors, and selection properties', async () => {
  // The opposite quarter is covered; the hole in the first feature stays intact.
  const output = await clipFallbackTile(data, tile, [{ z: 1, x: 1, y: 1 }])
  const layer = new VectorTile(new PbfReader(output)).layers.language_areas
  assert.ok(layer)
  assert.equal(layer.length, 2)
  for (let i = 0; i < layer.length; i++) {
    const feature = layer.feature(i)
    assert.equal(feature.id, i + 7)
    assert.deepEqual({ ...feature.properties }, sourceFeatures[i]?.tags)
    const rings = feature
      .loadGeometry()
      .map((points) => points.map(({ x, y }): [number, number] => [x, y]))
    assert.equal(area(rings), i === 0 ? 176 : 192)
    assert.equal(classifyRings(feature.loadGeometry())[0]?.length, i === 0 ? 2 : 1)
    for (const polygon of classifyRings(feature.loadGeometry())) {
      // No polygon interior enters the removed bottom-right quarter.
      for (const points of polygon) for (const { x, y } of points) assert.ok(x <= 8 || y <= 8)
    }
  }
})

test('adjacent coverage tiles leave no duplicate fallback, across repeated requests', async () => {
  const covered = [
    { z: 1, x: 0, y: 0 },
    { z: 1, x: 1, y: 0 },
  ]
  for (let i = 0; i < 3; i++) {
    const result = new VectorTile(new PbfReader(await clipFallbackTile(data, tile, covered)))
    const layer = result.layers.language_areas
    assert.ok(layer)
    for (let j = 0; j < layer.length; j++) {
      const feature = layer.feature(j)
      assert.equal(
        area(feature.loadGeometry().map((points) => points.map(({ x, y }) => [x, y]))),
        128,
      )
    }
  }
})
