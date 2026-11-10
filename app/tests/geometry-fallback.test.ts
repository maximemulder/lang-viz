import assert from 'node:assert/strict'
import { test } from 'node:test'
import { VectorTile } from '@mapbox/vector-tile'
import { fromVectorTileJs, GeoJSONWrapper } from '@maplibre/vt-pbf'
import { PbfReader } from 'pbf'
import { fallbackGeometry } from '../src/features/map/geometry/fallbackGeometry.ts'
import { GeometryTileStore } from '../src/features/map/geometry/tileStore.ts'
import { BOUNDARY_LAYER, FALLBACK_BOUNDARY_LAYER } from '../src/features/map/geometryBoundaries.ts'
import {
  COVERAGE_LAYER,
  combineTileLayers,
  deliveryTile,
  encodeCoverageTile,
} from '../src/features/map/overlap/delivery.ts'

const layer = new GeoJSONWrapper(
  [
    {
      type: 3,
      tags: { variant_id: 'a' },
      geometry: [
        [
          [100, 100],
          [1000, 100],
          [1000, 1000],
          [100, 1000],
          [100, 100],
        ],
      ],
    },
    {
      type: 3,
      tags: { variant_id: 'unselected' },
      geometry: [
        [
          [2000, 100],
          [3000, 100],
          [3000, 1000],
          [2000, 1000],
          [2000, 100],
        ],
      ],
    },
  ],
  { extent: 4096, version: 2 },
)
layer.name = 'areas'
const bytes = fromVectorTileJs({ layers: { areas: layer } })

test('fallback parent delivery uses committed native LOD, selected geometry and matching boundaries', async () => {
  const reads: number[][] = []
  const store = new GeometryTileStore(() => ({
    getZxy: async (z, x, y) => {
      reads.push([z, x, y])
      return { data: bytes.slice().buffer }
    },
  }))
  const covered = { z: 2, x: 0, y: 0 }
  const missing = { z: 2, x: 1, y: 0 }
  const config = {
    tiles: [covered, missing],
    sourceLayer: 'areas',
    selection: { variantIds: ['a'], variantGroups: { a: ['entry'] } },
  }
  const target = { z: 1, x: 0, y: 0 }
  const data = await fallbackGeometry(
    store,
    'https://atlas.test/areas.pmtiles',
    target,
    [covered],
    config,
    new AbortController().signal,
  )
  assert.deepEqual(reads, [[2, 1, 0]])
  const tile = new VectorTile(new PbfReader(data))
  const fill = tile.layers.areas
  const boundary = tile.layers[FALLBACK_BOUNDARY_LAYER]
  assert.ok(fill && boundary)
  assert.equal(fill.length, 1)
  assert.equal(fill.feature(0).properties.variant_id, 'a')
  const points = fill
    .feature(0)
    .loadGeometry()
    .flat()
    .map(({ x, y }) => `${x},${y}`)
  for (let i = 0; i < boundary.length; i++) {
    const feature = boundary.feature(i)
    assert.ok(feature.properties['l:entry'] || feature.properties['r:entry'])
    for (const point of feature.loadGeometry().flat())
      assert.ok(points.includes(`${point.x},${point.y}`))
  }
  assert.equal(
    await fallbackGeometry(
      store,
      'https://atlas.test/areas.pmtiles',
      target,
      [covered],
      config,
      new AbortController().signal,
    ),
    data,
  )
  assert.equal(
    (
      await fallbackGeometry(
        store,
        'https://atlas.test/areas.pmtiles',
        { z: 1, x: 1, y: 0 },
        [],
        config,
        new AbortController().signal,
      )
    ).length,
    0,
  )
  assert.deepEqual(reads, [[2, 1, 0]])
  await assert.rejects(
    fallbackGeometry(
      store,
      'https://atlas.test/areas.pmtiles',
      target,
      [],
      config,
      AbortSignal.abort(),
    ),
    { name: 'AbortError' },
  )
})

test('mixed composed/fallback parents preserve natural borders without outlining their tile seam', async () => {
  const ring: [number, number][] = [
    [0, 100],
    [8192, 100],
    [8192, 1000],
    [0, 1000],
    [0, 100],
  ]
  const source = new GeoJSONWrapper([{ type: 3, tags: { variant_id: 'a' }, geometry: [ring] }], {
    extent: 8192,
    version: 2,
  })
  source.name = 'areas'
  const bytes = fromVectorTileJs({ layers: { areas: source } })
  const store = new GeometryTileStore(() => ({
    getZxy: async () => ({ data: bytes.slice().buffer }),
  }))
  const composed = { z: 1, x: 0, y: 0 }
  const fallback = { z: 1, x: 1, y: 0 }
  const target = { z: 0, x: 0, y: 0 }
  const tile = encodeCoverageTile({
    tile: composed,
    extent: 8192,
    vertices: 5,
    features: [
      {
        type: 'Feature',
        properties: { pattern: 'p', variantIds: ['entry'] },
        geometry: { type: 'MultiPolygon', coordinates: [[ring]] },
      },
    ],
  })
  const fallbackBytes = await fallbackGeometry(
    store,
    'https://atlas.test/areas.pmtiles',
    target,
    [composed],
    {
      tiles: [composed, fallback],
      sourceLayer: 'areas',
      selection: { variantIds: ['a'], variantGroups: { a: ['entry'] } },
    },
    new AbortController().signal,
  )
  for (const buffered of [false, true]) {
    const parent = new VectorTile(
      new PbfReader(
        combineTileLayers(
          deliveryTile(new Map([['1/0/0', tile]]), target, buffered),
          fallbackBytes,
        ),
      ),
    )
    assert.equal(parent.layers[COVERAGE_LAYER]?.length, 1)
    assert.equal(parent.layers.areas?.length, 1)
    const segments = []
    for (const name of [BOUNDARY_LAYER, FALLBACK_BOUNDARY_LAYER]) {
      const layer = parent.layers[name]
      assert.ok(layer?.length)
      for (let i = 0; i < layer.length; i++) {
        const feature = layer.feature(i)
        assert.ok(feature.properties['l:entry'] || feature.properties['r:entry'])
        for (const line of feature.loadGeometry()) {
          assert.ok(
            line.every((p) => p.y === 50) || line.every((p) => p.y === 500),
            'the composed/fallback seam at x=4096 must not be outlined',
          )
          segments.push(...line.slice(1).map((p, i) => [line[i]?.x, p.x]))
        }
      }
    }
    assert.ok(segments.some(([a, b]) => Math.min(a ?? 0, b ?? 0) === 0))
    assert.ok(segments.some(([a, b]) => Math.max(a ?? 0, b ?? 0) === 8192))
  }
})
