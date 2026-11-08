import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { GeometryVariant } from '../src/domain/atlas.ts'
import { refinedMemberships } from '../src/domain/refinement.ts'
import { OverlapComputer } from '../src/features/map/overlap/compute.ts'
import { createPartsResolver } from '../src/features/map/overlap/coverageParts.ts'
import { encodeCoverageTile } from '../src/features/map/overlap/delivery.ts'
import { loadCoveragePartition, type MultiPolygon } from '../src/features/map/overlap/geometry.ts'
import { joinParts } from '../src/features/map/overlap/joinParts.ts'
import type { OverlapMetrics, OverlapRequest } from '../src/features/map/overlap/types.ts'

const partition = await loadCoveragePartition()
const box = (l: number, t: number, r: number, b: number): MultiPolygon => [
  [
    [
      [l, t],
      [r, t],
      [r, b],
      [l, b],
      [l, t],
    ],
  ],
]
const inside = (geometry: MultiPolygon, x: number, y: number) =>
  geometry.some((polygon) =>
    polygon.reduce((inside, ring) => {
      let hit = false
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i],
          b = ring[j]
        if (
          a &&
          b &&
          a[1] > y !== b[1] > y &&
          x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]
        )
          hit = !hit
      }
      return inside !== hit
    }, false),
  )
const metrics = (): OverlapMetrics => ({
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
const tile = { z: 0, x: 0, y: 0 }
const parts = { directory: 'parts/', profile: 'dataset/contemporary', maxZoom: 3 }
const base: OverlapRequest = {
  requestId: 1,
  archiveUrl: 'https://atlas.test/data/areas.pmtiles',
  sourceLayer: 'areas',
  variantIds: ['parent', 'child', 'sibling', 'unrelated'],
  tiles: [tile],
  parts,
}

test('edge cancellation joins adjacent cells while preserving holes, islands, point contacts and unmatched subdivisions', () => {
  const cells: MultiPolygon = []
  for (let x = 0; x < 6; x++)
    for (let y = 0; y < 6; y++) {
      if (x >= 2 && x < 4 && y >= 2 && y < 4) continue
      cells.push(...box(x, y, x + 1, y + 1))
    }
  cells.push(...box(6, 6, 8, 8)) // point contact with the frame
  cells.push(...box(2.5, 2.5, 3.5, 3.5)) // island inside its hole
  const original = structuredClone(cells)
  const joined = joinParts(cells)
  assert.equal(joined.length, 3)
  assert.equal(joined.filter((p) => p.length === 2).length, 1)
  assert.ok(
    joined.flat(1).every((r) => r.length === 5),
    'Internal collinear vertices must disappear',
  )
  for (let x = 0.25; x < 9; x += 0.5)
    for (let y = 0.25; y < 9; y += 0.5)
      assert.equal(inside(joined, x, y), inside(cells, x, y), `Coverage at ${x},${y}`)
  assert.deepEqual(cells, original, 'Joining must not mutate prepared or cached geometry')
  // Matching edges are an optimization; inconsistent segmentation retains safe pieces.
  const unmatched = [...box(0, 0, 2, 1), ...box(0, 1, 1, 2), ...box(1, 1, 2, 2)]
  const result = joinParts(unmatched)
  for (let x = 0.25; x < 2; x += 0.5)
    for (let y = 0.25; y < 2; y += 0.5) assert.equal(inside(result, x, y), true)
})

test('prepared parts preserve selection, ancestry, comparisons, holes and aggregate aliases without live overlay', async (t) => {
  const child = box(2, 2, 10, 10)
  const hole = box(6, 6, 8, 8)[0]?.[0]
  assert.ok(child[0] && hole)
  child[0].push(hole.slice().reverse())
  const inputs = [
    { id: 'parent', geometry: box(0, 0, 12, 12) },
    { id: 'child', geometry: child },
    { id: 'sibling', geometry: box(8, 0, 14, 4) },
    { id: 'unrelated', geometry: box(0, 0, 5, 5) },
  ]
  const raw = partition(inputs, 16, { includeSingles: true })
  const bytes = encodeCoverageTile({
    tile,
    extent: 16,
    vertices: 0,
    features: raw.map((region) => ({
      type: 'Feature',
      properties: { pattern: 'raw', variantIds: region.members },
      geometry: { type: 'MultiPolygon', coordinates: region.geometry },
    })),
  }).data
  let fetches = 0
  t.mock.method(globalThis, 'fetch', async () => {
    fetches++
    return new Response(bytes)
  })
  const archive = {
    getZxy: async () => {
      throw new Error('Prepared selection must not read source geometry')
    },
  }
  const computer = new OverlapComputer()
  for (const selection of [
    {},
    { refinements: { child: ['parent'], sibling: ['parent'] } },
    { variantIds: ['parent', 'sibling'] }, // removing a child restores its parent
    { variantIds: ['child'] },
    { variantIds: ['parent'] },
    { variantIds: ['absent'] },
    {
      variantGroups: {
        parent: ['aggregate'],
        child: ['aggregate', 'child-own'],
        sibling: ['sibling'],
      },
    },
    {
      variantGroups: { parent: ['comparison', 'parent-branch'], child: ['child-branch'] },
      refinements: { 'child-branch': ['parent-branch'] },
    },
  ]) {
    const request: OverlapRequest = { ...base, ...selection }
    const report = metrics()
    const [result] = await Array.fromAsync(
      computer.computeTiles(archive, request, () => true, report),
    )
    assert.ok(result)
    for (let x = 0.5; x < 16; x++)
      for (let y = 0.5; y < 16; y++) {
        const raw = inputs
          .filter((input) => request.variantIds.includes(input.id) && inside(input.geometry, x, y))
          .flatMap(({ id }) => request.variantGroups?.[id] ?? [id])
        const expected = refinedMemberships(raw, request.refinements)
        const actual = result.features.filter((f) =>
          inside(f.geometry.coordinates, x * 512, y * 512),
        )
        assert.equal(actual.length, expected.length ? 1 : 0, `Disjoint coverage at ${x},${y}`)
        assert.deepEqual(actual[0]?.properties.variantIds ?? [], expected)
      }
    assert.equal(report.partitionMs, 0)
    assert.equal(report.inputVertices, 0)
    assert.equal(report.partsTiles, 1)
  }
  assert.equal(fetches, 1, 'Changing selection must reuse the selection-independent tile')
})

test('prepared profiles require a single actual dataset and period, including all aggregate contributors', () => {
  const variants = [
    { id: 'a', datasetId: 'one', temporalCoverage: { viewId: 'contemporary' } },
    { id: 'b', datasetId: 'one', temporalCoverage: { viewId: 'contemporary' } },
    { id: 'c', datasetId: 'one', temporalCoverage: { viewId: 'time-of-contact' } },
    { id: 'd', datasetId: 'two', temporalCoverage: { viewId: 'contemporary' } },
  ] as GeometryVariant[]
  const resolve = createPartsResolver(
    {
      directory: 'parts/',
      maxZoom: 3,
      profiles: [
        { id: 'one-now', datasetId: 'one', viewId: 'contemporary' },
        { id: 'two-now', datasetId: 'two', viewId: 'contemporary' },
      ],
    },
    variants,
  )
  assert.deepEqual(resolve(['a', 'b']), { directory: 'parts/', maxZoom: 3, profile: 'one-now' })
  for (const ids of [[], ['unknown'], ['a', 'unknown'], ['a', 'c'], ['a', 'd'], ['c']])
    assert.equal(resolve(ids), undefined)
})

test('optional missing, malformed and higher-zoom parts fall back live; cancellation does not', async (t) => {
  let reads = 0,
    fetches = 0
  const archive = {
    getZxy: async () => {
      reads++
      return undefined
    },
  }
  t.mock.method(globalThis, 'fetch', async () => {
    fetches++
    return new Response('', { status: 404 })
  })
  await Array.fromAsync(new OverlapComputer().computeTiles(archive, base, () => true))
  assert.equal(reads, 1)
  await Array.fromAsync(
    new OverlapComputer().computeTiles(
      archive,
      { ...base, tiles: [{ z: 4, x: 0, y: 0 }] },
      () => true,
    ),
  )
  assert.equal(fetches, 1)
  assert.equal(reads, 2)
  t.mock.method(globalThis, 'fetch', async () => new Response(new Uint8Array([255, 255])))
  await Array.fromAsync(new OverlapComputer().computeTiles(archive, base, () => true))
  assert.equal(reads, 3)
  const abort = new AbortController()
  t.mock.method(globalThis, 'fetch', async () => {
    abort.abort()
    return new Response('', { status: 404 })
  })
  await assert.rejects(
    Array.fromAsync(
      new OverlapComputer().computeTiles(archive, base, () => true, undefined, abort.signal),
    ),
    { name: 'AbortError' },
  )
  assert.equal(reads, 3)
})

test('prepared metadata cache remains bounded, isolates profiles and does not publish superseded loads', async (t) => {
  let fetches = 0
  t.mock.method(globalThis, 'fetch', async () => {
    fetches++
    return new Response(new Uint8Array())
  })
  const archive = {
    getZxy: async () => {
      throw new Error('Empty prepared coverage is complete')
    },
  }
  const computer = new OverlapComputer()
  const request = { ...base, parts: { ...parts, maxZoom: 6 } }
  for (let x = 0; x < 49; x++)
    await Array.fromAsync(
      computer.computeTiles(archive, { ...request, tiles: [{ z: 6, x, y: 0 }] }, () => true),
    )
  assert.equal(computer.stats().partsEntries, 48)
  await Array.fromAsync(
    computer.computeTiles(
      archive,
      {
        ...request,
        parts: { ...request.parts, profile: 'different' },
        tiles: [{ z: 6, x: 48, y: 0 }],
      },
      () => true,
    ),
  )
  assert.equal(fetches, 50)
  let current = true
  t.mock.method(globalThis, 'fetch', async () => {
    current = false
    return new Response(new Uint8Array())
  })
  assert.deepEqual(
    await Array.fromAsync(new OverlapComputer().computeTiles(archive, base, () => current)),
    [],
  )
})

test('sparse parts distinguish known-empty, unprepared and missing nonempty tiles at per-profile zooms', async (t) => {
  const variants = [
    { id: 'a', datasetId: 'one', temporalCoverage: { viewId: 'contemporary' } },
  ] as GeometryVariant[]
  const resolve = createPartsResolver(
    {
      directory: 'parts/',
      maxZoom: 5,
      profiles: [
        {
          id: 'one-now',
          datasetId: 'one',
          viewId: 'contemporary',
          maxZoom: 4,
          tiles: { '3': [], '4': ['1-2'] },
        },
      ],
    },
    variants,
  )
  const config = resolve(['a'])
  assert.ok(config)
  assert.equal(config.maxZoom, 4)
  let fetches = 0,
    reads = 0
  t.mock.method(globalThis, 'fetch', async () => {
    fetches++
    return new Response('', { status: 404 })
  })
  const archive = {
    getZxy: async () => {
      reads++
      return undefined
    },
  }
  const computer = new OverlapComputer()
  const request = { ...base, variantIds: ['a'], parts: config }
  const report = metrics()
  await Array.fromAsync(
    computer.computeTiles(
      archive,
      { ...request, tiles: [{ z: 4, x: 0, y: 0 }] },
      () => true,
      report,
    ),
  )
  assert.equal(fetches, 0)
  assert.equal(reads, 0)
  assert.equal(report.partsTiles, 1)
  for (const tile of [
    { z: 4, x: 1, y: 2 },
    { z: 2, x: 0, y: 0 },
    { z: 5, x: 0, y: 0 },
  ])
    await Array.fromAsync(
      new OverlapComputer().computeTiles(archive, { ...request, tiles: [tile] }, () => true),
    )
  assert.equal(fetches, 1, 'Only a declared nonempty tile should cause a parts request')
  assert.equal(reads, 3, 'Missing assets and unprepared levels must still fall back live')
})

test('profile availability indexes load lazily, cache across tiles and selections, and fail safely', async (t) => {
  const calls: string[] = []
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls.push(String(url))
    return String(url).endsWith('.json')
      ? Response.json({ '5': ['1-2'] })
      : new Response(new Uint8Array())
  })
  let reads = 0
  const archive = {
    getZxy: async () => {
      reads++
      return undefined
    },
  }
  const request = {
    ...base,
    parts: { ...parts, maxZoom: 5, tileIndex: 'dataset/contemporary/index-hash.json' },
  }
  const computer = new OverlapComputer()
  for (const tile of [
    { z: 5, x: 0, y: 0 },
    { z: 5, x: 1, y: 2 },
    { z: 5, x: 1, y: 3 },
  ])
    await Array.fromAsync(computer.computeTiles(archive, { ...request, tiles: [tile] }, () => true))
  assert.equal(reads, 0)
  assert.deepEqual(calls, [
    'https://atlas.test/data/parts/dataset/contemporary/index-hash.json',
    'https://atlas.test/data/parts/dataset/contemporary/5-1-2.pbf',
  ])
  for (const invalid of [null, [], { '5': null }, { '5': [123] }, { bad: [] }]) {
    t.mock.method(globalThis, 'fetch', async () => Response.json(invalid))
    await Array.fromAsync(
      new OverlapComputer().computeTiles(
        archive,
        { ...request, tiles: [{ z: 5, x: 0, y: 0 }] },
        () => true,
      ),
    )
  }
  assert.equal(reads, 5, 'Malformed indexes must never declare a tile empty')
  const abort = new AbortController()
  t.mock.method(globalThis, 'fetch', async () => {
    abort.abort()
    return Response.json({ '5': [] })
  })
  await assert.rejects(
    Array.fromAsync(
      new OverlapComputer().computeTiles(archive, request, () => true, undefined, abort.signal),
    ),
    { name: 'AbortError' },
  )
})
