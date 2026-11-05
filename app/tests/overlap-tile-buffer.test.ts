import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classifyRings, VectorTile } from '@mapbox/vector-tile'
import { PbfReader } from 'pbf'
import {
  COVERAGE_LAYER,
  deliveryTile,
  encodeCoverageTile,
  tileKey,
} from '../src/features/map/overlap/delivery.ts'
import { clipFallbackTile } from '../src/features/map/overlap/fallback.ts'
import { loadCoveragePartition } from '../src/features/map/overlap/geometry.ts'
import { bufferTileEdges } from '../src/features/map/overlap/tileBuffer.ts'

type Ring = [number, number][]
const box = (l: number, t: number, r: number, b: number): Ring => [
  [l, t],
  [r, t],
  [r, b],
  [l, b],
  [l, t],
]
const rings = (data: Uint8Array) => {
  const layer = new VectorTile(new PbfReader(data)).layers[COVERAGE_LAYER]
  assert.ok(layer)
  return layer.feature(0).loadGeometry()
}
const sameInterior = async (a: Ring[], b: Ring[]) => {
  const partition = await loadCoveragePartition()
  const regions = partition(
    [
      { id: 'A', geometry: [a] },
      { id: 'B', geometry: [b] },
    ],
    8192,
    { includeSingles: true },
  )
  assert.ok(regions.length)
  assert.ok(
    regions.every((r) => r.members.length === 2),
    'Buffered and original geometry must be identical inside the tile',
  )
}
const tuples = (data: Uint8Array) =>
  rings(data).map((r) => r.map(({ x, y }): [number, number] => [x, y]))

test('tile buffers preserve canonical geometry, natural boundary endpoints, and holes', async () => {
  const geometry = [box(0, 0, 8192, 8192), box(100, 100, 200, 200).reverse()]
  const buffered = bufferTileEdges(geometry, 8192)
  assert.equal(
    buffered.length,
    2,
    'Aprons join the original shell instead of introducing overlapping shells',
  )
  assert.deepEqual(buffered[1], geometry[1])
  assert.deepEqual(buffered[0], box(-64, -64, 8256, 8256))
  await sameInterior(geometry, buffered)
  const coast: Ring[] = [
    [
      [0, 100],
      [200, 200],
      [100, 300],
      [0, 100],
    ],
  ]
  assert.equal(
    bufferTileEdges(coast, 8192),
    coast,
    'A single boundary endpoint must not inflate a coastline',
  )
  const notch: Ring[] = [
    [
      [0, 100],
      [200, 200],
      [100, 300],
      [0, 300],
      [0, 100],
    ],
  ]
  const bufferedNotch = bufferTileEdges(notch, 8192)
  assert.ok(bufferedNotch[0]?.some(([x, y]) => x === 0 && y === 100))
  assert.ok(bufferedNotch[0]?.some(([x, y]) => x === 0 && y === 300))
  await sameInterior(notch, bufferedNotch)
  const repeated = [box(0, 0, 8192, 8192)]
  repeated[0]?.splice(1, 0, [8192, 0])
  assert.deepEqual(bufferTileEdges(repeated, 8192), [box(-64, -64, 8256, 8256)])
  const interior = [box(10, 10, 100, 100)]
  assert.equal(bufferTileEdges(interior, 8192), interior)
})

const tile = encodeCoverageTile({
  tile: { z: 2, x: 0, y: 0 },
  extent: 8192,
  vertices: 10,
  features: [
    {
      type: 'Feature',
      properties: { variantIds: ['A', 'B'], pattern: 'overlap:A|B' },
      geometry: {
        type: 'MultiPolygon',
        coordinates: [[box(0, 0, 8192, 8192), box(100, 100, 200, 200).reverse()]],
      },
    },
  ],
})

test('native and assembled parents buffer only their own outer edges, preserving memberships and holes', async () => {
  const tiles = new Map([[tileKey(tile.tile), tile]])
  for (const target of [tile.tile, { z: 1, x: 0, y: 0 }, { z: 0, x: 0, y: 0 }]) {
    const original = tuples(deliveryTile(tiles, target))
    const bufferedData = deliveryTile(tiles, target, true)
    const buffered = tuples(bufferedData)
    await sameInterior(original, buffered)
    const scale = 2 ** (tile.tile.z - target.z)
    assert.ok(
      buffered
        .flat()
        .every(([x, y]) => (x <= 8192 / scale && y <= 8192 / scale) || target.z === tile.tile.z),
      'Native aprons must not survive at internal parent boundaries',
    )
    assert.equal(classifyRings(rings(bufferedData))[0]?.length, 2)
    const feature = new VectorTile(new PbfReader(bufferedData)).layers[COVERAGE_LAYER]?.feature(0)
    assert.equal(feature?.properties.variantIds, '["A","B"]')
  }
  assert.equal(
    deliveryTile(tiles, tile.tile, true),
    tile.renderData,
    'Native render bytes remain reusable',
  )
})

test('clipped fallback buffers outer edges without filling holes or internal coverage masks', async () => {
  const coverage = [{ z: 3, x: 1, y: 1 }]
  const original = await clipFallbackTile(tile.data, tile.tile, coverage)
  const bufferedData = await clipFallbackTile(
    tile.data,
    tile.tile,
    coverage,
    undefined,
    undefined,
    true,
  )
  await sameInterior(tuples(original), tuples(bufferedData))
  const originalFeature = new VectorTile(new PbfReader(original)).layers[COVERAGE_LAYER]?.feature(0)
  const bufferedFeature = new VectorTile(new PbfReader(bufferedData)).layers[
    COVERAGE_LAYER
  ]?.feature(0)
  assert.deepEqual({ ...bufferedFeature?.properties }, { ...originalFeature?.properties })
  assert.equal(bufferedFeature?.id, originalFeature?.id)
})
