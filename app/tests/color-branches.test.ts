import assert from 'node:assert/strict'
import { test } from 'node:test'
import { branchCuts, branchRefinement, shadePreference } from '../scripts/color-branches/refine.ts'
import type { Group } from '../scripts/color-refinement/spatial.ts'
import { familyColorFrame, familyShade } from '../src/domain/colorHierarchy.ts'
import { colorDistance, colorSample } from '../src/domain/familyColors.ts'

const field = (cells: readonly number[], columns: number, rows: number) =>
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

const fixture = () => {
  const anchor = colorSample('#009696')
  const radius = 0.17
  const frame = familyColorFrame(anchor, radius, [])
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
  const positions = new Map(
    ids.map((id, i) => [
      id,
      {
        coordinates: [(i - 3.5) / 10, 0, 0],
        box: frame.box,
        path: [Math.floor(i / 2), i % 2],
      },
    ]),
  )
  const group: Group = {
    id: 'family',
    anchor,
    radius,
    axes: frame.axes,
    planes: [],
    localPlanes: new Map(),
    positions,
    weights: new Map(ids.map((id) => [id, 1])),
    vertices: ids.map((id) => ({ id, languageId: id, cells: [44] })),
  }
  const colors = new Map(
    ids.map((id) => [
      id,
      familyShade(anchor, positions.get(id)?.coordinates ?? [], radius, [], frame.axes),
    ]),
  )
  colors.set('hidden', anchor)
  colors.set('family', anchor)
  return { group, colors }
}

test('branch cuts conserve represented mass and preserve meaningful levels through unary paths', () => {
  const { group, colors } = fixture()
  const cuts = branchCuts(group, colors)
  assert.deepEqual(
    cuts.map((cut) => cut.length),
    [4, 4, 8, 8],
  )
  for (const cut of cuts) {
    assert.equal(
      cut.reduce((sum, b) => sum + b.mass, 0),
      8,
    )
    assert.equal(new Set(cut.flatMap((b) => b.ids)).size, 8)
  }
  const wrapped = {
    ...group,
    positions: new Map(
      [...group.positions].map(([id, p]) => [id, { ...p, path: [0, 0, ...p.path] }]),
    ),
  }
  assert.deepEqual(branchCuts(wrapped, colors), cuts)
})

test('branch optimization protects fixed representations, roots, hidden colors and determinism', () => {
  const { group, colors } = fixture()
  const fixed = colorSample('#f8834a')
  const modified = {
    ...group,
    vertices: group.vertices.map((v) => (v.id === 'a' ? { ...v, fixed } : v)),
  }
  const before = new Map(colors)
  branchRefinement([modified], colors, [], 10, 10, field)
  for (const id of ['a', 'family', 'hidden']) assert.deepEqual(colors.get(id), before.get(id))
  for (const color of colors.values())
    assert.ok(colorDistance(color, group.anchor) <= group.radius + 0.0015)
  const repeated = new Map(before)
  branchRefinement([modified], repeated, [], 10, 10, field)
  assert.deepEqual(colors, repeated)
  assert.ok([...colors].some(([id, color]) => color.hex !== before.get(id)?.hex))
  assert.equal(
    branchCuts(modified, before)[0]
      ?.flatMap((b) => b.ids)
      .includes('a'),
    false,
  )
})

test('branch references retain broad contrasts while resolving initially close siblings', () => {
  const { group, colors } = fixture()
  branchRefinement([group], colors, [], 10, 10, field)
  const cut = branchCuts(group, colors)[0] ?? []
  const distances = cut.flatMap((a, i) =>
    cut.slice(i + 1).map((b) => colorDistance(a.current, b.current)),
  )
  assert.ok(Math.min(...distances) > 0.02)
  const a = colors.get('a')
  const b = colors.get('b')
  assert.ok(a && b)
  assert.ok(colorDistance(a, b) > 0.025)
  assert.equal(shadePreference(colorSample('#009696')), 0)
})

test('strong aesthetic pressure cannot erase existing separation between substantial branches', () => {
  const { group, colors } = fixture()
  const before = branchCuts(group, colors)
  branchRefinement([group], colors, [], 10, 10, field, 2)
  const after = branchCuts(group, colors)
  before.forEach((cut, scale) => {
    const changed = after[scale] ?? []
    cut.forEach((branch, i) => {
      for (let j = i + 1; j < cut.length; j++) {
        const other = cut[j]
        const a = changed[i]
        const b = changed[j]
        assert.ok(other && a && b)
        const floor = Math.min(0.025, colorDistance(branch.seed, other.seed)) * 0.98
        assert.ok(colorDistance(a.seed, b.seed) >= floor - 1e-10)
      }
    })
  })
})
