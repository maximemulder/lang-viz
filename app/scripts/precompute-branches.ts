/** Prepare exact, same-dataset branch views from the existing simplified archive. */
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
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
import { encodeCoverageTile } from '../src/features/map/overlap/delivery.ts'
import { branchCoverageSignature } from '../src/features/map/overlap/precomputed.ts'
import { parseOverlapSelection } from '../src/features/map/overlap/types.ts'

const directory = new URL('../public/data/', import.meta.url)
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
const rootById = new Map<string, string>()
for (const root of hierarchy.roots) {
  const stack = [root.id]
  while (stack.length) {
    const id = stack.pop()
    if (!id || rootById.has(id)) continue
    rootById.set(id, root.id)
    stack.push(...(hierarchy.childrenById.get(id) ?? []).map((x) => x.id))
  }
}
const bytes = await readFile(new URL(manifest.archive, directory))
const archiveHash = createHash('sha256').update(bytes).digest('hex').slice(0, 20)
const archive = new PMTiles(new FileSource(new File([bytes], manifest.archive)))
const computer = new OverlapComputer(true)
// Low zoom is the expensive, common whole-dataset case. Regional views stay live.
const maxZoom = 3
const outputDirectory = `branch-coverage/${archiveHash}/`
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
  const branch = mappedBranchForLanguages(
    hierarchy.roots.map((x) => x.id),
    hierarchy,
    availability,
  )
  const entries = branch.languageIds.flatMap((id) => {
    const entry = pinMapEntry(id, availability.get(id), 'own', context)
    return entry ? [{ ...entry, branchRootId: rootById.get(id) }] : []
  })
  const selection = parseOverlapSelection(
    mapAreaSelectionKey(resolveMapEntries(entries, data, new Map())),
  )
  const signature = await branchCoverageSignature(selection)
  if (!signature) throw new Error('Offline branch selection must use own source areas')
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
        for await (const result of computer.computeTiles(
          archive,
          {
            requestId: 1,
            archiveUrl: fileURLToPath(new URL(manifest.archive, directory)),
            sourceLayer: manifest.vectorLayer,
            ...selection,
            tiles: [tile],
          },
          () => true,
        )) {
          await writeFile(new URL(`${z}-${x}-${y}.tmp`, output), encodeCoverageTile(result).data)
          await rename(new URL(`${z}-${x}-${y}.tmp`, output), target)
        }
      }
  signatures.push(signature)
  process.stdout.write(
    `${label}: ${entries.length} entries, zooms 0–${maxZoom}, ${Math.round(performance.now() - started)} ms\n`,
  )
}
manifest.branchCoverage = { directory: outputDirectory, maxZoom, signatures }
await writeFile(new URL('manifest.branches.tmp', directory), JSON.stringify(manifest))
await rename(new URL('manifest.branches.tmp', directory), new URL('manifest.json', directory))
// Discard superseded policies only after the replacement manifest is complete.
// These directories contain generated tiles, never source data.
const profilesDirectory = new URL(outputDirectory, directory)
for (const name of await readdir(profilesDirectory))
  if (/^[a-f0-9]{64}$/.test(name) && !signatures.includes(name))
    await rm(new URL(`${name}/`, profilesDirectory), { recursive: true })
