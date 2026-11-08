import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mapAreaSelectionKey } from '../src/domain/aggregation.ts'
import type { AtlasData, GeometryVariant, Language } from '../src/domain/atlas.ts'
import { type MapEntry, resolveMapEntries } from '../src/domain/mapEntries.ts'
import { refinedMemberships } from '../src/domain/refinement.ts'
import { blendedFace } from '../src/features/map/overlap/blending.ts'
import { OverlapComputer } from '../src/features/map/overlap/compute.ts'
import { encodeCoverageTile } from '../src/features/map/overlap/delivery.ts'
import { loadCoveragePartition, type MultiPolygon } from '../src/features/map/overlap/geometry.ts'
import {
  branchCoverageSignature,
  decodePrecomputedTile,
} from '../src/features/map/overlap/precomputed.ts'
import type { OverlapRequest } from '../src/features/map/overlap/types.ts'

const partition = await loadCoveragePartition()
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
const contains = (geometry: MultiPolygon, x: number, y: number) =>
  geometry.some((polygon) =>
    polygon.reduce((inside, ring) => {
      let hit = false
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i]
        const b = ring[j]
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

test('branch refinement preserves the union, descendant spillover, holes, siblings and unrelated overlap', () => {
  const outer = box(0, 0, 12, 12)
  const hole = box(6, 6, 8, 8)[0]?.[0]
  assert.ok(outer[0] && hole)
  const inputs = [
    { id: 'parent', geometry: outer },
    { id: 'child', geometry: [[...(box(2, 2, 10, 10)[0] ?? []), [...hole].reverse()]] },
    { id: 'grandchild', geometry: box(0, 0, 5, 5) },
    { id: 'sibling', geometry: box(8, 0, 12, 4) },
    { id: 'other-family', geometry: outer },
  ]
  const refinements = { child: ['parent'], grandchild: ['child', 'parent'], sibling: ['parent'] }
  const regions = partition(inputs, 16, { includeSingles: true, refinements })
  assert.deepEqual(
    partition([...inputs].reverse(), 16, { includeSingles: true, refinements }),
    regions,
  )
  for (let x = 0.5; x < 12; x++)
    for (let y = 0.5; y < 12; y++) {
      const raw = inputs.filter((input) => contains(input.geometry, x, y)).map((input) => input.id)
      const actual = regions.filter((region) => contains(region.geometry, x, y))
      assert.equal(actual.length, 1, `Disjoint, complete coverage at ${x},${y}`)
      assert.deepEqual(actual[0]?.members, refinedMemberships(raw, refinements))
    }
  assert.ok(
    regions.some(
      (region) => region.members.includes('child') && region.members.includes('sibling'),
    ),
  )
  assert.ok(regions.some((region) => region.members.includes('parent')))
  assert.ok(regions.every((region) => region.members.includes('other-family')))
})

test('branch groups respect pinned comparison contexts and periods; removing a child restores parent fill', () => {
  const languages = [
    { id: 'parent', parentId: null },
    { id: 'child', parentId: 'parent' },
    { id: 'grandchild', parentId: 'child' },
  ] as Language[]
  const variants = ['parent', 'child', 'grandchild', 'historic-parent', 'comparison-parent'].map(
    (id) => ({
      id,
      languageId: id.endsWith('-parent') ? 'parent' : id,
      temporalCoverage: { viewId: id === 'historic-parent' ? 'year-1750' : 'contemporary' },
    }),
  ) as GeometryVariant[]
  const data = {
    languageById: new Map(languages.map((x) => [x.id, x])),
    variantById: new Map(variants.map((x) => [x.id, x])),
  } as AtlasData
  const entries: MapEntry[] = variants.map((variant) => ({
    id: variant.id,
    languageId: variant.languageId,
    mode: 'own',
    variantIds: [variant.id],
    uncoveredBranchIds: [],
    context: { sources: 'all', period: 'all' },
    colorRootId: 'parent',
    colorOverride: null,
    ...(variant.id === 'comparison-parent' ? {} : { branchRootId: 'parent' }),
  }))
  const areas = resolveMapEntries(entries, data, new Map())
  assert.deepEqual(areas.find((x) => x.id === 'child')?.refines, ['parent'])
  assert.deepEqual(areas.find((x) => x.id === 'grandchild')?.refines, ['child', 'parent'])
  const differentContext = resolveMapEntries(
    entries.map((entry) =>
      entry.id === 'parent' ? { ...entry, context: { sources: ['other'], period: 'all' } } : entry,
    ),
    data,
    new Map(),
  )
  assert.equal(differentContext.find((x) => x.id === 'child')?.refines, undefined)
  const differentBranch = resolveMapEntries(
    entries.map((entry) =>
      entry.id === 'parent' ? { ...entry, branchRootId: 'another-view' } : entry,
    ),
    data,
    new Map(),
  )
  assert.equal(differentBranch.find((x) => x.id === 'child')?.refines, undefined)
  assert.equal(mapAreaSelectionKey(areas), mapAreaSelectionKey([...areas].reverse()))
  const restored = resolveMapEntries(
    entries.filter((x) => x.languageId === 'parent'),
    data,
    new Map(),
  )
  assert.ok(restored.every((x) => !x.refines?.length))
  assert.notEqual(mapAreaSelectionKey(restored), mapAreaSelectionKey(areas))
})

test('blended faces preserve source-over ordering with one draw per disjoint region', () => {
  assert.deepEqual(blendedFace(['#ff0000'], 0.5), { color: '#ff0000', opacity: 0.5 })
  assert.deepEqual(blendedFace(['#ff0000', '#0000ff'], 0.5), { color: '#5500aa', opacity: 0.75 })
  assert.deepEqual(blendedFace(['#ff0000', '#0000ff'], 1), { color: '#0000ff', opacity: 1 })
  assert.deepEqual(blendedFace(['#ff0000'], 0), { color: '#000000', opacity: 0 })
})

test('prepared signatures ignore order/presentation but reject changed geometry, policy, and aggregates', async () => {
  const selection = { variantIds: ['parent', 'child'], refinements: { child: ['parent'] } }
  const signature = await branchCoverageSignature(selection)
  assert.equal(
    signature,
    await branchCoverageSignature({
      ...selection,
      variantIds: ['child', 'parent'],
      variantGroups: { parent: ['parent'], child: ['child'] },
    }),
  )
  assert.notEqual(signature, await branchCoverageSignature({ variantIds: ['parent', 'child'] }))
  assert.notEqual(
    signature,
    await branchCoverageSignature({ ...selection, variantIds: ['parent'] }),
  )
  assert.equal(
    await branchCoverageSignature({ ...selection, variantGroups: { child: ['aggregate'] } }),
    null,
  )
})

test('exact prepared views bypass Boolean computation, cache geometry, and missing assets fall back live', async (t) => {
  const tile = { z: 0, x: 0, y: 0 }
  const selection = { variantIds: ['parent', 'child'], refinements: { child: ['parent'] } }
  const regions = partition(
    [
      { id: 'parent', geometry: box(0, 0, 16, 16) },
      { id: 'child', geometry: box(0, 0, 8, 8) },
    ],
    16,
    { includeSingles: true, refinements: selection.refinements },
  )
  const result = {
    tile,
    extent: 16,
    vertices: 0,
    features: regions.map((region) => ({
      type: 'Feature' as const,
      properties: { pattern: `overlap:${region.members.join('|')}`, variantIds: region.members },
      geometry: { type: 'MultiPolygon' as const, coordinates: region.geometry },
    })),
  }
  const bytes = encodeCoverageTile(result).data
  const decoded = decodePrecomputedTile(bytes, tile)
  assert.deepEqual(
    decoded.features.map((x) => x.properties.variantIds),
    result.features.map((x) => x.properties.variantIds),
  )
  let fetches = 0
  t.mock.method(globalThis, 'fetch', async () => {
    fetches++
    return new Response(bytes)
  })
  let archiveReads = 0
  const archive = {
    getZxy: async () => {
      archiveReads++
      return undefined
    },
  }
  const signature = await branchCoverageSignature(selection)
  assert.ok(signature)
  const request: OverlapRequest = {
    requestId: 1,
    archiveUrl: 'https://atlas.test/data/areas.pmtiles',
    sourceLayer: 'areas',
    ...selection,
    tiles: [tile],
    precomputed: { directory: 'prepared/', maxZoom: 2, signatures: [signature] },
  }
  const computer = new OverlapComputer()
  const first = await Array.fromAsync(computer.computeTiles(archive, request, () => true))
  assert.equal(first[0]?.vertices, decoded.vertices)
  assert.deepEqual(
    await Array.fromAsync(computer.computeTiles(archive, request, () => true)),
    first,
  )
  assert.equal(fetches, 1)
  assert.equal(archiveReads, 0)
  await Array.fromAsync(computer.computeTiles(archive, { ...request, refinements: {} }, () => true))
  assert.equal(archiveReads, 1, 'A changed policy must use live geometry')
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 404 }))
  await Array.fromAsync(new OverlapComputer().computeTiles(archive, request, () => true))
  assert.equal(archiveReads, 2, 'Optional missing prepared assets must use live geometry')
  const cancellation = new AbortController()
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    cancellation.abort()
    options?.signal?.throwIfAborted()
    return new Response(bytes)
  })
  await assert.rejects(
    Array.fromAsync(
      new OverlapComputer().computeTiles(
        archive,
        request,
        () => true,
        undefined,
        cancellation.signal,
      ),
    ),
    { name: 'AbortError' },
  )
  assert.equal(archiveReads, 2, 'Cancelling prepared coverage must not start live computation')
})
