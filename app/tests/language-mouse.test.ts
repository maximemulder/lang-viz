import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createStore } from 'jotai/vanilla'
import type { GeometryVariant } from '../src/domain/atlas.ts'
import { pickLanguageVariants } from '../src/features/map/languagePicking.ts'
import { walsActionAtom, walsSessionAtom } from '../src/features/wals/state.ts'
import { isolatedLanguageIdAtom, mapContextOpacityAtom } from '../src/state/mapInteraction.ts'
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
  isolatedId: null,
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
  assert.deepEqual(
    pickLanguageVariants(map() as never, [0, 0], { ...context, isolatedId: 'different' }),
    [],
  )
})
test('highlighted areas take precedence and do not duplicate a language hit', () => {
  assert.deepEqual(
    pickLanguageVariants(map(true) as never, [0, 0], { ...context, matching: true }),
    ['area'],
  )
})
test('isolation and matching emphasis preserve the independent WALS origin', () => {
  const store = createStore()
  assert.equal(store.get(mapContextOpacityAtom), 1)
  store.set(walsActionAtom, { type: 'show-examples', sourceId: 'iri', featureId: '81A' })
  const overlay = store.get(walsSessionAtom).overlay
  assert.equal(store.get(mapContextOpacityAtom), 0.16)
  store.set(isolatedLanguageIdAtom, 'language')
  assert.equal(store.get(mapContextOpacityAtom), 0)
  store.set(isolatedLanguageIdAtom, null)
  assert.equal(store.get(mapContextOpacityAtom), 0.16)
  assert.strictEqual(store.get(walsSessionAtom).overlay, overlay)
  store.set(walsActionAtom, { type: 'clear-overlay' })
  assert.equal(store.get(mapContextOpacityAtom), 1)
})
