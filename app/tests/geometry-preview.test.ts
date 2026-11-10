import assert from 'node:assert/strict'
import { test } from 'node:test'
import { type Feature, fromVectorTileJs, GeoJSONWrapper } from '@maplibre/vt-pbf'
import { geometryBoundaries } from '../src/features/map/geometryBoundaries.ts'
import { type CoverageTile, OverlapComputer } from '../src/features/map/overlap/compute.ts'

const required = <T>(value: T | null | undefined): T => {
  assert.ok(value !== null && value !== undefined)
  return value
}

type Point = [number, number]
const box = (l: number, t: number, r: number, b: number): Point[] => [
  [l, t],
  [r, t],
  [r, b],
  [l, b],
  [l, t],
]
const source = (features: { id: string; rings: Point[][] }[]) => {
  const layer = new GeoJSONWrapper(
    features.map(({ id, rings }) => ({ type: 3, tags: { variant_id: id }, geometry: rings })),
    { extent: 4096, version: 2 },
  )
  layer.name = 'areas'
  return fromVectorTileJs({ layers: { areas: layer } })
}
const preview = async (
  bytes: Uint8Array,
  groups: readonly (readonly string[])[],
  signal?: AbortSignal,
) => {
  signal?.throwIfAborted()
  const variantIds = [...new Set(groups.flat())]
  const variantGroups = Object.fromEntries(
    variantIds.map((id) => [
      id,
      groups.flatMap((group, index) => (group.includes(id) ? [`group:${index}`] : [])),
    ]),
  )
  const computer = new OverlapComputer()
  const tiles: CoverageTile[] = []
  for await (const tile of computer.computeTiles(
    { getZxy: async () => ({ data: bytes.slice().buffer }) },
    {
      requestId: 1,
      archiveUrl: 'https://atlas.test/areas.pmtiles',
      sourceLayer: 'areas',
      variantIds,
      variantGroups,
      tiles: [{ z: 0, x: 0, y: 0 }],
    },
    () => !signal?.aborted,
    undefined,
    signal,
  ))
    tiles.push(tile)
  return required(tiles[0])
}
const area = (tile: CoverageTile) =>
  tile.features.reduce(
    (sum, f) =>
      sum +
      f.geometry.coordinates.flat().reduce(
        (sum, ring) =>
          sum +
          ring.slice(1).reduce((n, b, i) => {
            const a = required(ring[i])
            return n + (a[0] * b[1] - b[0] * a[1]) / 2
          }, 0),
        0,
      ),
    0,
  )
const edges = (tile: CoverageTile) =>
  geometryBoundaries(
    tile.features.map((f) => ({
      type: 3,
      tags: { variantIds: JSON.stringify(f.properties.variantIds) },
      geometry: f.geometry.coordinates.flat(),
    })),
    tile.extent,
  )
const length = (edges: Feature[], group: string) =>
  edges
    .filter((f) => Boolean(f.tags?.[`l:${group}`]) !== Boolean(f.tags?.[`r:${group}`]))
    .reduce(
      (sum, f) =>
        sum +
        (f.geometry as Point[][]).reduce(
          (sum, line) =>
            sum +
            line.slice(1).reduce((n, b, i) => {
              const a = required(line[i])
              return n + Math.hypot(b[0] - a[0], b[1] - a[1])
            }, 0),
          0,
        ),
      0,
    )

test('family preview uses ordinary composition to dissolve contained, overlapping and adjacent contributors', async () => {
  const result = await preview(
    source([
      { id: 'parent', rings: [box(100, 100, 600, 600)] },
      { id: 'contained', rings: [box(200, 200, 400, 400)] },
      { id: 'overlap', rings: [box(500, 300, 800, 700)] },
      { id: 'adjacent', rings: [box(800, 300, 1000, 700)] },
      { id: 'unselected', rings: [box(1500, 100, 2000, 700)] },
    ]),
    [['parent', 'contained', 'overlap', 'adjacent']],
  )
  assert.equal(result.features.length, 1)
  assert.equal(Math.abs(area(result)), 420000)
  assert.equal(required(result.features[0]).geometry.coordinates.flat().length, 1)
  assert.equal(length(edges(result), 'group:0'), 3000)
})
test('preview composition preserves islands and uncovered holes', async () => {
  const result = await preview(
    source([
      { id: 'parent', rings: [box(100, 100, 900, 900), box(300, 300, 700, 700).reverse()] },
      { id: 'child', rings: [box(300, 300, 500, 700)] },
      { id: 'island', rings: [box(1200, 200, 1300, 300)] },
    ]),
    [['parent', 'child', 'island']],
  )
  assert.equal(Math.abs(area(result)), 570000)
  assert.equal(required(result.features[0]).geometry.coordinates.length, 2)
  assert.equal(required(result.features[0]).geometry.coordinates.flat().length, 3)
})
test('independent preview representations keep their exact boundaries through shared overlap faces', async () => {
  const result = await preview(
    source([
      { id: 'a', rings: [box(100, 100, 600, 600)] },
      { id: 'b', rings: [box(400, 100, 900, 600)] },
    ]),
    [['a'], ['b']],
  )
  assert.equal(length(edges(result), 'group:0'), 2000)
  assert.equal(length(edges(result), 'group:1'), 2000)
})
test('clipped preview geometry adds no borders along tile cuts; empty selections and cancellation stay empty', async () => {
  const bytes = source([
    { id: 'a', rings: [box(-80, 100, 4176, 600)] },
    { id: 'child', rings: [box(1000, 100, 3000, 600)] },
  ])
  const result = await preview(bytes, [['a', 'child']])
  assert.equal(Math.abs(area(result)), 4096 * 500)
  assert.equal(length(edges(result), 'group:0'), 4096 * 2)
  assert.equal((await preview(bytes, [['missing']])).features.length, 0)
  assert.equal((await preview(bytes, [])).features.length, 0)
  await assert.rejects(preview(bytes, [['a']], AbortSignal.abort()), { name: 'AbortError' })
})
