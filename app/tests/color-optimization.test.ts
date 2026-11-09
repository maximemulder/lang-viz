import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { converter } from 'culori'
import type { Language } from '../src/domain/atlas.ts'
import { familyColorFrame, familyLayout, familyShade } from '../src/domain/colorHierarchy.ts'
import { type ColorOptimizationInput, optimizeColors } from '../src/domain/colorOptimization.ts'
import {
  buildColorTopology,
  buildSemanticPalette,
  DEFAULT_COLOR_CONFIGURATION,
} from '../src/domain/colors.ts'
import {
  buildFamilyLinks,
  type ColorFamily,
  colorDistance,
  familyColorSpaces,
  gamutSample,
} from '../src/domain/familyColors.ts'
import { buildLanguageHierarchy } from '../src/domain/hierarchy.ts'

const entry = (id: string, parentId: string | null): Language => ({
  id,
  name: id,
  parentId,
  classification: { kind: 'glottolog', glottocode: id },
  level: 'language',
  parentLanguageId: null,
  familyId: null,
  familyName: null,
  alternativeNames: [],
  iso6393: null,
  macroarea: null,
  countries: [],
  latitude: 20,
  longitude: 100,
  geometryVariantIds: [`source:${id}`],
})
const lab = converter('oklab')
const distance = (a: string | undefined, b: string | undefined) => {
  const x = lab(a)
  const y = lab(b)
  assert.ok(x && y)
  return Math.hypot((x.l - y.l) * 0.65, x.a - y.a, x.b - y.b)
}
const inputFor = (languages: Language[], ids: readonly string[]): ColorOptimizationInput => {
  const hierarchy = buildLanguageHierarchy(languages)
  const topology = buildColorTopology(hierarchy)
  return {
    topology,
    reference: buildSemanticPalette(hierarchy, topology),
    configuration: DEFAULT_COLOR_CONFIGURATION,
    view: {
      columns: 10,
      rows: 10,
      footprints: ids.map((id) => ({ id, languageId: id, cells: [44, 45, 54, 55] })),
    },
  }
}

test('sparse views reclaim hidden branches and spread the displayed siblings', () => {
  const ids = Array.from({ length: 20 }, (_, i) => `child-${i}`)
  const input = inputFor([entry('root', null), ...ids.map((id) => entry(id, 'root'))], ids)
  const sparse = optimizeColors({
    ...input,
    view: {
      ...input.view,
      footprints: input.view.footprints.filter(({ languageId }) =>
        ids.slice(0, 2).includes(languageId),
      ),
    },
  })
  const dense = optimizeColors(input)
  assert.ok(
    distance(sparse.colors.get(ids[0] as string), sparse.colors.get(ids[1] as string)) > 0.2,
  )
  assert.ok(sparse.after.internalContrast > sparse.before.internalContrast * 3)
  const colors = [...dense.colors.values()]
  const minimum = Math.min(
    ...colors.flatMap((a, i) => colors.slice(i + 1).map((b) => distance(a, b))),
  )
  assert.ok(distance(...([...sparse.colors.values()] as [string, string])) > minimum * 2)
  assert.equal(sparse.languageCount, 2)
  assert.equal(dense.languageCount, 20)
  assert.equal(
    sparse.colors.size,
    ids.length + 1,
    'offscreen relatives receive the frozen family palette',
  )
})

test('refresh is deterministic under reordered catalogs, footprints, cells and repeated calls', () => {
  const entries = [
    entry('root', null),
    entry('a', 'root'),
    entry('b', 'root'),
    entry('other', null),
  ]
  const input = inputFor(entries, ['a', 'b', 'other'])
  const expected = optimizeColors(input)
  const reordered = inputFor([...entries].reverse(), ['other', 'b', 'a'])
  assert.deepEqual(
    optimizeColors({
      ...reordered,
      view: {
        ...reordered.view,
        footprints: reordered.view.footprints.map((entry) => ({
          ...entry,
          cells: [...entry.cells].reverse(),
        })),
      },
    }),
    expected,
  )
  assert.deepEqual(optimizeColors(input), expected)
})

test('polygon footprints drive competition even with missing catalog coordinates', () => {
  const input = inputFor(
    [entry('a', null), entry('b', null)].map((language) => ({
      ...language,
      latitude: null,
      longitude: null,
    })),
    ['a', 'b'],
  )
  // Deliberately conflicting defaults: both occupy the same actual screen cells.
  const result = optimizeColors({
    ...input,
    reference: {
      ...input.reference,
      anchors: new Map([
        ['a', '#cc4488'],
        ['b', '#cc4488'],
      ]),
      colors: new Map([
        ['a', '#cc4488'],
        ['b', '#cc4488'],
      ]),
    },
  })
  assert.ok(distance(result.colors.get('a'), result.colors.get('b')) >= 0.22)
  assert.ok(result.after.localFamilyConflict < result.before.localFamilyConflict * 0.1)
})

test('explicit subtree anchors stay exact while their conflicting neighbors move', () => {
  const input = inputFor([entry('a', null), entry('b', null)], ['a', 'b'])
  const configuration = { ...DEFAULT_COLOR_CONFIGURATION, anchors: { a: '#cc4488' } }
  const result = optimizeColors({
    ...input,
    configuration,
    reference: {
      ...input.reference,
      anchors: new Map([
        ['a', '#cc4488'],
        ['b', '#cc4488'],
      ]),
      colors: new Map([
        ['a', '#cc4488'],
        ['b', '#cc4488'],
      ]),
    },
  })
  assert.equal(result.colors.get('a'), '#cc4488')
  assert.ok(distance(result.colors.get('a'), result.colors.get('b')) >= 0.22)
})

test('exact languoid and per-entry manual colors are fixed obstacles, including different periods', () => {
  const input = inputFor([entry('a', null), entry('b', null)], ['a', 'b'])
  for (const perEntry of [false, true]) {
    const result = optimizeColors({
      ...input,
      configuration: {
        ...DEFAULT_COLOR_CONFIGURATION,
        overrides: perEntry ? {} : { a: '#ff0000' },
      },
      reference: {
        ...input.reference,
        colors: new Map([
          ['a', '#3377bb'],
          ['b', '#ff0000'],
        ]),
      },
      view: {
        ...input.view,
        footprints: [
          ...input.view.footprints.map((entry) => ({
            ...entry,
            ...(perEntry && entry.languageId === 'a' ? { fixedColor: '#ff0000' } : {}),
          })),
          ...(perEntry
            ? [
                {
                  id: 'historic-a',
                  languageId: 'a',
                  cells: [44, 45, 54, 55],
                  fixedColor: '#0000ff',
                },
              ]
            : []),
        ],
      },
    })
    assert.ok(distance('#ff0000', result.colors.get('b')) >= 0.22)
    if (perEntry) assert.ok(distance('#0000ff', result.colors.get('b')) >= 0.15)
    assert.ok(result.after.localFamilyConflict < result.before.localFamilyConflict * 0.1)
  }
})

test('a rendered ancestor and descendant receive distinct colors without invisible unary steps costing space', () => {
  const input = inputFor([entry('a', null), entry('b', 'a')], ['a', 'b'])
  const result = optimizeColors(input)
  assert.notEqual(result.colors.get('a'), result.colors.get('b'))
  assert.ok(distance(result.colors.get('a'), result.colors.get('b')) >= 0.1)
  const unary = inputFor([entry('a', null), entry('middle', 'a'), entry('b', 'middle')], ['a', 'b'])
  const withUnary = optimizeColors(unary)
  for (const id of ['a', 'b']) assert.equal(withUnary.colors.get(id), result.colors.get(id))
  assert.deepEqual(withUnary.after, result.after)
})

test('empty, unknown, duplicate cells and very deep inputs remain finite', () => {
  const entries = Array.from({ length: 12000 }, (_, i) =>
    entry(`node-${i}`, i ? `node-${i - 1}` : null),
  )
  const input = inputFor(entries, ['node-0', 'node-11999'])
  const deep = optimizeColors(input)
  assert.equal(deep.languageCount, 2)
  assert.equal(deep.colors.size, entries.length)
  assert.notEqual(deep.colors.get('node-0'), deep.colors.get('node-11999'))
  assert.deepEqual(
    optimizeColors({ ...input, view: { ...input.view, footprints: [] } }).colors,
    new Map(),
  )
  const unknown = optimizeColors({
    ...input,
    view: {
      ...input.view,
      footprints: [
        { id: 'missing', languageId: 'missing', cells: [1] },
        { id: 'node-0', languageId: 'node-0', cells: [-1, 44, 44, 1000] },
      ],
    },
  })
  assert.equal(unknown.languageCount, 1)
  assert.equal(unknown.colors.size, entries.length)
  for (const color of deep.colors.values()) assert.match(color, /^#[a-f0-9]{6}$/)
})

test('real Turkic/Mongolic defaults separate and a focused Sinitic comparison improves readability', () => {
  const languages: Language[] = JSON.parse(
    readFileSync(new URL('../public/data/languages.json', import.meta.url), 'utf8'),
  )
  const ids = ['mand1415', 'jiny1235', 'yuec1235', 'ganc1239', 'hakk1236']
  const input = inputFor(languages, ids)
  assert.ok(
    distance(input.reference.colors.get('turk1311'), input.reference.colors.get('mong1329')) >=
      0.24,
  )
  const result = optimizeColors(input)
  assert.equal(result.rootCount, 1)
  assert.equal(result.languageCount, ids.length)
  assert.ok(result.after.internalContrast > result.before.internalContrast * 3)
  assert.ok(
    distance(result.colors.get('ganc1239'), result.colors.get('hakk1236')) >
      distance(input.reference.colors.get('ganc1239'), input.reference.colors.get('hakk1236')) * 3,
  )
})

test('crowding contracts family palettes and preserves offscreen family identity', () => {
  const children = Array.from({ length: 12 }, (_, i) => `child-${i}`)
  const neighbors = Array.from({ length: 18 }, (_, i) => `neighbor-${i}`)
  const input = inputFor(
    [
      entry('family', null),
      ...children.map((id) => entry(id, 'family')),
      entry('offscreen', 'family'),
      ...neighbors.map((id) => entry(id, null)),
    ],
    [...children, ...neighbors],
  )
  const crowded = optimizeColors(input)
  const focused = optimizeColors({
    ...input,
    view: {
      ...input.view,
      footprints: input.view.footprints.filter(({ languageId }) => children.includes(languageId)),
    },
  })
  const region = crowded.regions.get('family')
  assert.ok(region)
  assert.ok(region.radius < (focused.regions.get('family')?.radius ?? 0) / 2)
  for (const id of ['family', ...children, 'offscreen'])
    assert.ok(
      distance(crowded.colors.get(id), region.anchor) <= region.radius + 0.002,
      `${id} escaped the coherent family region`,
    )
  assert.ok(focused.after.internalContrast > crowded.after.internalContrast * 2)
})

test('crowded hue space leaves major branch differences in lightness', () => {
  const ids = ['a', 'b', 'c']
  const leaves = ids.flatMap((id) => Array.from({ length: 12 }, (_, i) => entry(`${id}-${i}`, id)))
  const input = inputFor(
    [entry('root', null), ...ids.map((id) => entry(id, 'root')), ...leaves],
    leaves.map((l) => l.id),
  )
  const anchor = gamutSample(0.65, 0.08, 0.04)
  const radius = 0.08
  const planes = [
    { l: 0, a: 1, b: 0, limit: 0.004, distance: 1 },
    { l: 0, a: -1, b: 0, limit: 0.004, distance: 1 },
    { l: 0, a: 0, b: 1, limit: 0.004, distance: 1 },
    { l: 0, a: 0, b: -1, limit: 0.004, distance: 1 },
  ]
  const frame = familyColorFrame(anchor, radius, planes)
  const positions = familyLayout(
    input.topology,
    input.reference.rootById,
    'root',
    new Map(leaves.map((l) => [l.id, 1])),
    frame.box,
  )
  const means = ids.map((id) => {
    const colors = leaves
      .filter((l) => l.parentId === id)
      .map((l) => {
        const position = positions.get(l.id)
        assert.ok(position)
        const color = familyShade(anchor, position.coordinates, radius, planes, frame.axes)
        assert.ok(colorDistance(anchor, color) <= radius + 0.002)
        assert.ok(Math.abs(color.a - anchor.a) < 0.006)
        assert.ok(Math.abs(color.b - anchor.b) < 0.006)
        return color
      })
    return colors.reduce((sum, color) => sum + color.l, 0) / colors.length
  })
  for (let i = 0; i < means.length; i++)
    for (let j = i + 1; j < means.length; j++)
      assert.ok(
        Math.abs((means[i] ?? 0) - (means[j] ?? 0)) * 0.65 > 0.035,
        'major branches flattened despite available lightness space',
      )
})

test('a blocked color component does not discard available orthogonal contrast', () => {
  const anchor = gamutSample(0.65, 0.05, 0.05)
  const color = familyShade(anchor, [0, 0.6, 0.8], 0.1, [
    { l: 0, a: 1, b: 0, limit: 0.003, distance: 1 },
  ])
  assert.ok((color.l - anchor.l) * 0.65 > 0.045)
  assert.ok(color.a - anchor.a < 0.0045)
})

test('distant tiny families do not consume an unrelated family shade budget', () => {
  const makeInput = (count: number) => {
    const others = Array.from({ length: count }, (_, i) => entry(`other-${i}`, null))
    const input = inputFor(
      [entry('family', null), entry('a', 'family'), entry('b', 'family'), ...others],
      ['a', 'b', ...others.map((l) => l.id)],
    )
    const anchor = '#b05582'
    return {
      ...input,
      configuration: { ...input.configuration, anchors: { family: anchor } },
      reference: {
        ...input.reference,
        anchors: new Map([...input.reference.anchors, ['family', anchor]]),
      },
      view: {
        columns: 32,
        rows: 32,
        footprints: [
          { id: 'a', languageId: 'a', cells: [66, 67, 68] },
          { id: 'b', languageId: 'b', cells: [98, 99, 100] },
          ...others.map((l) => ({ id: l.id, languageId: l.id, cells: [990] })),
        ],
      },
    }
  }
  const alone = optimizeColors(makeInput(0))
  const remote = optimizeColors(makeInput(30))
  assert.deepEqual(remote.regions.get('family'), alone.regions.get('family'))
  for (const id of ['family', 'a', 'b']) assert.equal(remote.colors.get(id), alone.colors.get(id))
})

test('a small local neighbor constrains nearby relatives while distant branches keep detail', () => {
  const anchor = gamutSample(0.65, 0.08, 0.03)
  const other = gamutSample(0.73, 0.08, 0.03)
  const input = inputFor(
    [entry('family', null), entry('a', 'family'), entry('b', 'family'), entry('other', null)],
    ['a', 'b', 'other'],
  )
  const result = optimizeColors({
    ...input,
    configuration: { ...input.configuration, anchors: { family: anchor.hex, other: other.hex } },
    reference: {
      ...input.reference,
      anchors: new Map([
        ['family', anchor.hex],
        ['other', other.hex],
      ]),
    },
    view: {
      columns: 32,
      rows: 32,
      footprints: [
        { id: 'a', languageId: 'a', cells: [800, 801, 832, 833] },
        { id: 'b', languageId: 'b', cells: [66, 67, 98, 99] },
        { id: 'other', languageId: 'other', cells: [66] },
      ],
    },
  })
  const near = lab(result.colors.get('b'))
  const far = lab(result.colors.get('a'))
  assert.ok(near && far)
  assert.ok(near.l - anchor.l < 0.016, 'nearby shade crossed its neighbor clearance')
  assert.ok(anchor.l - far.l > 0.045, 'distant branch lost available lightness detail')
})

test('more descendants cannot outweigh a small family competing with a large territory', () => {
  const makeInput = (count: number) => {
    const ids = Array.from({ length: count }, (_, i) => `child-${i}`)
    const input = inputFor(
      [
        entry('large', null),
        ...ids.map((id) => entry(id, 'large')),
        entry('small', null),
        entry('other', null),
      ],
      [...ids, 'small', 'other'],
    )
    return {
      ...input,
      view: {
        columns: 10,
        rows: 10,
        footprints: [
          ...ids.map((id) => ({
            id,
            languageId: id,
            cells: Array.from({ length: 70 }, (_, i) => i),
          })),
          { id: 'small', languageId: 'small', cells: [68, 69] },
          { id: 'other', languageId: 'other', cells: [80, 81] },
        ],
      },
    }
  }
  const small = optimizeColors(makeInput(4))
  const large = optimizeColors(makeInput(300))
  for (const id of ['large', 'small', 'other'])
    assert.equal(
      large.regions.get(id)?.anchor,
      small.regions.get(id)?.anchor,
      'family assignment must be independent of classification cardinality',
    )
  assert.ok(distance(large.colors.get('small'), large.regions.get('large')?.anchor) > 0.24)
})

// Subdued anchors retain a 0.20 separation here; the former vivid palette used 0.22.
test('prominent families compete globally, even when their territories are distant', () => {
  const input = inputFor(
    [
      entry('a', null),
      entry('b', null),
      entry('c', null),
      ...Array.from({ length: 16 }, (_, i) => entry(`tiny-${i}`, null)),
    ],
    ['a', 'b', 'c', ...Array.from({ length: 16 }, (_, i) => `tiny-${i}`)],
  )
  const footprints = input.view.footprints.map((entry, i) => ({
    ...entry,
    cells: i < 3 ? Array.from({ length: 12 }, (_, j) => i * 40 + j) : [38],
  }))
  const result = optimizeColors({ ...input, view: { columns: 12, rows: 12, footprints } })
  for (const [a, b] of [
    ['a', 'b'],
    ['b', 'c'],
    ['a', 'c'],
  ] as const)
    assert.ok(
      distance(result.colors.get(a), result.colors.get(b)) > 0.2,
      `${a}/${b}: ${distance(result.colors.get(a), result.colors.get(b))}`,
    )
})

test('distant prominent families retain a separation gap across their complete palettes', () => {
  const first = gamutSample(0.65, 0.08, 0.04)
  const second = gamutSample(0.75, 0.04, 0.08)
  const ids = ['a-0', 'a-1', 'a-2', 'b-0', 'b-1', 'b-2']
  const input = inputFor(
    [entry('a', null), entry('b', null), ...ids.map((id) => entry(id, id[0] ?? null))],
    ids,
  )
  const result = optimizeColors({
    ...input,
    configuration: { ...input.configuration, anchors: { a: first.hex, b: second.hex } },
    reference: {
      ...input.reference,
      anchors: new Map([
        ['a', first.hex],
        ['b', second.hex],
      ]),
    },
    view: {
      columns: 16,
      rows: 16,
      footprints: ids.map((id, i) => ({
        id,
        languageId: id,
        cells: Array.from({ length: 4 }, (_, j) => (i < 3 ? i * 4 + j : 220 + (i - 3) * 4 + j)),
      })),
    },
  })
  const identity = (a: string, b: string) => {
    const x = lab(a),
      y = lab(b)
    assert.ok(x && y)
    return Math.hypot((x.l - y.l) * 0.45, x.a - y.a, x.b - y.b)
  }
  const gap = Math.min(0.2, identity(first.hex, second.hex) * 0.8)
  for (const a of ['a', 'a-0', 'a-1', 'a-2'])
    for (const b of ['b', 'b-0', 'b-1', 'b-2'])
      assert.ok(
        identity(result.colors.get(a) ?? '', result.colors.get(b) ?? '') >= gap - 0.003,
        'distant prominent palettes consumed their reserved identity gap',
      )
})

test('family regions survive arbitrary sRGB anchors, including gamut edges and achromatic seeds', () => {
  const entries = [
    entry('family', null),
    entry('a', 'family'),
    entry('b', 'family'),
    entry('hidden', 'family'),
  ]
  for (const anchor of ['#000000', '#ffffff', '#0000ff', '#ff0000', '#00ff00']) {
    const input = inputFor(entries, ['a', 'b'])
    const configuration = { ...DEFAULT_COLOR_CONFIGURATION, anchors: { family: anchor } }
    const hierarchy = buildLanguageHierarchy(entries)
    const reference = buildSemanticPalette(hierarchy, input.topology, [], configuration.anchors)
    const result = optimizeColors({ ...input, reference, configuration })
    const region = result.regions.get('family')
    assert.ok(region)
    assert.equal(result.colors.get('family'), anchor)
    for (const id of ['a', 'b', 'hidden'])
      assert.ok(distance(result.colors.get(id), anchor) <= region.radius + 0.002)
  }
})

test('a close competitor removes space in its direction while leaving orthogonal detail available', () => {
  const anchors = [gamutSample(0.65, 0.1, 0), gamutSample(0.65, 0.16, 0)]
  const families: ColorFamily[] = anchors.map((reference, i) => ({
    id: String(i),
    reference,
    locked: true,
    automatic: 1,
    fixed: [],
    prominence: 1,
    prominent: true,
    coverage: 0.05,
    demand: 1,
  }))
  const links = buildFamilyLinks(families, () => 1)
  const spaces = familyColorSpaces(families, links, anchors, 0.1)
  const anchor = anchors[0]
  const other = anchors[1]
  const space = spaces[0]
  assert.ok(anchor && other && space)
  const orthogonal = familyShade(anchor, [0, 0.6, 0], space.radius, space.planes)
  const toward = familyShade(anchor, [0, 0, 1], space.radius, space.planes)
  assert.ok(colorDistance(anchor, orthogonal) > 0.035)
  assert.ok(colorDistance(anchor, toward) < 0.01)
  for (const h of [-1, 1])
    for (const l of [-1, 1])
      for (const c of [-1, 1]) {
        const color = familyShade(anchor, [h, l, c], space.radius, space.planes)
        assert.ok(colorDistance(anchor, color) <= space.radius + 0.002)
        for (const plane of space.planes)
          assert.ok(
            (color.l - anchor.l) * plane.l +
              (color.a - anchor.a) * plane.a +
              (color.b - anchor.b) * plane.b <=
              plane.limit + 0.0016 * plane.distance,
          )
      }
})

test('many independent exact colors remain fixed obstacles without exhausting candidate tables', () => {
  const ids = Array.from({ length: 512 }, (_, i) => `manual-${i}`)
  const input = inputFor(
    [entry('family', null), ...ids.map((id) => entry(id, 'family')), entry('automatic', null)],
    [...ids, 'automatic'],
  )
  const configuration = {
    ...DEFAULT_COLOR_CONFIGURATION,
    overrides: Object.fromEntries(
      ids.map((id, i) => [id, `#${(i * 32003).toString(16).padStart(6, '0')}`]),
    ),
  }
  const result = optimizeColors({ ...input, configuration })
  assert.equal(result.languageCount, ids.length + 1)
  for (const value of Object.values(result.after)) assert.ok(Number.isFinite(value))
  assert.match(result.colors.get('automatic') ?? '', /^#[a-f0-9]{6}$/)
})
