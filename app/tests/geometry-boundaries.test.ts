import assert from 'node:assert/strict'
import { test } from 'node:test'
import { VectorTile } from '@mapbox/vector-tile'
import type { Feature } from '@maplibre/vt-pbf'
import { PbfReader } from 'pbf'
import {
  BOUNDARY_ID,
  BOUNDARY_LAYER,
  geometryBoundaries,
} from '../src/features/map/geometryBoundaries.ts'
import { deliveryTile, encodeCoverageTile } from '../src/features/map/overlap/delivery.ts'

const required = <T>(value: T | null | undefined): T => {
  assert.ok(value !== null && value !== undefined)
  return value
}

type Point = [number, number]
const polygon = (ids: string[], rings: Point[][]): Feature => ({
  type: 3,
  tags: { variantIds: JSON.stringify(ids) },
  geometry: rings,
})
const rectangle = (ids: string[], l: number, t: number, r: number, b: number) =>
  polygon(ids, [
    [
      [l, t],
      [r, t],
      [r, b],
      [l, b],
      [l, t],
    ],
  ])
const selected = (features: Feature[], ids: string[]) =>
  features.filter(
    ({ tags }) => ids.some((id) => tags?.[`l:${id}`]) !== ids.some((id) => tags?.[`r:${id}`]),
  )
const length = (features: Feature[]) =>
  features.reduce(
    (sum, f) =>
      sum +
      (f.geometry as Point[][]).reduce(
        (n, line) =>
          n +
          line
            .slice(1)
            .reduce(
              (n, p, i) => n + Math.hypot(p[0] - required(line[i])[0], p[1] - required(line[i])[1]),
              0,
            ),
        0,
      ),
    0,
  )

test('one boundary network serves individual entries and dissolved groups, including subdivided shared edges', () => {
  const faces = [
    rectangle(['a'], 10, 10, 50, 90),
    polygon(
      ['b'],
      [
        [
          [50, 10],
          [90, 10],
          [90, 90],
          [50, 90],
          [50, 60],
          [50, 30],
          [50, 10],
        ],
      ],
    ),
  ]
  const edges = geometryBoundaries(faces, 100)
  assert.equal(length(selected(edges, ['a'])), 240)
  assert.equal(length(selected(edges, ['b'])), 240)
  assert.equal(length(selected(edges, ['a', 'b'])), 320)
  // IDs describe adjacency rather than tile-local feature order. Equal IDs
  // therefore always need equal paint state in native, parent and fallback tiles.
  for (const edge of edges) {
    const sides = JSON.parse(String(edge.tags?.[BOUNDARY_ID])) as string[][]
    assert.deepEqual(
      sides.map((side, index) =>
        Object.fromEntries(side.map((id) => [`${index ? 'r' : 'l'}:${id}`, true])),
      ),
      ['l', 'r'].map((side) =>
        Object.fromEntries(
          Object.entries(edge.tags ?? {}).filter(([key]) => key.startsWith(`${side}:`)),
        ),
      ),
    )
  }
})

test('overlap membership and refinement use displayed faces; holes and islands survive', () => {
  const edges = geometryBoundaries(
    [
      rectangle(['parent'], 10, 10, 30, 90),
      rectangle(['child', 'comparison'], 30, 10, 90, 90),
      polygon(
        ['island'],
        [
          [
            [110, 10],
            [150, 10],
            [150, 50],
            [110, 50],
            [110, 10],
          ],
          [
            [120, 20],
            [120, 40],
            [140, 40],
            [140, 20],
            [120, 20],
          ],
        ],
      ),
    ],
    200,
  )
  assert.equal(length(selected(edges, ['parent'])), 200)
  assert.equal(length(selected(edges, ['child'])), 280)
  assert.equal(length(selected(edges, ['parent', 'child'])), 320)
  assert.equal(length(selected(edges, ['island'])), 240)
  assert.equal(length(selected(edges, ['child', 'comparison'])), 280)
})

test('native fill/outline coordinates share quantization; retained parents remove internal tile cuts', () => {
  const tile = (x: number) =>
    encodeCoverageTile({
      tile: { z: 1, x, y: 0 },
      extent: 8192,
      vertices: 5,
      features: [
        {
          type: 'Feature',
          properties: { pattern: 'p', variantIds: ['a'] },
          geometry: {
            type: 'MultiPolygon',
            coordinates: [
              [
                [
                  [0, 100],
                  [8192, 100],
                  [8192, 1000],
                  [0, 1000],
                  [0, 100],
                ],
              ],
            ],
          },
        },
      ],
    })
  const a = tile(0),
    b = tile(1)
  const boundaries = (bytes: Uint8Array) => {
    const layer = required(new VectorTile(new PbfReader(bytes)).layers[BOUNDARY_LAYER])
    return Array.from({ length: layer.length }, (_, i) => layer.feature(i).loadGeometry())
  }
  assert.deepEqual(boundaries(a.data), boundaries(a.renderData))
  const nativeLayer = required(new VectorTile(new PbfReader(a.data)).layers[BOUNDARY_LAYER])
  const parentLayer = required(
    new VectorTile(new PbfReader(deliveryTile(new Map([['a', a]]), { z: 0, x: 0, y: 0 }))).layers[
      BOUNDARY_LAYER
    ],
  )
  assert.equal(
    parentLayer.feature(0).properties[BOUNDARY_ID],
    nativeLayer.feature(0).properties[BOUNDARY_ID],
  )
  // An absent neighboring child cannot turn the native east clipping cut into
  // an outline at x=4096 inside the retained parent.
  for (const buffered of [false, true]) {
    const partial = boundaries(
      deliveryTile(new Map([['a', a]]), { z: 0, x: 0, y: 0 }, buffered),
    ).flat()
    assert.ok(partial.length)
    assert.ok(
      partial.every((line) => line.every((p) => p.y === 50) || line.every((p) => p.y === 500)),
      'retained clipping cuts must not become geographic boundaries',
    )
  }
  const parent = boundaries(
    deliveryTile(
      new Map([
        ['a', a],
        ['b', b],
      ]),
      { z: 0, x: 0, y: 0 },
      true,
    ),
  ).flat()
  assert.ok(parent.length)
  assert.ok(
    parent.every(
      (line) => line.every((point) => point.y === 50) || line.every((point) => point.y === 500),
    ),
  )
})
