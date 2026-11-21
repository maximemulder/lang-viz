import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeLanguageLabels, type LanguageLabelAnchor } from '../src/data/languageLabels.ts'
import type { MapArea } from '../src/domain/aggregation.ts'
import type { Language } from '../src/domain/atlas.ts'
import {
  type LabelChoice,
  type LabelLayout,
  languageLabelTree,
  selectLanguageLabels as placeLabels,
} from '../src/features/map/labels/languageLabelSelection.ts'

const catalog = new Map(
  ['family', 'branch', 'one', 'two', 'three'].map((id) => [
    id,
    { id, name: id, level: ['family', 'branch'].includes(id) ? 'family' : 'language' } as Language,
  ]),
)
const profile = {
  schemaVersion: 1,
  archive: 'geometry/test.pmtiles',
  variants: {
    first: {
      path: ['family', 'branch', 'one'],
      anchors: [
        [0, 0, 0.03, 3, [0, 1, 4]],
        [25, 0, 0.01, 2, [1, 2, 5]],
      ],
    },
    second: { path: ['family', 'branch', 'two'], anchors: [[2, 2, 0.02, 3, [0, 1, 4]]] },
  },
  handoffZooms: { family: 2, branch: 4 },
}

function selectLanguageLabels(
  roots: Parameters<typeof placeLabels>[0],
  zoom: number,
  lod: number,
  fits: (language: Language, choice: LabelChoice) => boolean,
  previous: Parameters<typeof placeLabels>[4],
  options: Partial<LabelLayout> = {},
) {
  const hits = new Map<string, Set<string>>()
  const point = options.point ?? (([x, y]: LanguageLabelAnchor) => ({ x, y }))
  const collect = (nodes: typeof roots) => {
    for (const node of nodes.values()) {
      for (const { anchor, owners } of [...node.primary, ...node.overview]) {
        const position = point(anchor)
        if (!position) continue
        const key = [position.x, position.y].join(',')
        const ids = hits.get(key) ?? new Set<string>()
        for (const id of owners) ids.add(id)
        hits.set(key, ids)
      }
      collect(node.children)
    }
  }
  collect(roots)
  const layout: LabelLayout = {
    point,
    project: (language, choice) => {
      if (!fits(language, choice)) return null
      const position = point(choice.anchor)
      if (!position) return null
      const { x, y } = position
      return { x, y, minX: x - 0.5, minY: y - 0.5, maxX: x + 0.5, maxY: y + 0.5 }
    },
    visibleAt: (x, y) => [...(hits.get([Math.round(x), Math.round(y)].join(',')) ?? [])],
    ...options,
  }
  return placeLabels(roots, zoom, lod, layout, previous)
}

test('the asset binds its archive, hierarchy, and LOD support', () => {
  assert.throws(() => decodeLanguageLabels(profile, 'wrong-archive'), /Invalid language labels/)
  assert.throws(
    () => decodeLanguageLabels({ ...profile, handoffZooms: { family: 2 } }, profile.archive),
    /Invalid language labels/,
  )
})

test('the handoff zoom orders overview fallbacks when area names cannot be placed', () => {
  const table = decodeLanguageLabels(profile, profile.archive)
  const tree = languageLabelTree([table], catalog, ['first', 'second'])
  const select = (zoom: number, allowLanguages = true) => [
    ...selectLanguageLabels(
      tree,
      zoom,
      1,
      ({ level }) => allowLanguages || level === 'family',
      new Map(),
    ).keys(),
  ]
  assert.deepEqual(select(1), ['family'])
  assert.deepEqual(select(2), ['branch'])
  assert.deepEqual(select(4).sort(), ['one', 'two'])
  assert.deepEqual(select(5, false), ['branch'])
})

test('placement uses selected variants and restores the preferred anchor when available', () => {
  const table = decodeLanguageLabels(profile, profile.archive)
  const tree = languageLabelTree([table], catalog, ['first'], { isolatedLanguageId: 'one' })
  const single = languageLabelTree([table], catalog, ['first'])
  assert.equal(selectLanguageLabels(single, 1, 1, () => true, new Map()).size, 0)
  const local = selectLanguageLabels(tree, 6, 1, (_, { anchor }) => anchor[0] === 25, new Map())
  assert.equal(local.get('one')?.choice.anchor[0], 25)
  assert.equal(local.size, 1)
  assert.equal(selectLanguageLabels(tree, 6, 1, () => true, local).get('one')?.choice.anchor[0], 0)
  assert.equal(selectLanguageLabels(tree, 6, 0, () => true, local).get('one')?.choice.anchor[0], 0)
})

test('a language shared by two profiles keeps one placement across branch paths', () => {
  const original = decodeLanguageLabels(profile, profile.archive)
  const alternate = decodeLanguageLabels(
    {
      ...profile,
      variants: { third: { path: ['family', 'one'], anchors: [[45, 0, 0.1, 3, [0, 1]]] } },
      handoffZooms: { family: 3 },
    },
    profile.archive,
  )
  const tree = languageLabelTree([original, alternate], catalog, ['first', 'third'])
  const fitsFirst = selectLanguageLabels(
    tree,
    6,
    1,
    (_, choice) => choice.variantId === 'first',
    new Map(),
  )
  const bothFit = selectLanguageLabels(tree, 6, 1, () => true, fitsFirst)
  assert.equal(bothFit.size, 1)
  assert.equal(bothFit.get('one')?.choice.variantId, 'third')
})

test('a family belongs to a local cluster with multiple unresolved languages', () => {
  const table = decodeLanguageLabels(
    {
      ...profile,
      variants: {
        remote: { path: ['family', 'one'], anchors: [[-124, 65, 0.07, 3, [0, 2]]] },
        east: { path: ['family', 'two'], anchors: [[179, 20, 0.01, 3, [0, 2]]] },
        west: { path: ['family', 'three'], anchors: [[-177, 21, 0.02, 3, [0, 2]]] },
      },
      handoffZooms: { family: 2 },
    },
    profile.archive,
  )
  const tree = languageLabelTree([table], catalog, ['remote', 'east', 'west'])
  const options = {
    point: ([lng, y]: LanguageLabelAnchor) => ({ x: (lng < 0 ? lng + 360 : lng) * 5, y }),
  }
  const remote = selectLanguageLabels(
    tree,
    1,
    1,
    (_, choice) => choice.variantId === 'remote',
    new Map(),
    options,
  )
  assert.equal(remote.size, 0)
  const world = selectLanguageLabels(tree, 1, 1, () => true, remote, options)
  assert.ok(Math.abs(world.get('family')?.choice.anchor[0] ?? 0) > 170)

  const sparseAndDense = selectLanguageLabels(
    tree,
    3,
    1,
    (language, choice) => language.id === 'family' || choice.variantId === 'remote',
    world,
    options,
  )
  assert.deepEqual([...sparseAndDense.keys()], ['one', 'family'])
  assert.equal(sparseAndDense.get('one')?.overview, false)
  assert.equal(sparseAndDense.get('family')?.overview, true)
})

test('a local overview replaces an area name only when it adds more visible coverage', () => {
  for (const [clearance, expected] of [
    [0.06, ['one']],
    [0.02, ['family']],
  ] as const) {
    const table = decodeLanguageLabels(
      {
        ...profile,
        variants: {
          first: { path: ['family', 'one'], anchors: [[0, 0, clearance, 3, [0, 1]]] },
          second: {
            path: ['family', 'two'],
            anchors: [
              [10, 0, 0.014, 3, [0, 3]],
              [11, 0, 0.014, 3, [0, 3]],
            ],
          },
          third: { path: ['family', 'three'], anchors: [[-10, 0, 0.011, 3, [0, 3]]] },
        },
        handoffZooms: { family: 2 },
      },
      profile.archive,
    )
    const tree = languageLabelTree([table], catalog, ['first', 'second', 'third'])
    const low = selectLanguageLabels(tree, 1, 1, () => true, new Map())
    assert.deepEqual([...low.keys()], expected)
    const high = selectLanguageLabels(tree, 3, 1, () => true, low)
    assert.deepEqual([...high.keys()].sort(), ['one', 'three', 'two'])

    // Two polygon anchors for the same language cannot make up for hidden coverage.
    const refined = selectLanguageLabels(tree, 1, 1, () => true, low, {
      visibleAt: (x) => (x === 0 ? ['first'] : x > 0 ? ['second'] : []),
    })
    assert.deepEqual([...refined.keys()], ['one'])
  }
})

test('a distant name and a family overview use distinct drawn areas', () => {
  const table = decodeLanguageLabels(
    {
      ...profile,
      variants: {
        first: {
          path: ['family', 'one'],
          anchors: [
            [0, 0, 0.06, 3, [0, 1]],
            [150, 0, 0.04, 3, [0, 3]],
          ],
        },
        second: { path: ['family', 'two'], anchors: [[155, 0, 0.01, 3, [0, 3]]] },
        third: { path: ['family', 'three'], anchors: [[160, 0, 0.01, 3, [0, 3]]] },
      },
      handoffZooms: { family: 2 },
    },
    profile.archive,
  )
  const tree = languageLabelTree([table], catalog, ['first', 'second', 'third'])
  const labels = selectLanguageLabels(tree, 1, 1, () => true, new Map())
  assert.equal(labels.get('one')?.variantId, 'first')
  assert.equal(labels.get('family')?.variantId, 'second')
})

test('nearby ancestor overviews follow the nominal handoff even with separate unnamed members', () => {
  const table = decodeLanguageLabels(
    {
      ...profile,
      variants: {
        ...profile.variants,
        third: { path: ['family', 'three'], anchors: [[16, 0, 0.02, 3, [0, 4]]] },
        fourth: { path: ['family', 'four'], anchors: [[18, 0, 0.02, 3, [0, 4]]] },
      },
    },
    profile.archive,
  )
  const languages = new Map(catalog).set('four', {
    ...catalog.get('three'),
    id: 'four',
  } as Language)
  const tree = languageLabelTree([table], languages, ['first', 'second', 'third', 'fourth'])
  const low = selectLanguageLabels(tree, 1, 1, () => true, new Map())
  assert.deepEqual([...low.keys()], ['family'])
  const high = selectLanguageLabels(tree, 2, 1, () => true, low)
  assert.deepEqual([...high.keys()], ['branch'])
})

test('a language favors its central anchor as soon as the label fits there', () => {
  const table = decodeLanguageLabels(
    {
      ...profile,
      variants: {
        first: {
          path: ['one'],
          anchors: [
            [0, 0, 0.01, 3, [5]],
            [8, 0, 0.02, 3, [4]],
          ],
        },
      },
      handoffZooms: {},
    },
    profile.archive,
  )
  const tree = languageLabelTree([table], catalog, ['first'])
  assert.equal(
    selectLanguageLabels(tree, 5, 1, () => true, new Map()).get('one')?.choice.anchor[0],
    0,
  )
  assert.equal(
    selectLanguageLabels(tree, 4, 1, () => true, new Map()).get('one')?.choice.anchor[0],
    8,
  )
})

test('combined anchors are restricted to covered members of the active selection', () => {
  const table = decodeLanguageLabels(
    {
      ...profile,
      schemaVersion: 2,
      variants: {
        ...profile.variants,
        third: { path: ['family', 'three'], anchors: [[40, 0, 0.1, 3, [0, 1]]] },
      },
      overviews: {
        family: [
          [[12, 0, 0.06, 3, [0]], ['third']],
          [
            [3, 0, 0.03, 3, [0]],
            ['first', 'second'],
          ],
        ],
      },
    },
    profile.archive,
  )
  const tree = languageLabelTree([table], catalog, ['first', 'second'])
  const label = selectLanguageLabels(tree, 1, 1, () => true, new Map()).get('family')
  assert.equal(label?.choice.anchor[0], 3)
  assert.deepEqual(label?.choice.owners, ['first', 'second'])
})

test('a blocked label tries spatial alternatives before making coverage queries', () => {
  const table = decodeLanguageLabels(
    {
      ...profile,
      variants: {
        first: { path: ['one'], anchors: [[0, 0, 0.1, 3, [0]]] },
        second: {
          path: ['two'],
          anchors: [
            [0, 0, 0.1, 3, [0]],
            [5, 0, 0.05, 3, [0]],
          ],
        },
      },
      handoffZooms: {},
    },
    profile.archive,
  )
  const tree = languageLabelTree([table], catalog, ['first', 'second'])
  const probes: number[] = []
  const layout: LabelLayout = {
    point: ([x, y]) => ({ x, y }),
    project: (_, { anchor: [x, y] }) => ({
      x,
      y,
      minX: x - 1,
      minY: y - 1,
      maxX: x + 1,
      maxY: y + 1,
    }),
    visibleAt: (x) => {
      probes.push(x)
      return x === 0 ? ['first', 'second'] : ['second']
    },
  }
  const placed = placeLabels(tree, 1, 1, layout, new Map())
  assert.equal(placed.get('two')?.choice.anchor[0], 5)
  assert.deepEqual(probes, [0, 5])
})

test('an explicitly drawn aggregate is a primary label even outside the compact label path', () => {
  const table = decodeLanguageLabels(profile, profile.archive)
  const language = {
    id: 'aggregate',
    name: 'Aggregate',
    level: 'group',
    parentId: 'family',
  } as Language
  const languages = new Map(catalog).set(language.id, language)
  const area = {
    id: 'drawn-aggregate',
    languageId: language.id,
    mode: 'descendants',
    variants: [{ id: 'first' }, { id: 'second' }],
  } as MapArea
  const tree = languageLabelTree([table], languages, ['first', 'second'], { areas: [area] })
  const labels = selectLanguageLabels(tree, 1, 1, () => true, new Map())
  assert.deepEqual([...labels.keys()], ['aggregate'])
  assert.equal(labels.get('aggregate')?.variantId, 'drawn-aggregate')
  assert.equal(labels.get('aggregate')?.overview, false)

  const isolatedTree = languageLabelTree([table], languages, ['first', 'second'], {
    isolatedLanguageId: language.id,
  })
  const isolated = selectLanguageLabels(isolatedTree, 1, 1, () => true, new Map())
  assert.deepEqual([...isolated.keys()], ['aggregate'])
  assert.equal(isolated.get('aggregate')?.overview, false)
})

test('members removed by the displayed coverage do not justify an overview', () => {
  const table = decodeLanguageLabels(profile, profile.archive)
  const tree = languageLabelTree([table], catalog, ['first', 'second'])
  const labels = selectLanguageLabels(tree, 1, 1, () => true, new Map(), {
    visibleAt: (x) => (x === 0 ? ['first'] : []),
  })
  assert.equal(labels.size, 0)
})

test('subpixel fragments do not turn a single visible language into a family overview', () => {
  const table = decodeLanguageLabels(
    {
      ...profile,
      variants: {
        first: { path: ['family', 'one'], anchors: [[0, 0, 0.03, 3, [0, 1]]] },
        second: { path: ['family', 'two'], anchors: [[2, 2, 0.0001, 3, [0, 8]]] },
      },
      handoffZooms: { family: 2 },
    },
    profile.archive,
  )
  const tree = languageLabelTree([table], catalog, ['first', 'second'])
  assert.equal(selectLanguageLabels(tree, 0.5, 1, () => true, new Map()).size, 0)
  const labels = selectLanguageLabels(tree, 2, 1, () => true, new Map())
  assert.deepEqual([...labels.keys()], ['one'])
})
