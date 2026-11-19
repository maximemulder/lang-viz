import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createStore } from 'jotai/vanilla'
import type { GeometryVariant } from '../src/domain/atlas.ts'
import { pickLanguageVariants } from '../src/features/map/languagePicking.ts'
import { walsActionAtom, walsSessionAtom } from '../src/features/wals/state.ts'
import { mapContextOpacityAtom } from '../src/state/mapInteraction.ts'
import { catalogLanguage } from './fixtures/wals.ts'

const language = catalogLanguage('language'),
  group = catalogLanguage('family', { level: 'family' })
const data = {
  languageById: new Map([
    [language.id, language],
    [group.id, group],
  ]),
  variantById: new Map([
    ['area', { languageId: language.id } as GeometryVariant],
    ['group-area', { languageId: group.id } as GeometryVariant],
  ]),
}
const context = {
  data,
  areas: [],
  refinements: {},
  memberships: {},
  matching: false,
}
const map = (matching = false) => ({
  getLayer: (id: string) =>
    id === 'language-area-hit-targets' || (matching && id === 'wals-language-areas')
      ? {}
      : undefined,
  getPaintProperty: () => 1,
  getLayersOrder: () => [],
  queryRenderedFeatures: (_point: unknown, options: { layers: string[] }) =>
    options.layers.includes('wals-language-areas')
      ? [{ properties: { variant_id: 'area' } }]
      : [
          { properties: { variant_id: 'group-area' } },
          { properties: { variant_id: 'area' } },
          { properties: { variant_id: 'area' } },
        ],
})
test('hover can discover original language polygons without turning a family or country into a language', () => {
  assert.deepEqual(pickLanguageVariants(map() as never, [0, 0], context), ['area'])
})
test('highlighted areas take precedence and do not duplicate a language hit', () => {
  assert.deepEqual(
    pickLanguageVariants(map(true) as never, [0, 0], { ...context, matching: true }),
    ['area'],
  )
})
test('matching emphasis preserves the independent WALS origin', () => {
  const store = createStore()
  assert.equal(store.get(mapContextOpacityAtom), 1)
  store.set(walsActionAtom, { type: 'show-examples', sourceId: 'iri', featureId: '81A' })
  const overlay = store.get(walsSessionAtom).overlay
  assert.equal(store.get(mapContextOpacityAtom), 0.16)
  assert.strictEqual(store.get(walsSessionAtom).overlay, overlay)
  store.set(walsActionAtom, { type: 'clear-overlay' })
  assert.equal(store.get(mapContextOpacityAtom), 1)
})

test('isolated language picking only uses the retained original language fill', () => {
  const calls: string[][] = []
  const isolated = {
    ...map(),
    getLayer: () => ({}),
    queryRenderedFeatures: (_point: unknown, options: { layers: string[] }) => {
      calls.push(options.layers)
      return [{ properties: { variant_id: 'area' } }]
    },
  }
  assert.deepEqual(
    pickLanguageVariants(isolated as never, [0, 0], {
      ...context,
      isolation: { kind: 'language', id: language.id, label: language.name, color: '#123456' },
    }),
    ['area'],
  )
  assert.deepEqual(calls, [['isolated-language-fill']])
  assert.deepEqual(
    pickLanguageVariants(isolated as never, [0, 0], {
      ...context,
      isolation: {
        kind: 'region',
        id: 'AB',
        label: 'Region',
        color: '#123456',
        featureIds: ['original'],
      },
    }),
    ['area'],
  )
})
