/** Offline dataset-palette experiment. Does not alter shipped defaults/assets. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { gzipSync } from 'node:zlib'
import { buildGeographyAvailability, mapAreaSelectionKey } from '../../src/domain/aggregation.ts'
import { buildBranchMapEntries } from '../../src/domain/branches.ts'
import { optimizeColors } from '../../src/domain/colorOptimization.ts'
import { buildColorTopology } from '../../src/domain/colors.ts'
import { buildLanguageHierarchy } from '../../src/domain/hierarchy.ts'
import { resolveMapEntries } from '../../src/domain/mapEntries.ts'
import {
  branchCoverageSignature,
  decodePrecomputedTile,
} from '../../src/features/map/overlap/precomputed.ts'
import { parseOverlapSelection } from '../../src/features/map/overlap/types.ts'
import { polygonCells } from '../lib/colorGrid.mjs'

const { values } = parseArgs({
  options: {
    input: { type: 'string', default: 'test-results/color-integrated' },
    output: { type: 'string', default: 'test-results/color-precomputation' },
  },
})
const output = resolve(values.output)
await mkdir(output, { recursive: true })
const read = async (path) => JSON.parse(await readFile(path, 'utf8'))
const save = async (path, value) => writeFile(resolve(output, path), JSON.stringify(value))
const hydrate = (input) => {
  for (const key of ['parentById', 'childrenById', 'mappedLeafCount'])
    input.topology[key] = new Map(input.topology[key])
  for (const key of ['colors', 'anchors', 'rootById'])
    input.reference[key] = new Map(input.reference[key])
  return input
}
const serialize = (result, reference) => ({
  colors: Object.fromEntries([...reference.colors, ...result.colors]),
  anchors: Object.fromEntries([
    ...reference.anchors,
    ...[...result.regions].map(([id, r]) => [id, r.anchor]),
  ]),
})
const policyHash = createHash('sha256')
for (const name of [
  'colorOptimization',
  'colorBranches',
  'colorHierarchy',
  'colorSpatial',
  'familyColors',
  'colors',
])
  policyHash.update(await readFile(`src/domain/${name}.ts`))
policyHash.update(await readFile('scripts/lib/colorGrid.mjs'))
policyHash.update(await readFile('scripts/color-precomputation/run.mjs'))
const report = {
  policyHash: policyHash.digest('hex'),
  catalogHash: createHash('sha256')
    .update(await readFile('public/data/languages.json'))
    .update(await readFile('public/data/geometry-variants.json'))
    .digest('hex'),
  node: process.version,
  variants: ['default', 'live', 'captured-world', 'geometry-32', 'geometry-64', 'multi-view'],
  builds: [],
  applications: [],
}
const inputs = {},
  live = {}
for (const scene of ['dlac', 'asher', 'asher-world']) {
  const raw = await readFile(resolve(values.input, `${scene}-input.json`), 'utf8')
  await writeFile(resolve(output, `${scene}-input.json`), raw)
  inputs[scene] = hydrate(JSON.parse(raw))
  const start = performance.now()
  live[scene] = optimizeColors(inputs[scene])
  report.builds.push({
    name: `live-${scene}`,
    ms: performance.now() - start,
    inputHash: createHash('sha256').update(raw).digest('hex'),
  })
  await save(`live-${scene}-palette.json`, serialize(live[scene], inputs[scene].reference))
  await save(`default-${scene}-palette.json`, {
    colors: Object.fromEntries(inputs[scene].reference.colors),
    anchors: Object.fromEntries(inputs[scene].reference.anchors),
  })
  console.log(`live ${scene}`, report.builds.at(-1).ms)
}
const languages = await read('public/data/languages.json'),
  variants = await read('public/data/geometry-variants.json'),
  manifest = await read('public/data/manifest.json')
const hierarchy = buildLanguageHierarchy(languages),
  topology = buildColorTopology(hierarchy)
const data = {
  languages,
  variants,
  languageById: new Map(languages.map((x) => [x.id, x])),
  variantById: new Map(variants.map((x) => [x.id, x])),
}
for (const [dataset, scene, scenes] of [
  ['dlac1987china', 'dlac', ['dlac']],
  ['asher2007world', 'asher-world', ['asher', 'asher-world']],
]) {
  const input = inputs[scene]
  assert.deepEqual(
    [...topology.parentById],
    [...input.topology.parentById],
    'Capture/catalog mismatch',
  )
  const context = { sources: [dataset], period: 'contemporary' }
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
  const coverageHash = createHash('sha256'),
    tiles = []
  for (let x = 0; x < 8; x++)
    for (let y = 0; y < 8; y++) {
      const bytes = await readFile(
        `public/data/${manifest.branchCoverage.directory}${signature}/3-${x}-${y}.pbf`,
      )
      coverageHash.update(bytes)
      tiles.push(decodePrecomputedTile(bytes, { z: 3, x, y }))
    }
  const palettes = { 'captured-world': serialize(live[scene], input.reference) }
  for (const size of [32, 64]) {
    const started = performance.now(),
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
    const all = [...occupied.values()].flatMap((set) => [...set])
    const x0 = Math.min(...all.map((c) => c % size)),
      x1 = Math.max(...all.map((c) => c % size))
    const y0 = Math.min(...all.map((c) => Math.floor(c / size))),
      y1 = Math.max(...all.map((c) => Math.floor(c / size)))
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
    const rasterMs = performance.now() - started,
      solveStart = performance.now()
    const result = optimizeColors({ ...input, view })
    palettes[`geometry-${size}`] = serialize(result, input.reference)
    report.builds.push({
      name: `${dataset}-geometry-${size}`,
      rasterMs,
      ms: performance.now() - solveStart,
      columns,
      rows,
      footprints: view.footprints.length,
      selectedLanguages: new Set(
        selection.variantIds.map((id) => data.variantById.get(id)?.languageId),
      ).size,
      unsampledLanguages: [
        ...new Set(selection.variantIds.map((id) => data.variantById.get(id)?.languageId)),
      ].filter((id) => !occupied.get(id)?.size),
      signature,
    })
    await save(`${dataset}-${size}-view.json`, view)
    console.log(report.builds.at(-1))
  }
  // One immutable palette, not a camera-dependent switch. This deliberately
  // tests the risk of stitching regional detail into global family regions.
  const base = palettes['geometry-64']
  const target = inputs[scenes[0]]
  const started = performance.now()
  const regional = optimizeColors({
    ...target,
    reference: {
      ...target.reference,
      colors: new Map(Object.entries(base.colors)),
      anchors: new Map(Object.entries(base.anchors)),
    },
    configuration: { ...target.configuration, anchors: base.anchors },
  })
  const visible = new Set(target.view.footprints.map((f) => f.languageId))
  const patched = { ...base.colors }
  for (const [id, color] of regional.colors) if (visible.has(id)) patched[id] = color
  palettes['multi-view'] = { colors: patched, anchors: base.anchors }
  report.builds.push({
    name: `${dataset}-regional-patch`,
    ms: performance.now() - started,
    patchedLanguages: visible.size,
  })
  for (const [id, region] of regional.regions)
    assert.equal(region.anchor, base.anchors[id], 'Anchor drift')
  for (const [name, palette] of Object.entries(palettes)) {
    const artifact = JSON.stringify({
      version: 1,
      experimental: true,
      policyHash: report.policyHash,
      catalogHash: report.catalogHash,
      dataset,
      period: 'contemporary',
      signature,
      palette,
    })
    const times = []
    // Parse + Map construction only; excludes disk/network and rendering.
    for (let i = 0; i < 21; i++) {
      const start = performance.now()
      const decoded = JSON.parse(artifact)
      const colors = new Map(Object.entries(decoded.palette.colors))
      assert.equal(colors.size, Object.keys(palette.colors).length)
      times.push(performance.now() - start)
    }
    report.applications.push({
      dataset,
      name,
      bytes: Buffer.byteLength(artifact),
      gzipBytes: gzipSync(artifact).length,
      medianParseMs: times.sort((a, b) => a - b)[10],
      coverageHash: coverageHash.copy().digest('hex'),
    })
    await writeFile(resolve(output, `${dataset}-${name}.json`), artifact)
    for (const target of scenes) {
      assert.ok(
        inputs[target].view.footprints.every((f) => palette.colors[f.languageId]),
        'Incomplete visible palette',
      )
      await save(`${name}-${target}-palette.json`, palette)
    }
  }
}
await save('benchmark.json', report)
