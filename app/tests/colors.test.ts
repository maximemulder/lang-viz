import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { converter } from 'culori'
import type { AtlasData, Language } from '../src/domain/atlas.ts'
import {
  aggregateColor,
  buildColorNeighborhoods,
  buildColorTopology,
  buildSemanticPalette,
  DEFAULT_COLOR_CONFIGURATION,
  normalizeColor,
  resolveLanguageColors,
  topmostColorRoots,
  validateColorConfiguration,
} from '../src/domain/colors.ts'
import {
  assignFamilyAnchors,
  buildFamilyLinks,
  type ColorFamily,
  colorDistance,
  colorSample,
  familyCandidates,
} from '../src/domain/familyColors.ts'
import { buildLanguageHierarchy } from '../src/domain/hierarchy.ts'

const entry = (
  id: string,
  parentId: string | null,
  latitude: number | null = 10,
  longitude: number | null = 10,
): Language => ({
  id,
  classification: { kind: 'glottolog', glottocode: id },
  name: id,
  level: 'language',
  parentId,
  parentLanguageId: null,
  familyId: null,
  familyName: null,
  alternativeNames: [],
  iso6393: null,
  macroarea: null,
  countries: [],
  latitude,
  longitude,
  geometryVariantIds: [`source:${id}`],
})
const languages = [
  entry('family', null),
  entry('a', 'family'),
  entry('a1', 'a'),
  entry('a2', 'a'),
  entry('b', 'family'),
  entry('b1', 'b'),
  entry('b2', 'b'),
  entry('other', null),
  entry('other1', 'other'),
  entry('isolate', null, null, null),
]
const hierarchy = buildLanguageHierarchy(languages)
const topology = buildColorTopology(hierarchy)
const semantic = buildSemanticPalette(hierarchy, topology)
const lab = converter('oklab')
const distance = (a: string, b: string) => {
  const x = lab(semantic.colors.get(a))
  const y = lab(semantic.colors.get(b))
  assert.ok(x && y)
  return Math.hypot(x.l - y.l, x.a - y.a, x.b - y.b)
}

const colorFamily = (id: string, color: string, prominence = 1): ColorFamily => ({
  id,
  reference: colorSample(color),
  locked: false,
  automatic: 1,
  fixed: [],
  prominence,
  prominent: true,
  coverage: prominence ** 2 * 0.1,
  demand: 2,
})

test('all original anchors are available at the highest aesthetic preference', () => {
  // Freeze the palette from before the expanded-gamut refactor, including its
  // olive greens, roses and violets.
  const preferred = [
    '#d15264',
    '#ce5d1e',
    '#af7600',
    '#8f8600',
    '#559724',
    '#009b70',
    '#009696',
    '#0091b7',
    '#3683e0',
    '#7c71de',
    '#a661c4',
    '#c35599',
    '#fb7887',
    '#f8834a',
    '#df9700',
    '#b7ac00',
    '#7abd4f',
    '#00c58f',
    '#00bfc0',
    '#00b9e9',
    '#67aaff',
    '#9f99ff',
    '#cd86ec',
    '#ec7abf',
  ]
  const candidates = new Set(familyCandidates.map(({ hex }) => hex))
  for (const color of preferred)
    assert.ok(candidates.has(color), `Missing preferred anchor: ${color}`)
  const families = preferred.map((color, i) => colorFamily(`preferred-${i}`, color))
  assert.deepEqual(
    assignFamilyAnchors(families, []).map(({ hex }) => hex),
    preferred,
    'an uncontested original anchor was penalized relative to another candidate',
  )
})

test('uncontested families prefer restrained anchors while exact custom anchors stay fixed', () => {
  const family = colorFamily('family', '#574df5')
  const large = assignFamilyAnchors([family], [])[0]
  assert.ok(large)
  assert.ok(
    Math.hypot(large.a, large.b) < 0.165,
    'an uncontested footprint retained a vivid anchor',
  )
  assert.equal(
    assignFamilyAnchors([{ ...family, locked: true }], [])[0]?.hex,
    family.reference.hex,
    'an editorial preference replaced an explicit anchor',
  )
})

test('crowded comparisons retain pink reserve anchors with stronger restraint on large footprints', () => {
  const fixed = ['#008700', '#d6c900', '#ff8523', '#fd2e1c', '#125cf7', '#00e4b9', '#7a3dea'].map(
    (color, i) => ({ ...colorFamily(`fixed-${i}`, color), locked: true }),
  )
  const families = [colorFamily('family', '#287cb8'), ...fixed]
  const links = buildFamilyLinks(families, () => 1)
  const assigned = assignFamilyAnchors(families, links)
  const anchor = assigned[0]
  assert.ok(anchor)
  assert.ok(anchor.a > 0 && anchor.b < 0, 'the occupied neighborhood lost its pink alternative')
  assert.ok(Math.hypot(anchor.a, anchor.b) > 0.15)
  fixed.forEach((family, i) => {
    assert.equal(assigned[i + 1]?.hex, family.reference.hex)
    assert.ok(colorDistance(anchor, family.reference) > 0.2)
  })
  // Hold separation pressure fixed: area should affect the preference even
  // when the crowded neighborhood still requires a pink reserve color.
  const small = assignFamilyAnchors(
    families.map((family, i) => (i ? family : { ...family, prominence: 0.01, coverage: 0.00001 })),
    links,
  )[0]
  assert.ok(small)
  assert.ok(Math.hypot(anchor.a, anchor.b) < Math.hypot(small.a, small.b))
})

test('semantic colors cluster recent branches and distinguish neighboring family roots', () => {
  assert.equal(semantic.colors.size, languages.length)
  assert.ok(distance('a1', 'a2') < distance('a1', 'b1'))
  assert.ok(distance('a1', 'b1') < distance('family', 'other'))
  for (const color of semantic.colors.values()) assert.match(color, /^#[a-f0-9]{6}$/)
  assert.equal(semantic.rootById.get('a1'), 'family')
  assert.equal(semantic.rootById.get('other1'), 'other')
})

test('catalog ordering, duplicated comparison roots, and unary classification steps do not shuffle colors', () => {
  const reversed = buildLanguageHierarchy([...languages].reverse())
  assert.deepEqual(
    buildSemanticPalette(reversed, buildColorTopology(reversed)).colors,
    semantic.colors,
  )
  const withUnary = buildLanguageHierarchy([
    ...languages.map((language) =>
      language.id === 'a' ? { ...language, parentId: 'unary' } : language,
    ),
    entry('unary', 'family'),
  ])
  const changed = buildSemanticPalette(withUnary, buildColorTopology(withUnary))
  for (const { id } of languages) assert.equal(changed.colors.get(id), semantic.colors.get(id))
  assert.deepEqual(
    buildSemanticPalette(hierarchy, topology, ['a', 'b', 'a']).colors,
    buildSemanticPalette(hierarchy, topology, ['b', 'a']).colors,
  )
})

test('nested comparison roots restart palettes and preserve global anchors', () => {
  const focused = buildSemanticPalette(hierarchy, topology, ['a'])
  assert.equal(focused.rootById.get('a1'), 'a')
  assert.equal(focused.rootById.get('b1'), 'family')
  assert.notEqual(focused.anchors.get('a'), focused.anchors.get('family'))
  for (const id of topology.roots) assert.equal(focused.anchors.get(id), semantic.anchors.get(id))
  assert.deepEqual(topmostColorRoots(['a1', 'family', 'a', 'other1', 'unknown'], topology), [
    'family',
    'other1',
  ])
})

test('anchors guide descendants; exact overrides affect only one languoid in either strategy', () => {
  const anchored = buildSemanticPalette(hierarchy, topology, [], { a: 'rebeccapurple' })
  assert.equal(anchored.colors.get('a'), '#663399')
  assert.equal(anchored.rootById.get('a1'), 'a')
  assert.notEqual(anchored.colors.get('a1'), '#663399')
  assert.equal(anchored.colors.get('b1'), semantic.colors.get('b1'))
  const data = {
    languages,
    variantById: new Map([['source:a', { color: '#123456' }]]),
  } as unknown as AtlasData
  for (const strategy of ['categorical', 'semantic'] as const) {
    const config = { ...DEFAULT_COLOR_CONFIGURATION, strategy }
    const initial = resolveLanguageColors(data, config, semantic)
    const overridden = resolveLanguageColors(
      data,
      { ...config, overrides: { a: '#F00' } },
      semantic,
    )
    assert.equal(overridden.get('a'), '#ff0000')
    for (const { id } of languages)
      if (id !== 'a') assert.equal(overridden.get(id), initial.get(id))
    if (strategy === 'categorical') {
      assert.equal(initial.get('a'), '#123456')
      assert.equal(initial.get('a1'), aggregateColor('a1'))
    }
  }
})

test('color validation normalizes opaque CSS and gamut maps; rejects invalid and transparent input', () => {
  assert.equal(normalizeColor('#F00'), '#ff0000')
  for (const color of [
    '#0000ff',
    '#00ff00',
    '#ff0000',
    '#ffffff',
    '#000000',
    '#00ffff',
    '#ff00ff',
    '#ffff00',
  ])
    assert.equal(normalizeColor(color), color)
  assert.equal(normalizeColor('rgb(255 0 0)'), '#ff0000')
  assert.match(normalizeColor('oklch(0.7 0.5 30)'), /^#[a-f0-9]{6}$/)
  for (const color of ['nonsense', 'transparent', '#1234', 'rgb(255 0 0 / 0.5)']) {
    assert.throws(() => normalizeColor(color), /opaque color/)
  }
  assert.deepEqual(
    validateColorConfiguration({
      ...DEFAULT_COLOR_CONFIGURATION,
      rootIds: ['a', 'a'],
      overrides: { a: '#F00' },
    }).overrides,
    { a: '#ff0000' },
  )
})

test('geographic neighborhoods use distributed descendants and wrap across the date line', () => {
  const entries = [
    entry('a', null, null, null),
    entry('a-east', 'a', 0, 179),
    entry('a-west', 'a', 0, -70),
    entry('b', null, 0, -179),
    entry('c', null, 0, -72),
    entry('d', null, 0, 65),
    entry('missing', null, null, null),
  ]
  const graph = buildColorNeighborhoods(
    buildLanguageHierarchy(entries),
    new Map(entries.map((language) => [language.id, language.parentId ?? language.id])),
  )
  assert.ok(graph.get('a')?.has('b'))
  assert.ok(graph.get('b')?.has('a'))
  assert.ok(graph.get('a')?.has('c'))
  assert.ok(!graph.get('a')?.has('d'))
  assert.equal(graph.get('missing'), undefined)
})

test('unary descendants inherit exact seeds at the edges of the sRGB gamut', () => {
  const hierarchy = buildLanguageHierarchy([
    entry('root', null),
    entry('child', 'root'),
    entry('grandchild', 'child'),
  ])
  const topology = buildColorTopology(hierarchy)
  for (const anchor of ['#ff0000', '#0000ff', '#00ff00', '#000000', '#ffffff']) {
    const palette = buildSemanticPalette(hierarchy, topology, [], { root: anchor })
    for (const id of ['root', 'child', 'grandchild']) assert.equal(palette.colors.get(id), anchor)
  }
})

test('a custom neighborhood provider can separate roots without catalog coordinates', () => {
  const h = buildLanguageHierarchy([entry('a', null, null, null), entry('y', null, null, null)])
  const t = buildColorTopology(h)
  const palette = buildSemanticPalette(h, t, [], {}, (owners) => {
    assert.equal(owners.get('a'), 'a')
    return new Map([
      ['a', new Set(['y'])],
      ['y', new Set(['a'])],
    ])
  })
  assert.notEqual(palette.colors.get('a'), palette.colors.get('y'))
})

test('empty, orphaned, cyclic, very deep and wide classifications produce bounded valid palettes', () => {
  for (const entries of [
    [],
    [entry('a', 'b'), entry('b', 'a'), entry('orphan', 'missing')],
    Array.from({ length: 12000 }, (_, i) => entry(String(i), i ? String(i - 1) : null)),
    [entry('root', null), ...Array.from({ length: 1000 }, (_, i) => entry(String(i), 'root'))],
  ]) {
    const h = buildLanguageHierarchy(entries)
    const palette = buildSemanticPalette(h, buildColorTopology(h))
    assert.equal(palette.colors.size, entries.length)
    for (const color of palette.colors.values()) assert.match(color, /^#[a-f0-9]{6}$/)
  }
})

test('real catalog palettes cover all languoids and retain variation in deep Sinitic branches', () => {
  const entries: Language[] = JSON.parse(
    readFileSync(new URL('../public/data/languages.json', import.meta.url), 'utf8'),
  )
  const h = buildLanguageHierarchy(entries)
  const p = buildSemanticPalette(h, buildColorTopology(h))
  assert.equal(p.colors.size, entries.length)
  const chinese = ['mand1415', 'jiny1235', 'yuec1235', 'ganc1239', 'hakk1236']
  // Overview palettes may quantize very close relatives to the same RGB color;
  // focused view tests require their differences to expand perceptibly.
  assert.ok(new Set(chinese.map((id) => p.colors.get(id))).size > 1)
  for (const id of chinese) assert.equal(p.rootById.get(id), 'sino1245')
  for (const id of ['tibeto-burman', 'shaozhou-tuhua', 'danzhou']) {
    assert.equal(p.rootById.get(`dlac1987china:${id}`), 'sino1245')
  }
})

test('default branches use available lightness when a neighboring anchor crowds their hue', () => {
  const branches = ['a', 'b', 'c']
  const leaves = branches.flatMap((branch) =>
    Array.from({ length: 8 }, (_, i) => entry(`${branch}-${i}`, branch)),
  )
  const h = buildLanguageHierarchy([
    entry('root', null),
    ...branches.map((id) => entry(id, 'root')),
    ...leaves,
    entry('neighbor', null),
  ])
  const p = buildSemanticPalette(h, buildColorTopology(h), [], {
    root: '#997755',
    neighbor: '#aa7755',
  })
  const means = branches.map((branch) => {
    const samples = leaves
      .filter(({ parentId }) => parentId === branch)
      .map(({ id }) => {
        const sample = lab(p.colors.get(id))
        assert.ok(sample)
        return sample
      })
    return samples.reduce((sum, sample) => sum + sample.l, 0) / samples.length
  })
  for (let i = 0; i < means.length; i++)
    for (let j = i + 1; j < means.length; j++)
      assert.ok(
        Math.abs((means[i] ?? 0) - (means[j] ?? 0)) * 0.65 > 0.035,
        'stable defaults flattened broad branches despite available lightness',
      )
})
