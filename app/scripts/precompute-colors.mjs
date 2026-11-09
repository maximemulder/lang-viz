/** Build geometry-64 defaults from prepared branch tiles, without browser captures. */
import assert from 'node:assert/strict'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { buildGeographyAvailability, mapAreaSelectionKey } from '../src/domain/aggregation.ts'
import { buildBranchMapEntries } from '../src/domain/branches.ts'
import { optimizeColors } from '../src/domain/colorOptimization.ts'
import {
  buildColorTopology,
  buildSemanticPalette,
  DEFAULT_COLOR_CONFIGURATION,
} from '../src/domain/colors.ts'
import { buildLanguageHierarchy } from '../src/domain/hierarchy.ts'
import { resolveMapEntries } from '../src/domain/mapEntries.ts'
import { colorCatalogHash, PREPARED_COLOR_POLICY, sha256 } from '../src/domain/preparedColors.ts'
import {
  branchCoverageSignature,
  decodePrecomputedTile,
} from '../src/features/map/overlap/precomputed.ts'
import { parseOverlapSelection } from '../src/features/map/overlap/types.ts'
import { polygonCells } from './lib/colorGrid.mjs'

const directory = new URL('../public/data/', import.meta.url)
const read = async (name) => JSON.parse(await readFile(new URL(name, directory), 'utf8'))
const manifest = await read('manifest.json')
assert.ok(manifest.branchCoverage?.maxZoom >= 3, 'Run precompute:branches first')
const languages = await read('languages.json'),
  variants = await read(manifest.geometryIndex ?? 'geometry-variants.json')
const hierarchy = buildLanguageHierarchy(languages),
  topology = buildColorTopology(hierarchy)
const reference = buildSemanticPalette(hierarchy, topology)
const catalogHash = await colorCatalogHash(languages, variants)
const data = {
  languages,
  variants,
  languageById: new Map(languages.map((x) => [x.id, x])),
  variantById: new Map(variants.map((x) => [x.id, x])),
}
const profiles = []
const contexts = new Map(
  variants.map((v) => [
    `${v.datasetId}/${v.temporalCoverage.viewId}`,
    { sources: [v.datasetId], period: v.temporalCoverage.viewId },
  ]),
)
for (const [id, context] of [...contexts].sort(([a], [b]) => a.localeCompare(b))) {
  const started = performance.now()
  const availability = buildGeographyAvailability(
    data,
    hierarchy,
    context.period,
    context.sources,
    {},
  )
  const { entries } = buildBranchMapEntries(
    hierarchy.roots.map((x) => x.id),
    hierarchy,
    availability,
    context,
    topology,
  )
  const selection = parseOverlapSelection(
    mapAreaSelectionKey(resolveMapEntries(entries, data, new Map())),
  )
  const signature = await branchCoverageSignature(selection)
  assert.ok(manifest.branchCoverage.signatures.includes(signature), 'Run precompute:branches first')
  const tiles = []
  for (let x = 0; x < 8; x++)
    for (let y = 0; y < 8; y++) {
      const bytes = await readFile(
        new URL(`${manifest.branchCoverage.directory}${signature}/3-${x}-${y}.pbf`, directory),
      )
      tiles.push(decodePrecomputedTile(bytes, { z: 3, x, y }))
    }
  const size = 64,
    occupied = new Map()
  for (const tile of tiles)
    for (const feature of tile.features) {
      const cells = new Set()
      for (const polygon of feature.geometry.coordinates) {
        const rings = polygon.map((ring) =>
          ring.map(([x, y]) => [
            ((tile.tile.x + x / tile.extent) * size) / 8,
            ((tile.tile.y + y / tile.extent) * size) / 8,
          ]),
        )
        for (const cell of polygonCells(rings, size, size)) cells.add(cell)
      }
      for (const id of feature.properties.variantIds) {
        const languageId = data.variantById.get(id)?.languageId
        assert.ok(languageId)
        const set = occupied.get(languageId) ?? new Set()
        for (const cell of cells) set.add(cell)
        occupied.set(languageId, set)
      }
    }
  // Trim empty ocean margins for compact datasets. Coordinates remain Mercator.
  let x0 = size,
    x1 = -1,
    y0 = size,
    y1 = -1
  for (const cells of occupied.values())
    for (const cell of cells) {
      const x = cell % size,
        y = Math.floor(cell / size)
      x0 = Math.min(x0, x)
      x1 = Math.max(x1, x)
      y0 = Math.min(y0, y)
      y1 = Math.max(y1, y)
    }
  assert.ok(x1 >= x0 && y1 >= y0, `No prepared geometry for ${id}`)
  const columns = x1 - x0 + 1,
    rows = y1 - y0 + 1
  const view = {
    columns,
    rows,
    footprints: [...occupied]
      .filter(([, cells]) => cells.size)
      .map(([languageId, cells]) => ({
        id: languageId,
        languageId,
        cells: [...cells].map((c) => (Math.floor(c / size) - y0) * columns + (c % size) - x0),
      })),
  }

  const result = optimizeColors({
    topology,
    reference,
    configuration: DEFAULT_COLOR_CONFIGURATION,
    view,
  })
  const text = JSON.stringify({
    policy: PREPARED_COLOR_POLICY,
    profile: id,
    catalogHash,
    colors: Object.fromEntries([...reference.colors, ...result.colors]),
  })
  const hash = await sha256(text)
  const folder = `palettes/${PREPARED_COLOR_POLICY}/${catalogHash.slice(0, 20)}/`
  const file = `${folder}${hash}.json`
  await mkdir(new URL(folder, directory), { recursive: true })
  await writeFile(new URL(`${file}.tmp`, directory), text)
  await rename(new URL(`${file}.tmp`, directory), new URL(file, directory))
  profiles.push({ id, file, sha256: hash, coverageSignature: signature })
  console.log(
    `${id}: ${view.footprints.length} sampled languoids, ${Math.round(performance.now() - started)} ms, ${Buffer.byteLength(text)} bytes`,
  )
}
// Publish only after every profile succeeds. Old content-addressed files remain safe.
manifest.preparedColors = {
  policy: PREPARED_COLOR_POLICY,
  catalogHash,
  coverageDirectory: manifest.branchCoverage.directory,
  profiles,
}
await writeFile(new URL('manifest.colors.tmp', directory), JSON.stringify(manifest))
await rename(new URL('manifest.colors.tmp', directory), new URL('manifest.json', directory))
