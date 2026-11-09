import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { VectorTile } from '@mapbox/vector-tile'
import { fromVectorTileJs, GeoJSONWrapper } from '@maplibre/vt-pbf'
import { PbfReader } from 'pbf'
import { FileSource, PMTiles } from 'pmtiles'
import { archiveTiles } from '../scripts/lib/archiveTiles.ts'
import { mergePartsManifest } from '../scripts/lib/partsManifest.ts'
import {
  geometryArchiveUrl,
  mergeGeometryTiles,
  openGeometryArchive,
  selectGeometryArchives,
} from '../src/data/geometryArchives.ts'
import type { AtlasManifest, GeometryVariant } from '../src/domain/atlas.ts'

const sourceTile = (id: string) => {
  const layer = new GeoJSONWrapper(
    [
      {
        type: 3,
        tags: { variant_id: id },
        geometry: [
          [
            [0, 0],
            [100, 0],
            [100, 100],
            [0, 0],
          ],
        ],
      },
    ],
    { extent: 4096, version: 2 },
  )
  layer.name = 'language_areas'
  return fromVectorTileJs({ layers: { language_areas: layer } })
}
const manifest = {
  geometryProfiles: [
    { datasetId: 'a', viewId: 'contemporary', archive: 'geometry/a/now.pmtiles' },
    { datasetId: 'a', viewId: 'time-of-contact', archive: 'geometry/a/then.pmtiles' },
    { datasetId: 'b', viewId: 'contemporary', archive: 'geometry/b/now.pmtiles' },
  ],
} as AtlasManifest
const variants = [
  { id: 'a-now', datasetId: 'a', temporalCoverage: { viewId: 'contemporary' } },
  { id: 'a-then', datasetId: 'a', temporalCoverage: { viewId: 'time-of-contact' } },
  { id: 'b-now', datasetId: 'b', temporalCoverage: { viewId: 'contemporary' } },
] as GeometryVariant[]

test('archive selection follows source and period filters while retaining pinned comparisons', () => {
  assert.deepEqual(selectGeometryArchives(manifest, variants, ['a'], 'contemporary', []), [
    'geometry/a/now.pmtiles',
  ])
  assert.deepEqual(selectGeometryArchives(manifest, variants, ['a'], 'contemporary', ['b-now']), [
    'geometry/a/now.pmtiles',
    'geometry/b/now.pmtiles',
  ])
  assert.deepEqual(selectGeometryArchives(manifest, variants, [], 'all', ['a-then']), [
    'geometry/a/then.pmtiles',
  ])
  assert.deepEqual(selectGeometryArchives(manifest, variants, [], 'all', []), [])
  assert.equal(selectGeometryArchives({} as AtlasManifest, variants, 'all', 'all', []), undefined)
})

test('source routing never fetches the combined archive and preserves memberships in mixed-source tiles', async () => {
  const opened: string[] = []
  const signal = new AbortController().signal
  const archive = openGeometryArchive(
    geometryArchiveUrl('https://atlas.test/base/data/areas.pmtiles', [
      'a.pmtiles',
      'b.pmtiles',
      'a.pmtiles',
    ]),
    (url) => {
      opened.push(url)
      return {
        getZxy: async (z, x, y, received) => {
          assert.deepEqual([z, x, y], [4, 5, 6])
          assert.equal(received, signal)
          return { data: sourceTile(url.includes('/a.') ? 'a' : 'b').slice().buffer }
        },
      }
    },
  )
  const result = await archive.getZxy(4, 5, 6, signal)
  assert.deepEqual(opened, [
    'https://atlas.test/base/data/a.pmtiles',
    'https://atlas.test/base/data/b.pmtiles',
  ])
  assert.ok(result)
  assert.deepEqual(
    new Uint8Array(result.data),
    mergeGeometryTiles([sourceTile('a'), sourceTile('b')]),
    'The merged response must exclude unused protobuf writer buffer capacity',
  )
  const layer = new VectorTile(new PbfReader(result.data)).layers.language_areas
  assert.ok(layer)
  assert.equal(layer.length, 2)
  assert.deepEqual(
    [layer.feature(0).properties.variant_id, layer.feature(1).properties.variant_id],
    ['a', 'b'],
  )
  assert.deepEqual(layer.feature(0).loadGeometry(), layer.feature(1).loadGeometry())
  const empty = openGeometryArchive(
    geometryArchiveUrl('https://atlas.test/data/base.pmtiles', []),
    () => {
      throw new Error('No archive should open')
    },
  )
  assert.equal(await empty.getZxy(0, 0, 0), undefined)
  const abort = new AbortController()
  abort.abort()
  await assert.rejects(empty.getZxy(0, 0, 0, abort.signal), { name: 'AbortError' })
  assert.deepEqual(mergeGeometryTiles([]), new Uint8Array())
})

test('incremental profile publication preserves other periods and never downgrades completed detail', () => {
  const previous = {
    directory: 'v1/',
    maxZoom: 5,
    profiles: [
      {
        id: 'a/now',
        datasetId: 'a',
        viewId: 'contemporary' as const,
        maxZoom: 5,
        tiles: { '5': ['1-2'] },
      },
      { id: 'b/now', datasetId: 'b', viewId: 'contemporary' as const, maxZoom: 3 },
    ],
  }
  assert.ok(previous.profiles[0])
  const lower = { ...previous.profiles[0], maxZoom: 3 }
  assert.deepEqual(mergePartsManifest(previous, 'v1/', [lower]), previous)
  const added = { id: 'a/then', datasetId: 'a', viewId: 'time-of-contact' as const, maxZoom: 6 }
  const merged = mergePartsManifest(previous, 'v1/', [added])
  assert.equal(merged.maxZoom, 6)
  assert.equal(merged.profiles.length, 3)
  assert.equal(merged.profiles.find((p) => p.id === 'a/now')?.maxZoom, 5)
  assert.deepEqual(
    mergePartsManifest(previous, 'v2/', [added]).profiles,
    [added],
    'An archive revision cannot inherit stale preparation',
  )
})

const data = new URL('../public/data/', import.meta.url)
const hasProfiles =
  existsSync(new URL('manifest.json', data)) &&
  JSON.parse(readFileSync(new URL('manifest.json', data), 'utf8')).geometryProfiles

test('real split archives retain source tile properties and coordinates', {
  skip: !hasProfiles,
}, async () => {
  const m: AtlasManifest = JSON.parse(readFileSync(new URL('manifest.json', data), 'utf8'))
  const fileArchive = (name: string) =>
    new PMTiles(new FileSource(new File([readFileSync(new URL(name, data))], name)))
  const original = fileArchive(m.archive)
  const profile = m.geometryProfiles?.find((p) => p.datasetId === 'dlac1987china')
  assert.ok(profile)
  const split = fileArchive(profile.archive)
  const tiles = await archiveTiles(split, 5)
  assert.ok(
    tiles.some((t) => t.z === 5),
    'Fine detail must be discoverable through the sparse archive index',
  )
  for (const tile of tiles.filter((t) => t.z === 3 || t.z === 5)) {
    const old = await original.getZxy(tile.z, tile.x, tile.y)
    assert.ok(old)
    const next = await split.getZxy(tile.z, tile.x, tile.y)
    assert.ok(next)
    const oldLayer = new VectorTile(new PbfReader(old.data)).layers[m.vectorLayer]
    assert.ok(oldLayer)
    const nextLayer = new VectorTile(new PbfReader(next.data)).layers[m.vectorLayer]
    assert.ok(nextLayer)
    const summarize = (layer: typeof oldLayer, filter: boolean) =>
      Array.from({ length: layer.length }, (_, i) => layer.feature(i))
        .filter(
          (f) =>
            !filter ||
            (f.properties.dataset_id === profile.datasetId &&
              f.properties.temporal_view === profile.viewId),
        )
        .map((f) =>
          JSON.stringify({
            id: f.id,
            properties: Object.fromEntries(Object.entries(f.properties).sort()),
            geometry: f.loadGeometry(),
          }),
        )
        .sort()
    assert.equal(nextLayer.extent, oldLayer.extent)
    assert.deepEqual(
      summarize(nextLayer, false),
      summarize(oldLayer, true),
      `Tile ${JSON.stringify(tile)}`,
    )
  }
})
