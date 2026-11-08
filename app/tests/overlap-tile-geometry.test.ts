import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { classifyRings, VectorTile } from '@mapbox/vector-tile'
import { PbfReader } from 'pbf'
import { FileSource, PMTiles } from 'pmtiles'
import {
  buildGeographyAvailability,
  mapAreaSelectionKey,
  mappedBranchForLanguages,
} from '../src/domain/aggregation.ts'
import type { AtlasData, GeometryVariant, Language } from '../src/domain/atlas.ts'
import { buildLanguageHierarchy } from '../src/domain/hierarchy.ts'
import { pinMapEntry, resolveMapEntries } from '../src/domain/mapEntries.ts'
import { OverlapComputer } from '../src/features/map/overlap/compute.ts'
import {
  COVERAGE_LAYER,
  deliveryTile,
  encodeCoverageTile,
  tileKey,
} from '../src/features/map/overlap/delivery.ts'
import { quantizeTilePolygon } from '../src/features/map/overlap/tileGeometry.ts'
import { parseOverlapSelection } from '../src/features/map/overlap/types.ts'

type Ring = [number, number][]
const area = (ring: Ring) =>
  ring.reduce((sum, a, i) => {
    const b = ring[(i + 1) % ring.length]
    return b ? sum + a[0] * b[1] - b[0] * a[1] : sum
  }, 0) / 2
const box = (left: number, top: number, right: number, bottom: number): Ring => [
  [left, top],
  [right, top],
  [right, bottom],
  [left, bottom],
  [left, top],
]
const narrow: Ring = [
  [0, 0],
  [5.49, 0.51],
  [10.4, 1.49],
  [0, 0],
]
const polygons = (bytes: Uint8Array) => {
  const layer = new VectorTile(new PbfReader(bytes)).layers[COVERAGE_LAYER]
  assert.ok(layer)
  return Array.from({ length: layer.length }, (_, i) => ({
    properties: layer.feature(i).properties,
    geometry: classifyRings(layer.feature(i).loadGeometry()).map((polygon) =>
      polygon.map((ring) => ring.map(({ x, y }): [number, number] => [x, y])),
    ),
  }))
}

test('tile quantization winds shells and holes after rounding, including reversed slivers', () => {
  assert.ok(area(narrow) > 0)
  assert.ok(area(narrow.map(([x, y]) => [Math.round(x), Math.round(y)])) < 0)
  const original = structuredClone(narrow)
  const shell = quantizeTilePolygon([narrow], (point) => point)
  assert.equal(shell.length, 1)
  assert.ok(area(shell[0] ?? []) > 0)
  const hole = quantizeTilePolygon([box(-10, -10, 20, 20), narrow], (point) => point)
  assert.equal(hole.length, 2)
  assert.ok(area(hole[1] ?? []) < 0)
  assert.deepEqual(narrow, original, 'Encoding must not mutate cached native geometry')
})

test('collapsed shells discard their holes; collapsed holes leave the shell intact', () => {
  const collapsed = box(0.1, 0.1, 0.4, 0.4)
  assert.deepEqual(
    quantizeTilePolygon([collapsed, box(0.2, 0.2, 0.3, 0.3)], (point) => point),
    [],
  )
  assert.deepEqual(
    quantizeTilePolygon([box(0, 0, 10, 10), collapsed], (point) => point),
    [box(0, 0, 10, 10)],
  )
})

test('native and zoom-out tiles keep a reversed sliver separate from a large island', () => {
  for (const [ring, parent] of [
    [narrow, false],
    [
      [
        [0, 0],
        [11, 1],
        [21, 2],
        [0, 0],
      ],
      true,
    ],
  ] as const) {
    const tile = encodeCoverageTile({
      tile: { z: 2, x: 0, y: 0 },
      extent: 8192,
      vertices: 14,
      features: [
        {
          type: 'Feature',
          properties: { pattern: 'test', variantIds: ['language'] },
          geometry: {
            type: 'MultiPolygon',
            coordinates: [
              [ring.map(([x, y]) => [x, y])],
              [box(100, 100, 8000, 8000), box(200, 200, 400, 400)],
            ],
          },
        },
      ],
    })
    const target = parent ? { z: 1, x: 0, y: 0 } : tile.tile
    for (const buffered of [false, true]) {
      const [feature] = polygons(
        deliveryTile(new Map([[tileKey(tile.tile), tile]]), target, buffered),
      )
      assert.ok(feature)
      assert.equal(feature.geometry.length, 2, 'The large island must remain a shell')
      assert.deepEqual(
        feature.geometry.map((polygon) => polygon.length),
        [1, 2],
      )
      for (const polygon of feature.geometry) {
        assert.ok(area(polygon[0] ?? []) > 0)
        for (const hole of polygon.slice(1)) assert.ok(area(hole) < 0)
      }
    }
  }
})

const archivePath = new URL('../public/data/language-areas.pmtiles', import.meta.url)
test('real mapped branches: German and Yue remain shells in native and parent tiles', {
  skip: !existsSync(archivePath) && 'Generate atlas data to run the archive regression',
}, async () => {
  const languages: Language[] = JSON.parse(
    readFileSync(new URL('../public/data/languages.json', import.meta.url), 'utf8'),
  )
  const variants: GeometryVariant[] = JSON.parse(
    readFileSync(new URL('../public/data/geometry-variants.json', import.meta.url), 'utf8'),
  )
  const data = {
    languages,
    variants,
    languageById: new Map(languages.map((language) => [language.id, language])),
    variantById: new Map(variants.map((variant) => [variant.id, variant])),
  } as AtlasData
  const hierarchy = buildLanguageHierarchy(languages)
  const archive = new PMTiles(new FileSource(new File([readFileSync(archivePath)], 'areas')))
  const computer = new OverlapComputer()
  for (const [dataset, language, tile] of [
    ['asher2007world', 'stan1295', { z: 3, x: 4, y: 2 }],
    ['dlac1987china', 'yuec1235', { z: 4, x: 12, y: 6 }],
  ] as const) {
    const availability = buildGeographyAvailability(data, hierarchy, 'contemporary', [dataset], {})
    const branch = mappedBranchForLanguages(
      hierarchy.roots.map(({ id }) => id),
      hierarchy,
      availability,
    ).languageIds
    const variantIds = branch.flatMap((id) => availability.get(id)?.own?.id ?? [])
    const entries = branch.flatMap((id) => {
      const entry = pinMapEntry(id, availability.get(id), 'own', {
        sources: [dataset],
        period: 'contemporary',
      })
      return entry
        ? [{ ...entry, branchRootId: hierarchy.languageById.get(id)?.familyId ?? id }]
        : []
    })
    const selection = parseOverlapSelection(
      mapAreaSelectionKey(resolveMapEntries(entries, data, new Map())),
    )
    const variantId = `${dataset}:contemporary:${language}`
    assert.ok(variantIds.includes(variantId))
    const [result] = await Array.fromAsync(
      computer.computeTiles(
        archive,
        {
          requestId: 1,
          archiveUrl: 'local',
          sourceLayer: 'language_areas',
          variantIds,
          ...selection,
          tiles: [tile],
        },
        () => true,
      ),
    )
    assert.ok(result)
    const encoded = encodeCoverageTile(result)
    for (const target of [
      tile,
      { z: tile.z - 1, x: Math.floor(tile.x / 2), y: Math.floor(tile.y / 2) },
    ])
      for (const buffered of [false, true]) {
        const features = polygons(
          deliveryTile(new Map([[tileKey(tile), encoded]]), target, buffered),
        )
        const feature = features.find(({ properties }) => properties.variantId === variantId)
        assert.ok(feature, `Missing ${language}`)
        let coveredArea = 0
        for (const polygon of feature.geometry) {
          assert.ok(area(polygon[0] ?? []) > 0, `${language} shell winding`)
          for (const hole of polygon.slice(1)) assert.ok(area(hole) < 0)
          coveredArea += polygon.reduce((sum, ring) => sum + area(ring), 0)
        }
        assert.ok(coveredArea > 100_000, `${language} must retain its large mainland polygon`)
      }
  }
})
