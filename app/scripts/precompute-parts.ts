/** Restore prepared coverage from the shared canonical/LOD caches. */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import type { AtlasManifest } from '../src/domain/atlas.ts'

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
if (manifest.geometryBuild?.kind !== 'shared-coverage')
  throw new Error('Rebuild atlas data with python -m pipeline.atlas.build before restoring parts')
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
