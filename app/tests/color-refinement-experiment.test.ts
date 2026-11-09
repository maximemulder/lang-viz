import assert from 'node:assert/strict'
import { test } from 'node:test'
import { type Group, spatialEdges, spatialRefinement } from '../scripts/color-refinement/spatial.ts'
import { familyColorFrame } from '../src/domain/colorHierarchy.ts'
import { colorDistance, colorSample } from '../src/domain/familyColors.ts'

// Independent direct distances on small fixtures, rather than the production
// two-pass distance transform, exercise locality and graph sampling.
const fields = (cells: readonly number[], columns: number, rows: number) =>
  Float32Array.from({ length: columns * rows }, (_, cell) =>
    Math.min(
      ...cells.map((other) =>
        Math.max(
          Math.abs((cell % columns) - (other % columns)),
          Math.abs(Math.floor(cell / columns) - Math.floor(other / columns)),
        ),
      ),
    ),
  )

const group = (id: string, ids: string[], cells: number[][]): Group => {
  const anchor = colorSample('#009696')
  const radius = 0.15
  const frame = familyColorFrame(anchor, radius, [])
  return {
    id,
    anchor,
    radius,
    axes: frame.axes,
    planes: [],
    localPlanes: new Map(),
    vertices: ids.map((languageId, index) => ({
      id: languageId,
      languageId,
      cells: cells[index] ?? [],
    })),
    weights: new Map(ids.map((id) => [id, 1])),
    positions: new Map(
      ids.map((id, index) => [
        id,
        {
          coordinates: [0, 0, 0],
          box: frame.box,
          path: [index],
        },
      ]),
    ),
  }
}

test('experiment graph protects an enclave and excludes distant footprints', () => {
  const large = group('large-family', ['large'], [Array.from({ length: 100 }, (_, i) => i)])
  const small = group('small-family', ['small'], [[44]])
  const edges = spatialEdges([large, small], 10, 10, fields)
  assert.equal(edges.length, 1)
  assert.equal(edges[0]?.weight, 1)
  const distant = group('distant-family', ['distant'], [[99]])
  assert.equal(spatialEdges([group('a', ['a'], [[0]]), distant], 10, 10, fields).length, 0)
})

test('dense equal-strength contacts are distributed rather than tied to early IDs', () => {
  const ids = Array.from({ length: 48 }, (_, i) => `language-${i}`)
  const groups = [
    group(
      'family',
      ids,
      ids.map(() => [44]),
    ),
  ]
  const edges = spatialEdges(groups, 10, 10, fields)
  const degree = new Map(ids.map((id) => [id, 0]))
  for (const edge of edges)
    for (const vertex of [edge.a, edge.b]) degree.set(vertex.id, (degree.get(vertex.id) ?? 0) + 1)
  assert.ok(Math.min(...degree.values()) >= 12)
  assert.ok(Math.max(...degree.values()) < 40, 'ID-biased sampling creates hub vertices')
  assert.deepEqual(spatialEdges(groups, 10, 10, fields), edges)
})

test('experimental refinement preserves fixed colors, family roots and hidden relatives', () => {
  const original = group('family', ['family', 'a', 'b', 'fixed'], [[44], [44], [44], [44]])
  const groups = [
    {
      ...original,
      vertices: original.vertices.map((vertex) =>
        vertex.id === 'fixed' ? { ...vertex, fixed: colorSample('#ff00ff') } : vertex,
      ),
    },
  ]
  const colors = new Map(['family', 'a', 'b', 'fixed', 'hidden'].map((id) => [id, original.anchor]))
  const before = new Map(colors)
  const result = spatialRefinement(groups, colors, [], 10, 10, fields)
  for (const id of ['family', 'fixed', 'hidden']) assert.deepEqual(colors.get(id), before.get(id))
  assert.ok(result.edges > 0)
  assert.ok(
    colorDistance(colors.get('a') ?? original.anchor, colors.get('b') ?? original.anchor) > 0.025,
  )
  for (const sample of colors.values())
    assert.ok(colorDistance(sample, original.anchor) <= original.radius + 0.0015)
})
