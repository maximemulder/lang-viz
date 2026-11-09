/** Benchmark the app optimizer on saved captures; optionally require exact replay. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { optimizeColors } from '../../src/domain/colorOptimization.ts'

const { values } = parseArgs({
  options: {
    input: { type: 'string', default: 'test-results/color-integrated' },
    output: { type: 'string', default: 'test-results/color-performance' },
    reference: { type: 'string' },
    rounds: { type: 'string', default: '3' },
  },
})
const rounds = Number(values.rounds)
assert.ok(Number.isInteger(rounds) && rounds > 0)
const output = resolve(values.output)
await mkdir(output, { recursive: true })
const report = { node: process.version, rounds, scenes: [] }
const serialize = (value) => JSON.stringify(value, (_, v) => (v instanceof Map ? [...v] : v))
for (const scene of ['dlac', 'asher', 'asher-world']) {
  const raw = await readFile(resolve(values.input, `${scene}-input.json`), 'utf8')
  const input = JSON.parse(raw)
  for (const key of ['parentById', 'childrenById', 'mappedLeafCount'])
    input.topology[key] = new Map(input.topology[key])
  for (const key of ['colors', 'anchors', 'rootById'])
    input.reference[key] = new Map(input.reference[key])
  const reference = values.reference
    ? JSON.parse(await readFile(resolve(values.reference, `${scene}.json`), 'utf8'))
    : undefined
  const times = []
  let first
  for (let round = 0; round < rounds; round++) {
    const capture =
      round % 2
        ? {
            ...input,
            view: {
              ...input.view,
              footprints: [...input.view.footprints]
                .reverse()
                .map((footprint) => ({ ...footprint, cells: [...footprint.cells].reverse() })),
            },
          }
        : input
    const started = performance.now()
    const result = optimizeColors(capture)
    times.push(performance.now() - started)
    const snapshot = JSON.parse(serialize(result))
    if (reference) assert.deepEqual(snapshot, reference, `${scene}: changed optimizer output`)
    if (first) assert.deepEqual(snapshot, first, `${scene}: nondeterministic output`)
    first = snapshot
  }
  await writeFile(resolve(output, `${scene}.json`), JSON.stringify(first))
  const entry = {
    scene,
    inputSha256: createHash('sha256').update(raw).digest('hex'),
    milliseconds: times,
    medianMs: [...times].sort((a, b) => a - b)[Math.floor(times.length / 2)],
  }
  report.scenes.push(entry)
  console.log(JSON.stringify(entry))
}
await writeFile(resolve(output, 'benchmark.json'), JSON.stringify(report, null, 2))
