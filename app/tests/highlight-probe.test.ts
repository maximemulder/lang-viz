import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { inspectionLineOpacity } from '../src/features/map/geometry/boundaryInspection.ts'
import { geometryDisplay } from '../src/features/map/geometry/display.ts'
import {
  BOUNDARY_LAYER,
  boundaryFilter,
  FALLBACK_BOUNDARY_LAYER,
} from '../src/features/map/geometryBoundaries.ts'
import { highlightBoundaryEvidence } from '../src/features/map/overlap/testing/highlightProbe.ts'

const fixture = () => {
  const groups = [['entry']]
  let filter = boundaryFilter(groups)
  const layerFilters = new Map<string, typeof filter>()
  let opacity = 0.95
  let properties: Record<string, boolean> = { 'l:entry': true, 'r:neighbor': true }
  let coordinates = [
    [0, 0],
    [1, 1],
  ]
  const features = new Set([BOUNDARY_LAYER])
  const queries: string[] = []
  const map = {
    getLayer: (id: string) => ({
      type: 'line',
      source: 'coverage',
      sourceLayer: id.includes('fallback') ? FALLBACK_BOUNDARY_LAYER : BOUNDARY_LAYER,
    }),
    getFilter: (id: string) => layerFilters.get(id) ?? filter,
    getPaintProperty: (_id: string, property: string) => (property === 'line-width' ? 3 : opacity),
    getLayoutProperty: () => undefined,
    querySourceFeatures: (source: string, options: { sourceLayer: string; filter: unknown }) => {
      assert.equal(source, 'coverage')
      assert.deepEqual(options.filter, filter)
      queries.push(options.sourceLayer)
      return features.has(options.sourceLayer)
        ? [
            {
              properties,
              geometry: { type: 'LineString', coordinates },
            },
          ]
        : []
    },
  } as unknown as MapLibreMap
  geometryDisplay(map).highlights.set('inspection', {
    layerId: 'inspection-coverage',
    source: 'coverage',
    groups,
    variants: ['source-a', 'source-b'],
    visible: true,
  })
  return {
    map,
    features,
    queries,
    layerFilters,
    filter: (value: typeof filter) => {
      filter = value
    },
    opacity: (value: number) => {
      opacity = value
    },
    properties: (value: typeof properties) => {
      properties = value
    },
    coordinates: (value: typeof coordinates) => {
      coordinates = value
    },
    evidence: () => highlightBoundaryEvidence(map, 'inspection'),
  }
}

test('highlight evidence requires loaded boundaries, including fallback and every inspected group', () => {
  const f = fixture()
  assert.deepEqual(f.evidence(), { variantIds: ['source-a', 'source-b'], boundaryFeatures: 1 })
  f.features.clear()
  assert.deepEqual(
    f.evidence(),
    { variantIds: [], boundaryFeatures: 0 },
    'registered props are not evidence',
  )
  f.features.add(FALLBACK_BOUNDARY_LAYER)
  assert.deepEqual(f.evidence().variantIds, ['source-a', 'source-b'])
  const highlight = geometryDisplay(f.map).highlights.get('inspection')
  assert.ok(highlight)
  highlight.groups = [['entry'], ['missing']]
  f.filter(boundaryFilter(highlight.groups))
  assert.deepEqual(f.evidence().variantIds, [], 'every requested group needs boundary geometry')
})

test('wrong filters, invisible lines, unrelated memberships and collapsed geometry cannot satisfy highlight checks', () => {
  const f = fixture()
  f.filter(['==', ['literal', true], false])
  assert.deepEqual(f.evidence(), { variantIds: [], boundaryFeatures: 0 })
  assert.equal(f.queries.length, 0, 'a wrong actual layer filter must fail before querying')
  f.filter(boundaryFilter([['entry']]))
  f.layerFilters.set('inspection-coverage-fallback-outline', ['==', ['literal', true], false])
  assert.deepEqual(
    f.evidence(),
    { variantIds: [], boundaryFeatures: 0 },
    'a correct native outline cannot hide an incorrect fallback filter',
  )
  f.layerFilters.clear()
  f.opacity(0)
  assert.deepEqual(f.evidence().variantIds, [])
  f.opacity(0.95)
  f.properties({ 'l:neighbor': true })
  assert.deepEqual(f.evidence().variantIds, [])
  f.properties({ 'l:entry': true, 'r:entry': true })
  assert.deepEqual(f.evidence().variantIds, [], 'a union interior is not its outline')
  f.properties({ 'l:entry': true })
  f.coordinates([
    [1, 1],
    [1, 1],
  ])
  assert.deepEqual(f.evidence(), { variantIds: [], boundaryFeatures: 0 })
})

test('resident inspection evidence requires the actual opacity expression and applied feature state', () => {
  const f = fixture()
  const highlight = geometryDisplay(f.map).highlights.get('inspection')
  assert.ok(highlight)
  highlight.featureState = true
  f.map.getFilter = () => undefined
  f.map.getPaintProperty = (_id, property) =>
    (property === 'line-width' ? 3 : inspectionLineOpacity) as never
  f.map.querySourceFeatures = (_source, options) => {
    assert.deepEqual(options?.filter, boundaryFilter(highlight.groups))
    return [
      {
        id: 'edge',
        properties: { 'l:entry': true },
        geometry: {
          type: 'LineString',
          coordinates: [
            [0, 0],
            [1, 1],
          ],
        },
      },
    ] as never
  }
  f.map.getFeatureState = () => ({})
  assert.deepEqual(f.evidence(), { variantIds: [], boundaryFeatures: 0 })
  f.map.getFeatureState = () => ({ inspected: true })
  assert.deepEqual(f.evidence().variantIds, ['source-a', 'source-b'])
  f.map.getPaintProperty = () => 3 as never
  assert.deepEqual(f.evidence(), { variantIds: [], boundaryFeatures: 0 })
})
