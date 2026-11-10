/** Build geometry-64 defaults from prepared branch tiles, without browser captures. */
import assert from 'node:assert/strict'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { buildLanguageSearchIndex } from '../src/domain/catalog.ts'
import { decodeDatasetMetadata } from '../src/domain/datasetMetadata.ts'
import {
  buildGlobalColorInput,
  buildGlobalColorModel,
  optimizeGlobalColors,
} from '../src/domain/globalColors.ts'
import { colorCatalogHash, PREPARED_COLOR_POLICY, sha256 } from '../src/domain/preparedColors.ts'

const check = process.argv.includes('--check')
const directory = new URL('../public/data/', import.meta.url)
const read = async (name) => JSON.parse(await readFile(new URL(name, directory), 'utf8'))
const manifest = await read('manifest.json')
assert.ok(manifest.branchCoverage?.maxZoom >= 3, 'Run precompute:branches first')
const languages = await read('languages.json'),
  variants = await read(manifest.geometryIndex ?? 'geometry-variants.json')
const catalogHash = await colorCatalogHash(languages, variants)
const data = {
  manifest,
  palettes: new Map(),
  datasets: await read('geography-datasets.json'),
  languageSearchIndex: buildLanguageSearchIndex(languages),
  languages,
  variants,
  languageById: new Map(languages.map((x) => [x.id, x])),
  variantById: new Map(variants.map((x) => [x.id, x])),
}
const model = buildGlobalColorModel(data)
const metadata = {
  colorPolicy: PREPARED_COLOR_POLICY,
  catalogHash,
  coverageDirectory: manifest.branchCoverage.directory,
  datasets: data.datasets.map((dataset) => ({ ...dataset, profiles: [] })),
}
const contexts = new Map(
  variants.map((v) => [
    `${v.datasetId}/${v.temporalCoverage.viewId}`,
    {
      id: `${v.datasetId}/${v.temporalCoverage.viewId}`,
      datasetId: v.datasetId,
      viewId: v.temporalCoverage.viewId,
    },
  ]),
)
for (const [id, context] of [...contexts].sort(([a], [b]) => a.localeCompare(b))) {
  const started = performance.now()
  const { input, coverageSignature: signature } = await buildGlobalColorInput(
    data,
    context,
    (path) => readFile(new URL(path, directory)),
    model,
  )
  const result = optimizeGlobalColors(input, context)
  const dataset = metadata.datasets.find((dataset) => dataset.id === context.datasetId)
  assert.ok(dataset, `Missing dataset description: ${context.datasetId}`)
  dataset.profiles.push({
    viewId: context.viewId,
    coverageSignature: signature,
    colors: languages.map(({ id }) => {
      const color = result.colors.get(id)
      assert.ok(color, `Missing color: ${id}`)
      return color
    }),
  })
  console.log(
    `${id}: ${input.view.footprints.length} sampled languoids, ${Math.round(performance.now() - started)} ms`,
  )
}
// Validate the exact metadata contract used by the browser before publishing anything.
await decodeDatasetMetadata(metadata, languages, variants, manifest)
const text = JSON.stringify(metadata)
const file = `dataset-metadata/${await sha256(text)}.json`
if (check) {
  assert.equal(manifest.datasetMetadata, file, 'Dataset metadata does not match canonical defaults')
  assert.equal(await readFile(new URL(file, directory), 'utf8'), text)
  console.log('All full-dataset solves exactly match the installed dataset metadata.')
  process.exit(0)
}
await mkdir(new URL('dataset-metadata/', directory), { recursive: true })
await writeFile(new URL(`${file}.tmp`, directory), text)
await rename(new URL(`${file}.tmp`, directory), new URL(file, directory))
// Publish the complete dataset metadata with one manifest update, after every profile succeeds.
delete manifest.preparedColors
manifest.datasetMetadata = file
await writeFile(new URL('manifest.colors.tmp', directory), JSON.stringify(manifest))
await rename(new URL('manifest.colors.tmp', directory), new URL('manifest.json', directory))
console.log(`Published dataset descriptions and palettes: ${Buffer.byteLength(text)} bytes`)
