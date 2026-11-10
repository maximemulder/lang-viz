import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { featureVariantIds, visibleVariantIds } from '../src/features/map/inspection.ts'
import {
  blendLayerId,
  fallbackLayerId,
  solidLayerId,
  stripeLayerId,
} from '../src/features/map/overlap/layerIds.ts'

test('inspection reads explicit memberships, independent of pattern naming and contributor delimiters', () => {
  assert.deepEqual(featureVariantIds({ variant_id: 'original' }), ['original'])
  assert.deepEqual(featureVariantIds({ variantId: 'solid' }), ['solid'])
  assert.deepEqual(featureVariantIds({ variantIds: '["A|B","C"]', pattern: 'arbitrary' }), [
    'A|B',
    'C',
  ])
  for (const properties of [
    {},
    { variantIds: 'invalid' },
    { variantIds: '{}' },
    { variantIds: '[1]' },
  ])
    assert.deepEqual(featureVariantIds(properties), [])
})

test('inspection follows grouped blending coverage, including all overlapping selections', () => {
  const active = blendLayerId(0, 0)
  const stale = blendLayerId(1, 0)
  const map = {
    getLayersOrder: () => [active, stale],
    getLayer: (id: string) => [active, stale, 'selected-language-areas'].includes(id),
    getPaintProperty: (id: string) => (id === active ? 1 : 0),
    queryRenderedFeatures: (_point: unknown, { layers }: { layers: string[] }) => {
      assert.deepEqual(layers, [active])
      return [{ properties: { variantIds: '["descendants:family","child"]' } }]
    },
  } as unknown as MapLibreMap
  assert.deepEqual(visibleVariantIds(map, [0, 0]), ['child', 'descendants:family'])
})

test('source hits expand group memberships before refinement; coverage hits keep their exact owners', () => {
  let source = true
  const map = {
    getLayer: (id: string) => id === (source ? fallbackLayerId(0) : solidLayerId(0)),
    getPaintProperty: () => 1,
    queryRenderedFeatures: () =>
      source
        ? [{ properties: { variant_id: 'parent' } }, { properties: { variant_id: 'child' } }]
        : [{ properties: { variantId: 'parent' } }, { properties: { variantId: 'child-copy' } }],
  } as unknown as MapLibreMap
  const groups = { parent: ['parent', 'parent-copy'], child: ['child-copy'] }
  const refinements = { 'child-copy': ['parent-copy'] }
  assert.deepEqual(visibleVariantIds(map, [0, 0], refinements, groups), ['child-copy', 'parent'])
  source = false
  assert.deepEqual(visibleVariantIds(map, [0, 0], refinements, groups), ['child-copy', 'parent'])
})

test('inspection follows active coverage and clipped fallback, ignoring original detail and staging', () => {
  const original = 'selected-language-areas'
  const opacity = new Map([
    [original, 0],
    [solidLayerId(0), 0.82],
    [stripeLayerId(0), 0.82],
    [fallbackLayerId(0), 0.82],
    [stripeLayerId(1), 0],
  ])
  const properties = new Map<string, Record<string, unknown>[]>([
    [original, [{ variant_id: 'wrong-detail' }]],
    [solidLayerId(0), [{ variantId: 'A' }]],
    [stripeLayerId(0), [{ variantIds: '["A","B"]' }, { variantIds: '["A","B"]' }]],
    [fallbackLayerId(0), []],
    [stripeLayerId(1), [{ variantIds: '["obsolete-selection"]' }]],
  ])
  const queries: string[][] = []
  const map = {
    getLayer: (id: string) => opacity.has(id),
    getPaintProperty: (id: string) => opacity.get(id),
    queryRenderedFeatures: (_point: unknown, { layers }: { layers: string[] }) => {
      queries.push(layers)
      return layers.flatMap((id) =>
        (properties.get(id) ?? []).map((properties) => ({ properties })),
      )
    },
  } as unknown as MapLibreMap
  assert.deepEqual(visibleVariantIds(map, [0, 0]), ['A', 'B'])
  assert.deepEqual(queries.at(-1), [solidLayerId(0), stripeLayerId(0), fallbackLayerId(0)])
  properties.set(solidLayerId(0), [])
  properties.set(stripeLayerId(0), [])
  assert.deepEqual(
    visibleVariantIds(map, [0, 0]),
    [],
    'coverage holes cannot pick original polygons',
  )
  properties.set(fallbackLayerId(0), [{ variant_id: 'C' }, { variant_id: 'D' }])
  assert.deepEqual(visibleVariantIds(map, [0, 0]), ['C', 'D'])
  for (const id of [solidLayerId(0), stripeLayerId(0), fallbackLayerId(0)]) opacity.set(id, 0)
  assert.deepEqual(
    visibleVariantIds(map, [0, 0]),
    [],
    'geometry that is not displayed cannot be picked while the first snapshot prepares',
  )
  opacity.clear()
  assert.deepEqual(visibleVariantIds(map, [0, 0]), [], 'unmounted layers are safe')
})
