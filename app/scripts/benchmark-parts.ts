/** Reproducible engine comparison, using production budgets and local archive data. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { FileSource, PMTiles } from 'pmtiles'
import { buildGeographyAvailability, mapAreaSelectionKey } from '../src/domain/aggregation.ts'
import type { AtlasData, GeometryVariant, Language, TemporalViewId } from '../src/domain/atlas.ts'
import { buildBranchMapEntries } from '../src/domain/branches.ts'
import { buildLanguageHierarchy } from '../src/domain/hierarchy.ts'
import { pinMapEntry, resolveMapEntries } from '../src/domain/mapEntries.ts'
import { OverlapComputer } from '../src/features/map/overlap/compute.ts'
import { createPartsResolver } from '../src/features/map/overlap/coverageParts.ts'
import { encodeCoverageTile } from '../src/features/map/overlap/delivery.ts'
import { OverlapBudgetError } from '../src/features/map/overlap/geometry.ts'
import { tilesForBounds } from '../src/features/map/overlap/tiles.ts'
import {
  type OverlapMetrics,
  type OverlapRequest,
  type OverlapSelection,
  parseOverlapSelection,
} from '../src/features/map/overlap/types.ts'

const directory = new URL('../public/data/', import.meta.url)
const manifest = JSON.parse(await readFile(new URL('manifest.json', directory), 'utf8'))
const languages: Language[] = JSON.parse(
  await readFile(new URL('languages.json', directory), 'utf8'),
)
const variants: GeometryVariant[] = JSON.parse(
  await readFile(new URL('geometry-variants.json', directory), 'utf8'),
)
const data = {
  languages,
  variants,
  languageById: new Map(languages.map((x) => [x.id, x])),
  variantById: new Map(variants.map((x) => [x.id, x])),
} as AtlasData
const hierarchy = buildLanguageHierarchy(languages)
const archive = new PMTiles(
  new FileSource(
    new File([await readFile(new URL(manifest.archive, directory))], manifest.archive),
  ),
)
const parts = createPartsResolver(manifest.coverageParts, variants)
// Node's fetch has no file transport. Keep filesystem timing in the same fetch
// bucket as HTTP; browser benchmarks separately include real source publication.
const networkFetch = globalThis.fetch
globalThis.fetch = async (input, options) => {
  options?.signal?.throwIfAborted()
  const url = new URL(String(input))
  if (url.protocol !== 'file:') return networkFetch(input, options)
  try {
    return new Response(await readFile(url))
  } catch {
    return new Response('', { status: 404 })
  }
}
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
const allRoots = hierarchy.roots.map((x) => x.id)
const branch = (
  dataset: string,
  roots = allRoots,
  remove?: string,
  period: TemporalViewId = 'contemporary',
): OverlapSelection => {
  const context = { sources: [dataset], period }
  const availability = buildGeographyAvailability(
    data,
    hierarchy,
    context.period,
    context.sources,
    {},
  )
  const { entries } = buildBranchMapEntries(roots, hierarchy, availability, context)
  return parseOverlapSelection(
    mapAreaSelectionKey(
      resolveMapEntries(
        entries.filter((e) => e.languageId !== remove),
        data,
        new Map(),
      ),
    ),
  )
}
const aggregate = (dataset: string, id: string): OverlapSelection => {
  const context = { sources: [dataset], period: 'contemporary' as const }
  const availability = buildGeographyAvailability(
    data,
    hierarchy,
    context.period,
    context.sources,
    {},
  )
  const entry = pinMapEntry(id, availability.get(id), 'descendants', context)
  if (!entry) throw new Error(`No aggregate for ${id}`)
  return parseOverlapSelection(mapAreaSelectionKey(resolveMapEntries([entry], data, new Map())))
}
const world = [0, 1].flatMap((x) => [0, 1].map((y) => ({ z: 1, x, y })))
const cases = [
  ...[4, 5, 6, 7, 8].flatMap((zoom) => [
    {
      name: `Asher-Africa-zoom${zoom}`,
      selection: branch('asher2007world'),
      tiles: tilesForBounds({ west: 10, south: 10, east: 10.001, north: 10.001 }, zoom),
    },
    {
      name: `Asher-Asia-zoom${zoom}`,
      selection: branch('asher2007world'),
      tiles: tilesForBounds({ west: 100, south: 30, east: 100.001, north: 30.001 }, zoom),
    },
  ]),
  {
    name: 'Asher-contact-Africa-zoom4',
    selection: branch('asher2007world', allRoots, undefined, 'time-of-contact'),
    tiles: [{ z: 4, x: 8, y: 7 }],
  },
  { name: 'Asher-Europe-full', selection: branch('asher2007world'), tiles: [{ z: 3, x: 4, y: 2 }] },
  {
    name: 'Asher-Halh-branch',
    selection: branch('asher2007world', ['halh1238']),
    tiles: [{ z: 3, x: 6, y: 2 }],
  },
  {
    name: 'Asher-Halh-remove-child',
    selection: branch('asher2007world', ['halh1238'], 'dari1250'),
    tiles: [{ z: 3, x: 6, y: 2 }],
  },
  {
    name: 'Asher-Abkhaz-aggregate',
    selection: aggregate('asher2007world', 'abkh1242'),
    tiles: [{ z: 3, x: 4, y: 2 }],
  },
  { name: 'DLAC-region-full', selection: branch('dlac1987china'), tiles: [{ z: 3, x: 6, y: 3 }] },
  {
    name: 'DLAC-Sinitic-branch',
    selection: branch('dlac1987china', ['sini1245']),
    tiles: [{ z: 3, x: 6, y: 3 }],
  },
  {
    name: 'DLAC-Sino-Tibetan-aggregate',
    selection: aggregate('dlac1987china', 'sino1245'),
    tiles: [{ z: 3, x: 6, y: 3 }],
  },
  { name: 'Asher-world-full', selection: branch('asher2007world'), tiles: world },
  {
    name: 'Asher-world-remove-child',
    selection: branch('asher2007world', allRoots, 'dari1250'),
    tiles: world,
  },
]
const results = []
for (const scenario of cases)
  for (const engine of ['live', 'parts'] as const) {
    const config = parts(scenario.selection.variantIds)
    if (engine === 'parts' && !config) throw new Error('Run npm run precompute:parts first')
    const computer = new OverlapComputer()
    for (let run = 0; run < 3; run++) {
      const profile = metrics()
      const start = performance.now()
      let bytes = 0,
        features = 0,
        encodeMs = 0,
        failure: string | undefined
      const request: OverlapRequest = {
        requestId: run + 1,
        archiveUrl: new URL(manifest.archive, directory).href,
        sourceLayer: manifest.vectorLayer,
        ...scenario.selection,
        tiles: scenario.tiles,
        ...(engine === 'parts' && config ? { parts: config } : {}),
      }
      try {
        for await (const tile of computer.computeTiles(archive, request, () => true, profile)) {
          const encoding = performance.now()
          const encoded = encodeCoverageTile(tile)
          encodeMs += performance.now() - encoding
          bytes += encoded.data.byteLength
          features += encoded.features
        }
      } catch (error) {
        failure = error instanceof OverlapBudgetError ? error.reason : String(error)
      }
      const result = {
        name: scenario.name,
        engine,
        run,
        selected: scenario.selection.variantIds.length,
        ms: performance.now() - start,
        encodeMs,
        bytes,
        features,
        failure,
        metrics: profile,
      }
      results.push(result)
      process.stdout.write(
        `${scenario.name} ${engine} ${run}: ${Math.round(result.ms)} ms${failure ? ` (${failure})` : ''}\n`,
      )
      if (failure) break
    }
  }
const output = new URL('../test-results/coverage-parts/', import.meta.url)
await mkdir(output, { recursive: true })
await writeFile(
  new URL('engine.json', output),
  JSON.stringify({ manifest, node: process.version, results }, null, 2),
)
