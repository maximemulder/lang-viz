/** Selection-independent, disjoint coverage with all original source memberships. */
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { FileSource, PMTiles } from 'pmtiles'
import type { AtlasManifest, GeometryVariant } from '../src/domain/atlas.ts'
import { OverlapComputer } from '../src/features/map/overlap/compute.ts'
import { encodeCoverageTile } from '../src/features/map/overlap/delivery.ts'

const { values } = parseArgs({
  options: {
    'max-zoom': { type: 'string', default: '3' },
    dataset: { type: 'string', multiple: true },
  },
})
const maxZoom = Number(values['max-zoom'])
if (!Number.isInteger(maxZoom) || maxZoom < 0 || maxZoom > 8)
  throw new Error('--max-zoom must be an integer from 0 to 8')
const directory = new URL('../public/data/', import.meta.url)
const manifest: AtlasManifest = JSON.parse(
  await readFile(new URL('manifest.json', directory), 'utf8'),
)
const variants: GeometryVariant[] = JSON.parse(
  await readFile(new URL('geometry-variants.json', directory), 'utf8'),
)
const bytes = await readFile(new URL(manifest.archive, directory))
const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 20)
// Version independently of branch policies: these assets never hide ancestors.
const outputDirectory = `coverage-parts/v1-${hash}/`
const archive = new PMTiles(new FileSource(new File([bytes], manifest.archive)))
const computer = new OverlapComputer(true)
const profiles = [
  ...new Map(
    variants
      .filter((v) => !values.dataset || values.dataset.includes(v.datasetId))
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
if (!profiles.length) throw new Error('No matching dataset profiles')
const started = performance.now()
let generatedBytes = 0
for (const profile of profiles) {
  const output = new URL(`${outputDirectory}${profile.id}/`, directory)
  await mkdir(output, { recursive: true })
  const variantIds = variants
    .filter(
      (v) => v.datasetId === profile.datasetId && v.temporalCoverage.viewId === profile.viewId,
    )
    .map((v) => v.id)
    .sort()
  for (let z = 0; z <= maxZoom; z++) {
    const zoomStarted = performance.now()
    for (let x = 0; x < 2 ** z; x++)
      for (let y = 0; y < 2 ** z; y++) {
        const target = new URL(`${z}-${x}-${y}.pbf`, output)
        try {
          generatedBytes += (await readFile(target)).byteLength
          continue
        } catch {}
        for await (const result of computer.computeTiles(
          archive,
          {
            requestId: 1,
            archiveUrl: fileURLToPath(new URL(manifest.archive, directory)),
            sourceLayer: manifest.vectorLayer,
            variantIds,
            tiles: [{ z, x, y }],
          },
          () => true,
        )) {
          const data = encodeCoverageTile(result).data
          const temporary = new URL(`${z}-${x}-${y}.tmp`, output)
          await writeFile(temporary, data)
          await rename(temporary, target)
          generatedBytes += data.byteLength
        }
      }
    process.stdout.write(
      `${profile.id}: zoom ${z}, ${Math.round(performance.now() - zoomStarted)} ms\n`,
    )
  }
}
// Publish only complete profiles; interrupted generation leaves the old manifest usable.
await writeFile(
  new URL('manifest.parts.tmp', directory),
  JSON.stringify({
    ...manifest,
    coverageParts: { directory: outputDirectory, maxZoom, profiles },
  }),
)
await rename(new URL('manifest.parts.tmp', directory), new URL('manifest.json', directory))
process.stdout.write(
  `${profiles.length} profiles, ${generatedBytes} bytes, ${Math.round(performance.now() - started)} ms\n`,
)
