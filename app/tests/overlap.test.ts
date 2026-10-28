import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { classifyRings, VectorTile } from '@mapbox/vector-tile'
import { type Feature, fromVectorTileJs, GeoJSONWrapper } from '@maplibre/vt-pbf'
import { PbfReader } from 'pbf'
import { FileSource, PMTiles } from 'pmtiles'
import { OverlapComputer } from '../src/features/map/overlap/compute.ts'
import {
  COVERAGE_LAYER,
  deliveryTile,
  encodeCoverageTile,
  tileKey,
} from '../src/features/map/overlap/delivery.ts'
import {
  loadCoveragePartition,
  type MultiPolygon,
  OverlapBudgetError,
  type Polygon,
} from '../src/features/map/overlap/geometry.ts'
import {
  checkPatternBudget,
  MAX_PATTERN_PIXELS,
  OverlapPatternError,
  patternPixels,
  patternSize,
  stripeImage,
} from '../src/features/map/overlap/patterns.ts'
import {
  coverageTilesKey,
  retainCoverageTiles,
  tilePositionToLngLat,
  tilesForBounds,
} from '../src/features/map/overlap/tiles.ts'
import type { OverlapMetrics } from '../src/features/map/overlap/types.ts'

const partitionCoverage = await loadCoveragePartition()

const box = (left: number, bottom: number, right: number, top: number): MultiPolygon => [
  [
    [
      [left, bottom],
      [right, bottom],
      [right, top],
      [left, top],
      [left, bottom],
    ],
  ],
]

const area = (geometry: MultiPolygon) =>
  geometry.reduce(
    (sum, polygon) =>
      sum +
      polygon.reduce((total, ring, index) => {
        let signed = 0
        for (let i = 1; i < ring.length; i++) {
          const a = ring[i - 1]
          const b = ring[i]
          if (a && b) signed += a[0] * b[1] - b[0] * a[1]
        }
        return total + (index === 0 ? 1 : -1) * Math.abs(signed / 2)
      }, 0),
    0,
  )

test('three-way overlaps are partitioned once with complete memberships', () => {
  const inputs = [
    { id: 'A', geometry: box(0, 0, 8, 8) },
    { id: 'B', geometry: box(4, 0, 12, 8) },
    { id: 'C', geometry: box(6, 0, 10, 8) },
  ]
  const regions = partitionCoverage(inputs, 16)
  const areas = new Map<string, number>()
  for (const region of regions) {
    const key = region.members.join(',')
    areas.set(key, (areas.get(key) ?? 0) + area(region.geometry))
  }
  assert.deepEqual(Object.fromEntries([...areas].sort()), { 'A,B': 16, 'A,B,C': 16, 'B,C': 16 })
  for (let a = 0; a < regions.length; a++) {
    for (let b = a + 1; b < regions.length; b++) {
      const left = regions[a]
      const right = regions[b]
      assert.ok(left && right)
      // These box inputs partition into rectangles; their bounds must have
      // disjoint interiors, independently of the Boolean geometry engine.
      assert.ok(
        left.maxX <= right.minX ||
          right.maxX <= left.minX ||
          left.maxY <= right.minY ||
          right.maxY <= left.minY,
      )
    }
  }
  assert.deepEqual(partitionCoverage([...inputs].reverse(), 16), regions)
})

test('holes stay unfilled and touching edges are not overlaps', () => {
  const outer = box(0, 0, 10, 10)[0]
  const hole = box(3, 3, 7, 7)[0]?.[0]
  assert.ok(outer && hole)
  const donut: Polygon = [...outer, [...hole].reverse()]
  assert.equal(
    partitionCoverage(
      [
        { id: 'A', geometry: [donut] },
        { id: 'B', geometry: box(3, 3, 7, 7) },
      ],
      16,
    ).length,
    0,
  )
  assert.equal(
    partitionCoverage(
      [
        { id: 'A', geometry: box(0, 0, 5, 5) },
        { id: 'B', geometry: box(5, 0, 10, 5) },
      ],
      16,
    ).length,
    0,
  )
  const shared = partitionCoverage(
    [
      { id: 'A', geometry: [donut] },
      { id: 'B', geometry: box(0, 0, 10, 10) },
    ],
    16,
  )
  assert.equal(
    shared.reduce((sum, region) => sum + area(region.geometry), 0),
    84,
  )
})

test('complete coverage retains single-language faces without double covering overlaps', () => {
  const regions = partitionCoverage(
    [
      { id: 'A', geometry: box(0, 0, 8, 8) },
      { id: 'B', geometry: box(4, 0, 12, 8) },
    ],
    16,
    { includeSingles: true },
  )
  const areas = new Map(regions.map((region) => [region.members.join(','), area(region.geometry)]))
  assert.deepEqual(Object.fromEntries([...areas].sort()), { A: 32, 'A,B': 32, B: 32 })
  assert.equal(
    regions.reduce((sum, region) => sum + area(region.geometry), 0),
    96,
  )
})

test('duplicate fragments of a language do not produce self-overlap', () => {
  const regions = partitionCoverage(
    [
      { id: 'A', geometry: box(-5, -5, 8, 8) },
      { id: 'A', geometry: box(0, 0, 8, 8) },
      { id: 'B', geometry: box(4, 4, 15, 15) },
    ],
    10,
  )
  assert.equal(
    regions.reduce((sum, region) => sum + area(region.geometry), 0),
    16,
  )
  assert.ok(regions.every((region) => region.members.join(',') === 'A,B'))
  assert.ok(
    regions.every(
      (region) => region.minX >= 0 && region.minY >= 0 && region.maxX <= 10 && region.maxY <= 10,
    ),
  )
  assert.equal(
    partitionCoverage(
      [
        { id: 'A', geometry: box(0, 0, 8, 8) },
        { id: 'A', geometry: box(0, 0, 8, 8) },
      ],
      10,
    ).length,
    0,
  )
})

test('geometry budgets stop expensive jobs explicitly', () => {
  assert.throws(
    () =>
      partitionCoverage(
        [
          { id: 'A', geometry: box(0, 0, 8, 8) },
          { id: 'B', geometry: box(4, 0, 12, 8) },
        ],
        16,
        { maxRegions: 1 },
      ),
    (error: unknown) =>
      error instanceof OverlapBudgetError && error.reason === 'intermediate-regions',
  )
})

test('viewport tiles wrap at the date line, remain unique, and respect the tile budget', () => {
  const crossing = tilesForBounds({ west: 170, east: -170, north: 20, south: -20 }, 3)
  assert.deepEqual([...new Set(crossing.map(({ x }) => x))].sort(), [0, 7])
  const world = tilesForBounds({ west: -180, east: 180, north: 90, south: -90 }, 8)
  assert.ok(world.length <= 48)
  assert.equal(new Set(world.map(({ z, x, y }) => `${z}/${x}/${y}`)).size, world.length)
  const [longitude, latitude] = tilePositionToLngLat([0, 0], { z: 0, x: 0, y: 0 }, 4096)
  assert.equal(longitude, -180)
  assert.ok(Math.abs(latitude - 85.0511287798066) < 1e-12)
})

test('navigation retains unique coverage, prioritizes the viewport, and resets detail levels', () => {
  const tile = (x: number, z = 4) => ({ z, x, y: 4 })
  const initial = [tile(6), tile(7)]
  const panned = retainCoverageTiles([tile(7), tile(8)], initial, 3)
  assert.equal(panned.length, 3)
  assert.equal(new Set(panned.map(({ x }) => x)).size, 3)
  // Returning inside retained coverage leaves the source/request key unchanged.
  assert.equal(coverageTilesKey(retainCoverageTiles(initial, panned, 3)), coverageTilesKey(panned))
  const farther = retainCoverageTiles([tile(9), tile(10)], panned, 3)
  assert.deepEqual(farther, [tile(9), tile(10), tile(7)])
  // Never combine different simplification levels in one rendered partition.
  assert.deepEqual(retainCoverageTiles([tile(14, 5)], panned), [tile(14, 5)])
  assert.deepEqual(retainCoverageTiles([], panned), [])
})

test('stripe images use all contributor colors, opaque alpha, and seamless power-of-two periods', () => {
  const image = stripeImage(['#ff0000', '#00ff00', '#0000ff'])
  assert.equal(image.width & (image.width - 1), 0)
  const counts = new Map<string, number>()
  for (let i = 0; i < image.data.length; i += 4) {
    assert.equal(image.data[i + 3], 255)
    const rgb = [...image.data.slice(i, i + 3)].join(',')
    counts.set(rgb, (counts.get(rgb) ?? 0) + 1)
  }
  assert.deepEqual([...counts.keys()].sort(), ['0,0,255', '0,255,0', '255,0,0'])
  assert.ok(Math.max(...counts.values()) - Math.min(...counts.values()) <= image.width)
  const palette = [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
  ]
  for (let y = 0; y < image.height; y++)
    for (let x = 0; x < image.width; x++)
      assert.deepEqual(
        [...image.data.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 3)],
        palette[Math.floor((((x + y) % image.width) * palette.length) / image.width)],
      )
})

test('single-language coverage uses a solid, opaque pattern before layer compositing', () => {
  const image = stripeImage(['#3bce87'])
  assert.equal(image.data.length, 4)
  for (let offset = 0; offset < image.data.length; offset += 4) {
    assert.deepEqual([...image.data.slice(offset, offset + 4)], [59, 206, 135, 255])
  }
})

test('pattern budgets count padded texels rather than rejecting many small combinations', () => {
  checkPatternBudget(2_000 * patternPixels(3) + 2_166 * patternPixels(2))
  checkPatternBudget(MAX_PATTERN_PIXELS)
  assert.throws(
    () => checkPatternBudget(MAX_PATTERN_PIXELS + 1),
    (error: unknown) => error instanceof OverlapPatternError && error.reason === 'pattern-memory',
  )
  assert.equal(patternSize(42), 256)
  assert.throws(
    () => patternSize(43),
    (error: unknown) =>
      error instanceof OverlapPatternError && error.reason === 'pattern-contributors',
  )
  // Same logical period as the former image at pixelRatio 2.
  for (const count of [2, 3, 4, 8, 16, 42])
    assert.equal(patternSize(count), 2 ** Math.ceil(Math.log2(Math.max(32, count * 12))) / 2)
})

test('tile delivery groups disconnected faces without losing holes or reusing stale selections', async () => {
  const first = box(0, 0, 6, 6)[0]?.[0]
  const second = box(10, 10, 16, 16)[0]?.[0]
  const hole = box(1, 1, 2, 2)[0]?.[0]
  assert.ok(first && second && hole)
  const features: Feature[] = ['A', 'B'].map((id) => ({
    type: 3,
    tags: { variant_id: id },
    geometry: [first, [...hole].reverse(), second],
  }))
  const layer = new GeoJSONWrapper(features, { extent: 16, version: 2 })
  layer.name = 'areas'
  const bytes = fromVectorTileJs({ layers: { areas: layer } })
  let fetches = 0
  const archive = {
    getZxy: async () => {
      fetches++
      return { data: Uint8Array.from(bytes).buffer }
    },
  }
  const request = {
    requestId: 1,
    archiveUrl: 'fixture',
    sourceLayer: 'areas',
    variantIds: ['A', 'B'],
    tiles: [{ z: 0, x: 0, y: 0 }],
  }
  const computer = new OverlapComputer()
  const result = await computer.compute(archive, request, () => true)
  assert.equal(result?.features.length, 1)
  const face = result?.features[0]
  assert.deepEqual(face?.properties.variantIds, ['A', 'B'])
  assert.equal(face?.geometry.coordinates.length, 2)
  assert.deepEqual(face?.geometry.coordinates.map((polygon) => polygon.length).sort(), [1, 2])
  const reused = await computer.compute(archive, { ...request, requestId: 2 }, () => true)
  assert.deepEqual(reused?.features[0], face)
  const native = await Array.fromAsync(computer.computeTiles(archive, request, () => true))
  const nativeAgain = await Array.fromAsync(computer.computeTiles(archive, request, () => true))
  assert.equal(
    native[0]?.features,
    nativeAgain[0]?.features,
    'Cache reuses native delivery geometry',
  )
  assert.equal(reused?.revision, 2, 'Publication revision remains request-specific')
  const single = await computer.compute(archive, { ...request, variantIds: ['B'] }, () => true)
  assert.deepEqual(single?.features[0]?.properties.variantIds, ['B'])
  const coordinateSet = (geometry: number[][][][] | undefined) =>
    geometry
      ?.map((polygon) =>
        polygon
          .map((ring) =>
            ring
              .slice(0, -1)
              .map((point) => JSON.stringify(point))
              .sort(),
          )
          .sort(),
      )
      .sort()
  assert.deepEqual(
    coordinateSet(single?.features[0]?.geometry.coordinates),
    coordinateSet(face?.geometry.coordinates),
  )
  assert.equal(fetches, 1, 'Selection changes reuse indexed metadata, not stale partitions')
  const otherLayer = await computer.compute(
    archive,
    { ...request, sourceLayer: 'missing' },
    () => true,
  )
  assert.equal(otherLayer?.features.length, 0)
  const otherArchive = { getZxy: async () => undefined }
  const empty = await computer.compute(
    otherArchive,
    { ...request, archiveUrl: 'empty' },
    () => true,
  )
  assert.equal(empty?.features.length, 0)
})

test('direct MVT delivery preserves membership, winding, holes, and retained parent coverage', () => {
  const shell = box(0, 0, 12, 12)[0]?.[0]
  const hole = box(4, 4, 8, 8)[0]?.[0]
  assert.ok(shell && hole)
  const tile = { z: 2, x: 1, y: 0 }
  const result = encodeCoverageTile({
    tile,
    extent: 16,
    vertices: 10,
    features: [
      {
        type: 'Feature',
        properties: { pattern: 'overlap:A|B', variantIds: ['A', 'B'] },
        geometry: { type: 'MultiPolygon', coordinates: [[shell, [...hole].reverse()]] },
      },
    ],
  })
  const tiles = new Map([[tileKey(tile), result]])
  assert.equal(
    deliveryTile(tiles, tile),
    result.data,
    'Native delivery does not decode or re-encode',
  )
  for (const target of [tile, { z: 1, x: 0, y: 0 }, { z: 0, x: 0, y: 0 }]) {
    const layer = new VectorTile(new PbfReader(deliveryTile(tiles, target))).layers[COVERAGE_LAYER]
    assert.equal(layer?.length, 1)
    const feature = layer?.feature(0)
    assert.equal(feature?.properties.pattern, 'overlap:A|B')
    assert.ok(feature)
    const polygons = classifyRings(feature.loadGeometry())
    assert.equal(polygons.length, 1)
    assert.equal(polygons[0]?.length, 2, 'Hole remains a hole after zoom-out transformation')
    const scale = 2 ** (tile.z - target.z)
    assert.equal(
      area(polygons.map((p) => p.map((r) => r.map(({ x, y }) => [x, y])))),
      (144 - 16) * (8192 / 16 / scale) ** 2,
    )
  }
  assert.equal(deliveryTile(tiles, { z: 1, x: 1, y: 0 }).length, 0)
  const emptyTile = { z: 2, x: 0, y: 0 }
  const empty = encodeCoverageTile({ tile: emptyTile, extent: 16, features: [], vertices: 0 })
  assert.equal(empty.data.length, 0)
  assert.deepEqual(empty.tile, emptyTile, 'Empty tiles still participate in the fallback mask')
})

test('incremental computation delivers a completed prefix, empty tiles, and cancels between tiles', async () => {
  let fetches = 0
  let current = true
  const archive = {
    getZxy: async () => {
      fetches++
      return undefined
    },
  }
  const request = {
    requestId: 1,
    archiveUrl: 'empty-fixture',
    sourceLayer: 'areas',
    variantIds: ['A', 'B'],
    tiles: [
      { z: 1, x: 0, y: 0 },
      { z: 1, x: 1, y: 0 },
    ],
  }
  const computer = new OverlapComputer()
  const stream = computer.computeTiles(archive, request, () => current)
  const first = await stream.next()
  assert.deepEqual(first.value?.tile, request.tiles[0])
  assert.equal(first.value?.features.length, 0)
  assert.equal(fetches, 1, 'First tile is delivered before the next tile is fetched')
  current = false
  assert.equal((await stream.next()).done, true)
  assert.equal(fetches, 1, 'Cancellation prevents remaining work')
  const failing = {
    getZxy: async (z: number, x: number) => {
      if (x === 1) throw new Error(`Failed ${z}/${x}`)
      return undefined
    },
  }
  const prefix = computer.computeTiles(
    failing,
    { ...request, archiveUrl: 'failing-fixture' },
    () => true,
  )
  assert.equal((await prefix.next()).done, false)
  await assert.rejects(prefix.next(), /Failed 1\/1/)
})

const archivePath = new URL('../public/data/language-areas.pmtiles', import.meta.url)
test('real archive: Britain overlap colors retain members and removing a language removes its regions', {
  skip: !existsSync(archivePath) && 'Generate atlas data to run the archive integration test',
}, async () => {
  const archive = new PMTiles(
    new FileSource(new File([await readFile(archivePath)], 'language-areas.pmtiles')),
  )
  const computer = new OverlapComputer()
  const variantIds = ['stan1293', 'wels1247', 'scot1245', 'iris1253'].map(
    (id) => `asher2007world:contemporary:${id}`,
  )
  const request = {
    requestId: 1,
    archiveUrl: 'local-test',
    sourceLayer: 'language_areas',
    variantIds,
    tiles: tilesForBounds({ west: -11, east: 3, south: 49, north: 60 }, 4),
  }
  const freshMetrics = (): OverlapMetrics => ({
    fetchMs: 0,
    decodeMs: 0,
    initializeMs: 0,
    partitionMs: 0,
    outputMs: 0,
    decodedCacheHits: 0,
    partitionCacheHits: 0,
    inputVertices: 0,
    outputVertices: 0,
    completedTiles: 0,
  })
  const cold = freshMetrics()
  const collection = await computer.compute(archive, request, () => true, cold)
  assert.ok(collection && collection.features.length > 0)
  assert.ok(cold.inputVertices > 0 && cold.outputVertices > 0 && cold.partitionMs > 0)
  const warm = freshMetrics()
  const cached = await computer.compute(archive, request, () => true, warm)
  assert.deepEqual(cached, collection)
  assert.ok(warm.partitionCacheHits > 0)
  assert.equal(warm.inputVertices, 0)
  assert.equal(warm.partitionMs, 0)
  assert.equal(warm.fetchMs, 0)
  assert.equal(warm.outputVertices, cold.outputVertices)
  assert.ok(
    collection.features.some(
      ({ properties }) =>
        properties.variantIds.includes('asher2007world:contemporary:stan1293') &&
        properties.variantIds.includes('asher2007world:contemporary:wels1247'),
    ),
  )
  const fewer = await computer.compute(
    archive,
    { ...request, variantIds: variantIds.slice(0, 1) },
    () => true,
  )
  assert.ok(fewer && fewer.features.length > 0)
  assert.ok(fewer.features.every(({ properties }) => properties.variantIds.length === 1))
  assert.equal(
    (await computer.compute(archive, { ...request, variantIds: [] }, () => true))?.features.length,
    0,
  )
  assert.equal(await computer.compute(archive, request, () => false), null)
})

const catalogPath = new URL('../public/data/languages.json', import.meta.url)
test('real archive: dense north-east world tile succeeds or explicitly exceeds the supported budget', {
  skip:
    (!existsSync(archivePath) || !existsSync(catalogPath)) &&
    'Generate atlas data to run the dense archive regression',
}, async (t) => {
  const archive = new PMTiles(
    new FileSource(new File([await readFile(archivePath)], 'language-areas.pmtiles')),
  )
  const languages: { geometryVariantIds: string[] }[] = JSON.parse(
    await readFile(catalogPath, 'utf8'),
  )
  const variantIds = languages.flatMap((language) => language.geometryVariantIds.slice(0, 1))
  try {
    const collection = await new OverlapComputer().compute(
      archive,
      {
        requestId: 1,
        archiveUrl: 'local-dense-regression',
        sourceLayer: 'language_areas',
        variantIds,
        tiles: [{ z: 1, x: 1, y: 0 }],
      },
      () => true,
    )
    assert.ok(collection && collection.features.length > 0)
    assert.ok(collection.features.some(({ properties }) => properties.variantIds.length > 1))
    const selected = new Set(variantIds)
    for (const feature of collection.features) {
      assert.ok(feature.properties.variantIds.every((id) => selected.has(id)))
      assert.equal(
        new Set(feature.properties.variantIds).size,
        feature.properties.variantIds.length,
      )
    }
  } catch (error) {
    // Slower CI/devices may cross 1.5 s. A topology error is never accepted as a
    // budget rejection; the self-contained fixtures always require valid output.
    assert.ok(error instanceof OverlapBudgetError, String(error))
    t.diagnostic('Dense tile explicitly exceeded the unchanged production geometry budget')
  }
})
