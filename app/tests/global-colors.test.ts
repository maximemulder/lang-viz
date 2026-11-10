import assert from 'node:assert/strict'
import test from 'node:test'
import type { AtlasData, GeometryVariant, Language } from '../src/domain/atlas.ts'
import { buildLanguageSearchIndex } from '../src/domain/catalog.ts'
import { buildGlobalColorInput, optimizeGlobalColors } from '../src/domain/globalColors.ts'
import { encodeCoverageTile } from '../src/features/map/overlap/delivery.ts'
import { branchCoverageSignature } from '../src/features/map/overlap/precomputed.ts'
import type { TileCoordinate } from '../src/features/map/overlap/types.ts'

const profile = { id: 'source/contemporary', datasetId: 'source', viewId: 'contemporary' } as const
const fixture = async (): Promise<AtlasData> => {
  const languages = ['a', 'b', 'unmapped'].map(
    (id): Language => ({
      id,
      name: id,
      classification: { kind: 'glottolog', glottocode: id },
      level: 'language',
      parentId: null,
      parentLanguageId: null,
      familyId: null,
      familyName: null,
      alternativeNames: [],
      iso6393: null,
      macroarea: null,
      countries: [],
      latitude: 0,
      longitude: 0,
      geometryVariantIds: id === 'unmapped' ? [] : [id],
    }),
  )
  const variants = ['a', 'b'].map(
    (id): GeometryVariant => ({
      id,
      languageId: id,
      datasetId: 'source',
      layer: 'contemporary',
      label: id,
      featureId: 1,
      featureCount: 1,
      geometryKind: 'source',
      color: '#123456',
      sourceYear: 2000,
      temporalCoverage: {
        kind: 'named-period',
        viewId: 'contemporary',
        label: 'Now',
        quality: 'direct',
      },
    }),
  )
  const signature = await branchCoverageSignature({ variantIds: ['a', 'b'] })
  assert.ok(signature)
  return {
    languages,
    variants,
    datasets: [],
    palettes: new Map(),
    languageById: new Map(languages.map((x) => [x.id, x])),
    variantById: new Map(variants.map((x) => [x.id, x])),
    languageSearchIndex: buildLanguageSearchIndex(languages),
    manifest: {
      schemaVersion: 5,
      languoidCount: 3,
      languoidWithGeometryCount: 2,
      geometryVariantCount: 2,
      vectorLayer: 'languages',
      archive: '',
      branchCoverage: { directory: 'coverage/', maxZoom: 3, signatures: [signature] },
    },
  }
}
const bytes = (tile: TileCoordinate) => {
  if (tile.x !== 2 || (tile.y !== 3 && tile.y !== 4)) return new Uint8Array()
  const id = tile.y === 3 ? 'a' : 'b'
  return encodeCoverageTile({
    tile,
    extent: 64,
    vertices: 5,
    features: [
      {
        type: 'Feature',
        properties: { pattern: id, variantIds: [id] },
        geometry: {
          type: 'MultiPolygon',
          coordinates: [
            [
              [
                [8, 8],
                [16, 8],
                [16, 16],
                [8, 16],
                [8, 8],
              ],
            ],
          ],
        },
      },
    ],
  }).data
}

test('canonical global sampling preserves geography and output regardless of tile delivery order', async () => {
  const data = await fixture()
  const direct = await buildGlobalColorInput(data, profile, async (_path, tile) => bytes(tile))
  const seen: string[] = []
  const reordered = await buildGlobalColorInput(data, profile, async (path, tile) => {
    await new Promise((resolve) => setTimeout(resolve, (7 - tile.y) * 2))
    seen.push(path)
    return bytes(tile)
  })
  assert.equal(seen.length, 64)
  assert.ok(seen[0]?.endsWith('3-0-7.pbf'), 'fixture delivers tiles out of order')
  assert.deepEqual(reordered, direct)
  assert.deepEqual(direct.input.view, {
    columns: 3,
    rows: 11,
    footprints: [
      { id: 'a', languageId: 'a', cells: [0, 1, 2, 3, 4, 5, 6, 7, 8] },
      { id: 'b', languageId: 'b', cells: [24, 25, 26, 27, 28, 29, 30, 31, 32] },
    ],
  })
  const first = optimizeGlobalColors(direct.input, profile)
  assert.deepEqual(optimizeGlobalColors(reordered.input, profile), first)
  assert.equal(first.colors.size, data.languages.length, 'includes unaffected catalog languages')
  assert.equal(first.colors.get('unmapped'), direct.input.reference.colors.get('unmapped'))
  assert.equal(first.datasetProfile, profile.id)
})

test('global optimization fails explicitly on unavailable or incomplete geometry', async () => {
  const data = await fixture()
  await assert.rejects(
    buildGlobalColorInput(data, profile, async () => {
      throw new Error('missing tile')
    }),
    /missing tile/,
  )
  await assert.rejects(
    buildGlobalColorInput(data, profile, async () => new Uint8Array()),
    /No full-dataset geometry/,
  )
  const stale = {
    ...data,
    manifest: {
      ...data.manifest,
      branchCoverage: { directory: 'coverage/', maxZoom: 3, signatures: [] },
    },
  }
  await assert.rejects(
    buildGlobalColorInput(stale, profile, async () => {
      throw new Error('must not read')
    }),
    /does not match/,
  )
})
