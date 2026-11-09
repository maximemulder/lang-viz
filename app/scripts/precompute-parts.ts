/** Selection-independent, sparse coverage for each dataset and period. */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { FileSource, PMTiles } from 'pmtiles'
import type { AtlasManifest, GeometryVariant } from '../src/domain/atlas.ts'
import { OverlapComputer } from '../src/features/map/overlap/compute.ts'
import { encodeCoverageTile } from '../src/features/map/overlap/delivery.ts'
import { archiveTiles } from './lib/archiveTiles.ts'
import { mergePartsManifest } from './lib/partsManifest.ts'

const { values } = parseArgs({
  options: {
    'data-dir': { type: 'string' },
    'max-zoom': { type: 'string' },
    dataset: { type: 'string', multiple: true },
    period: { type: 'string', multiple: true },
  },
})
const requestedZoom = values['max-zoom'] === undefined ? undefined : Number(values['max-zoom'])
if (
  requestedZoom !== undefined &&
  (!Number.isInteger(requestedZoom) || requestedZoom < 0 || requestedZoom > 8)
)
  throw new Error('--max-zoom must be an integer from 0 to 8')
const directory = values['data-dir']
  ? pathToFileURL(`${resolve(values['data-dir'])}/`)
  : new URL('../public/data/', import.meta.url)
const manifestUrl = new URL('manifest.json', directory)
const manifest: AtlasManifest = JSON.parse(await readFile(manifestUrl, 'utf8'))
if (manifest.geometryBuild?.kind === 'shared-coverage') {
  const root = new URL('../../', import.meta.url)
  const localPython = new URL('.venv/bin/python', root)
  const python = existsSync(localPython) ? fileURLToPath(localPython) : 'python3'
  const result = spawnSync(
    python,
    [
      '-m',
      'pipeline.atlas.topology_build',
      '--restore-parts',
      '--output',
      fileURLToPath(directory),
      ...(values.dataset?.flatMap((dataset) => ['--dataset', dataset]) ?? []),
      ...(values.period?.flatMap((period) => ['--period', period]) ?? []),
      ...(requestedZoom === undefined ? [] : ['--max-zoom', String(requestedZoom)]),
    ],
    { cwd: fileURLToPath(root), stdio: 'inherit' },
  )
  if (result.error) throw result.error
  process.exit(result.status ?? 1)
}
const variants: GeometryVariant[] = JSON.parse(
  await readFile(new URL('geometry-variants.json', directory), 'utf8'),
)
const bytes = await readFile(new URL(manifest.archive, directory))
const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 20)
const outputDirectory = `coverage-parts/v2-${hash}/`
const profiles = [
  ...new Map(
    variants
      .filter(
        (v) =>
          (!values.dataset || values.dataset.includes(v.datasetId)) &&
          (!values.period || values.period.includes(v.temporalCoverage.viewId)),
      )
      .map((v) => [
        JSON.stringify([v.datasetId, v.temporalCoverage.viewId]),
        {
          id: `${v.datasetId}/${v.temporalCoverage.viewId}`,
          datasetId: v.datasetId,
          viewId: v.temporalCoverage.viewId,
        },
      ]),
  ).values(),
]
if (!profiles.length) throw new Error('No matching dataset/period profiles')
const started = performance.now()
let generatedBytes = 0
for (const profile of profiles) {
  const output = new URL(`${outputDirectory}${profile.id}/`, directory)
  await mkdir(output, { recursive: true })
  const source = manifest.geometryProfiles?.find(
    (p) => p.datasetId === profile.datasetId && p.viewId === profile.viewId,
  )
  const archiveName = source?.archive ?? manifest.archive
  const archive = new PMTiles(
    new FileSource(
      new File([source ? await readFile(new URL(archiveName, directory)) : bytes], archiveName),
    ),
  )
  // Use the same policy for every dataset and period: cover every source level
  // the client can request, unless the caller explicitly limits preparation.
  const maxZoom = Math.min(requestedZoom ?? 8, (await archive.getHeader()).maxZoom, 8)
  const computer = new OverlapComputer(true)
  const variantIds = variants
    .filter(
      (v) => v.datasetId === profile.datasetId && v.temporalCoverage.viewId === profile.viewId,
    )
    .map((v) => v.id)
    .sort()
  const tiles: Record<string, string[]> = {}
  const sourceTiles = await archiveTiles(archive, maxZoom)
  for (let z = 0; z <= maxZoom; z++) {
    const zoomStarted = performance.now()
    tiles[String(z)] = []
    for (const tile of sourceTiles.filter((t) => t.z === z)) {
      const name = `${tile.z}-${tile.x}-${tile.y}.pbf`
      const target = new URL(name, output)
      let data: Uint8Array | undefined
      try {
        data = await readFile(target)
      } catch {}
      if (!data) {
        for await (const result of computer.computeTiles(
          archive,
          {
            requestId: 1,
            archiveUrl: fileURLToPath(new URL(archiveName, directory)),
            sourceLayer: manifest.vectorLayer,
            variantIds,
            tiles: [tile],
          },
          () => true,
        ))
          data = encodeCoverageTile(result).data
        if (!data) throw new Error(`No result for ${profile.id}/${name}`)
        // Empty tiles live only in the complete-level index, never as tiny files.
        if (data.byteLength) {
          const temporary = new URL(`${name}.tmp`, output)
          await writeFile(temporary, data)
          await rename(temporary, target)
        }
      }
      if (data.byteLength) {
        tiles[String(tile.z)]?.push(`${tile.x}-${tile.y}`)
        generatedBytes += data.byteLength
      }
    }
    // Publish each complete zoom atomically. A failed later level cannot discard
    // intermediate coverage; a lower-detail rerun cannot downgrade existing data.
    const indexBytes = JSON.stringify(tiles)
    const indexHash = createHash('sha256').update(indexBytes).digest('hex').slice(0, 20)
    const tileIndex = `${profile.id}/index-${indexHash}.json`
    const indexUrl = new URL(`${outputDirectory}${tileIndex}`, directory)
    const temporaryIndex = new URL(`${outputDirectory}${tileIndex}.tmp`, directory)
    await writeFile(temporaryIndex, indexBytes)
    await rename(temporaryIndex, indexUrl)
    const latest: AtlasManifest = JSON.parse(await readFile(manifestUrl, 'utf8'))
    const coverageParts = mergePartsManifest(latest.coverageParts, outputDirectory, [
      { ...profile, maxZoom: z, tileIndex },
    ])
    const temporary = new URL('manifest.parts.tmp', directory)
    await writeFile(temporary, JSON.stringify({ ...latest, coverageParts }))
    await rename(temporary, manifestUrl)
    process.stdout.write(
      `${profile.id}: zoom ${z}, ${tiles[String(z)]?.length ?? 0} nonempty tiles, ${Math.round(performance.now() - zoomStarted)} ms\n`,
    )
  }
}
process.stdout.write(
  `${profiles.length} profiles, ${generatedBytes} bytes, ${Math.round(performance.now() - started)} ms\n`,
)
