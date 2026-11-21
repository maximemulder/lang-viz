import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeLanguageLabels } from '../src/data/languageLabels.ts'
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
) {
  const layout: LabelLayout = {
    project: (language, choice) => {
      if (!fits(language, choice)) return null
      const [x, y] = choice.anchor
      return { x, y, minX: x - 0.5, minY: y - 0.5, maxX: x + 0.5, maxY: y + 0.5 }
    },
    owner: (_, { variantId }) => variantId,
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

test('a branch hands off on schedule and falls back when its children cannot be placed', () => {
  const table = decodeLanguageLabels(profile, profile.archive)
  const tree = languageLabelTree([table], catalog, ['first', 'second'], false)
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
  assert.deepEqual(select(5).sort(), ['one', 'two'])
  assert.deepEqual(select(5, false), ['branch'])
})

test('placement uses selected variants and restores the preferred anchor when available', () => {
  const table = decodeLanguageLabels(profile, profile.archive)
  const tree = languageLabelTree([table], catalog, ['first'], true)
  const single = languageLabelTree([table], catalog, ['first'], false)
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
  const tree = languageLabelTree([original, alternate], catalog, ['first', 'third'], false)
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

test('a family returns to its cluster when a remote anchor is no longer the only fit', () => {
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
  const tree = languageLabelTree([table], catalog, ['remote', 'east', 'west'], false)
  const local = selectLanguageLabels(
    tree,
    1,
    1,
    (_, choice) => choice.variantId === 'remote',
    new Map(),
  )
  assert.equal(local.get('family')?.choice.variantId, 'remote')
  const world = selectLanguageLabels(tree, 1, 1, () => true, local)
  assert.ok(Math.abs(world.get('family')?.choice.anchor[0] ?? 0) > 170)
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
  const tree = languageLabelTree([table], catalog, ['first'], false)
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
  const tree = languageLabelTree([table], catalog, ['first', 'second'], false)
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
  const tree = languageLabelTree([table], catalog, ['first', 'second'], false)
  const probes: number[] = []
  const layout: LabelLayout = {
    project: (_, { anchor: [x, y] }) => ({
      x,
      y,
      minX: x - 1,
      minY: y - 1,
      maxX: x + 1,
      maxY: y + 1,
    }),
    owner: (_, { variantId, anchor: [x] }) => {
      probes.push(x)
      return variantId
    },
  }
  const placed = placeLabels(tree, 1, 1, layout, new Map())
  assert.equal(placed.get('two')?.choice.anchor[0], 5)
  assert.deepEqual(probes, [0, 5])
})
