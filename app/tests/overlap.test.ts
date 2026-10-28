import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { FileSource, PMTiles } from 'pmtiles'
import type { MultiPolygon, Polygon } from 'polygon-clipping'
import polygonClipping from 'polygon-clipping'
import { OverlapComputer } from '../src/features/map/overlap/compute.ts'
import { OverlapBudgetError, partitionCoverage } from '../src/features/map/overlap/geometry.ts'
import { stripeImage } from '../src/features/map/overlap/patterns.ts'
import { tilePositionToLngLat, tilesForBounds } from '../src/features/map/overlap/tiles.ts'

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
      assert.equal(area(polygonClipping.intersection(left.geometry, right.geometry)), 0)
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
    OverlapBudgetError,
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
})

test('single-language coverage uses a solid, opaque pattern before layer compositing', () => {
  const image = stripeImage(['#3bce87'])
  for (let offset = 0; offset < image.data.length; offset += 4) {
    assert.deepEqual([...image.data.slice(offset, offset + 4)], [59, 206, 135, 255])
  }
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
  const collection = await computer.compute(archive, request, () => true)
  assert.ok(collection && collection.features.length > 0)
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
