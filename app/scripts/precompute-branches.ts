/** Materialize branch policies from reusable coverage, with legacy archive fallback. */
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { FileSource, PMTiles } from 'pmtiles'
import { buildGeographyAvailability, mapAreaSelectionKey } from '../src/domain/aggregation.ts'
import type { AtlasData, GeometryVariant, Language } from '../src/domain/atlas.ts'
import { buildBranchMapEntries } from '../src/domain/branches.ts'
import { buildColorTopology } from '../src/domain/colors.ts'
import { buildLanguageHierarchy } from '../src/domain/hierarchy.ts'
import { resolveMapEntries } from '../src/domain/mapEntries.ts'
import { OverlapComputer } from '../src/features/map/overlap/compute.ts'
import { CoverageParts, createPartsResolver } from '../src/features/map/overlap/coverageParts.ts'
import { encodeCoverageTile } from '../src/features/map/overlap/delivery.ts'
import { branchCoverageSignature } from '../src/features/map/overlap/precomputed.ts'
import { parseOverlapSelection } from '../src/features/map/overlap/types.ts'

const { values } = parseArgs({
  options: { 'data-dir': { type: 'string' }, 'max-zoom': { type: 'string' } },
})
const directory = values['data-dir']
  ? pathToFileURL(`${resolve(values['data-dir'])}/`)
  : new URL('../public/data/', import.meta.url)
const languages: Language[] = JSON.parse(
  await readFile(new URL('languages.json', directory), 'utf8'),
)
const variants: GeometryVariant[] = JSON.parse(
  await readFile(new URL('geometry-variants.json', directory), 'utf8'),
)
const manifest = JSON.parse(await readFile(new URL('manifest.json', directory), 'utf8'))
const data = {
  languages,
  variants,
  languageById: new Map(languages.map((x) => [x.id, x])),
  variantById: new Map(variants.map((x) => [x.id, x])),
} as AtlasData
const hierarchy = buildLanguageHierarchy(languages)
const topology = buildColorTopology(hierarchy)
const bytes = await readFile(new URL(manifest.archive, directory))
const archiveHash = createHash('sha256').update(bytes).digest('hex').slice(0, 20)
const archive = new PMTiles(new FileSource(new File([bytes], manifest.archive)))
const computer = new OverlapComputer(true)
const parts = new CoverageParts()
const resolveParts = createPartsResolver(manifest.coverageParts, variants)
// Prepared branch views are materialized membership policies over the same
// reusable parts. Node needs a file transport for those browser fetch calls.
const networkFetch = globalThis.fetch
globalThis.fetch = async (input, options) => {
  const url = new URL(String(input))
  if (url.protocol !== 'file:') return networkFetch(input, options)
  options?.signal?.throwIfAborted()
  try {
    return new Response(await readFile(url))
  } catch {
    return new Response('', { status: 404 })
  }
}
// Low zoom is the expensive, common whole-dataset case. Regional views stay live.
const maxZoom = values['max-zoom'] === undefined ? 3 : Number(values['max-zoom'])
if (!Number.isInteger(maxZoom) || maxZoom < 0 || maxZoom > 3)
  throw new Error('--max-zoom must be an integer from 0 to 3')
const outputDirectory = `branch-coverage/v2-${archiveHash}/`
const signatures: string[] = []
const profiles = new Map(variants.map((v) => [`${v.datasetId}/${v.temporalCoverage.viewId}`, v]))
for (const [label, variant] of profiles) {
  const context = { sources: [variant.datasetId], period: variant.temporalCoverage.viewId }
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
  if (!signature) throw new Error('Offline branch selection must use own source areas')
  const reusable = resolveParts(selection.variantIds)
  if (
    manifest.geometryBuild?.kind === 'shared-coverage' &&
    (!reusable || reusable.maxZoom < maxZoom)
  )
    throw new Error(`Build canonical parts through zoom ${maxZoom} before preparing ${label}`)
  const output = new URL(`${outputDirectory}${signature}/`, directory)
  await mkdir(output, { recursive: true })
  const started = performance.now()
  for (let z = 0; z <= maxZoom; z++)
    for (let x = 0; x < 2 ** z; x++)
      for (let y = 0; y < 2 ** z; y++) {
        const tile = { z, x, y }
        const target = new URL(`${z}-${x}-${y}.pbf`, output)
        // Existing tiles can be reused only under this exact archive and policy signature.
        try {
          await readFile(target)
          continue
        } catch {}
        const request = {
          requestId: 1,
          archiveUrl: new URL(manifest.archive, directory).href,
          sourceLayer: manifest.vectorLayer,
          ...selection,
          tiles: [tile],
          ...(reusable ? { parts: reusable } : {}),
        }
        const prepared = reusable ? await parts.resolve(request, tile) : null
        if (manifest.geometryBuild?.kind === 'shared-coverage' && !prepared)
          throw new Error(`Canonical parts unavailable for ${label}/${z}-${x}-${y}`)
        const results = prepared ? [prepared] : computer.computeTiles(archive, request, () => true)
        for await (const result of results) {
          await writeFile(new URL(`${z}-${x}-${y}.tmp`, output), encodeCoverageTile(result).data)
          await rename(new URL(`${z}-${x}-${y}.tmp`, output), target)
        }
      }
  signatures.push(signature)
  process.stdout.write(
    `${label}: ${entries.length} entries, zooms 0–${maxZoom}, ${Math.round(performance.now() - started)} ms\n`,
  )
}
manifest.branchCoverage = {
  directory: outputDirectory,
  maxZoom: Math.max(
    maxZoom,
    manifest.branchCoverage?.directory === outputDirectory ? manifest.branchCoverage.maxZoom : 0,
  ),
  signatures,
}
await writeFile(new URL('manifest.branches.tmp', directory), JSON.stringify(manifest))
await rename(new URL('manifest.branches.tmp', directory), new URL('manifest.json', directory))
// Discard superseded policies only after the replacement manifest is complete.
// These directories contain generated tiles, never source data.
const profilesDirectory = new URL(outputDirectory, directory)
for (const name of await readdir(profilesDirectory))
  if (/^[a-f0-9]{64}$/.test(name) && !signatures.includes(name))
    await rm(new URL(`${name}/`, profilesDirectory), { recursive: true })
