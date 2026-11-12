import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { cpus, platform, release } from 'node:os'
import { dirname, resolve } from 'node:path'
import type { Language } from '../src/domain/atlas.ts'
import { indexWals } from '../src/domain/wals.ts'
import { selectWalsExamples, walsExampleGeometry } from '../src/domain/walsExamples.ts'
import { validateWalsData } from '../src/domain/walsValidation.ts'
import { walsCardFeatures } from '../src/features/wals/cards.ts'
import { associateWals } from '../src/integrations/wals/languageMatching.ts'

// Explicit offline full-snapshot measurements; no downloads or application entry point.
const bytes = readFileSync(new URL('../public/wals/features.json', import.meta.url))
const catalogBytes = readFileSync(new URL('../public/data/languages.json', import.meta.url))
const catalog: Language[] = JSON.parse(catalogBytes.toString())
const samples: Record<string, number[]> = {}
const measure = <T>(name: string, run: () => T): T => {
  const start = performance.now()
  const result = run()
  samples[name] ??= []
  samples[name].push(performance.now() - start)
  return result
}
for (let run = 0; run < 5; run++) {
  const value: unknown = measure('parse', () => JSON.parse(bytes.toString()))
  const validationStart = performance.now()
  validateWalsData(value)
  samples.validate ??= []
  samples.validate.push(performance.now() - validationStart)
  const repository = measure('index', () => indexWals(value))
  measure('associateCompleteCatalog', () => associateWals(repository, catalog))
  measure('firstCardPolicy', () => walsCardFeatures(repository, 'eng'))
  for (let repeat = 0; repeat < 20; repeat++) {
    for (const [source, feature] of [
      ['eng', '81A'],
      ['ird', '12A'],
      ['kyq', '37A'],
      ['aea', '12A'],
      ['mla', '81A'],
    ] as const) {
      measure('cachedCardPolicy', () => walsCardFeatures(repository, source, feature))
      measure(`selectionAndGeometry:${source}:${feature}`, () => {
        const selection = selectWalsExamples(repository, source, feature)
        if (!selection) throw new Error(`Missing published observation ${source}/${feature}`)
        const geometry = walsExampleGeometry(selection)
        if (geometry.features.length > 13) throw new Error('Unbounded overlay')
      })
    }
  }
}
const output = resolve(process.argv[2] ?? 'test-results/wals-07/domain-performance.json')
const report = {
  environment: {
    node: process.version,
    platform: `${platform()} ${release()}`,
    cpu: cpus()[0]?.model,
  },
  inputs: Object.fromEntries(
    (
      [
        ['wals', bytes],
        ['catalog', catalogBytes],
      ] as const
    ).map(([name, body]) => [
      name,
      { bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') },
    ]),
  ),
  units: 'milliseconds; native Node CPU, includes warm-up, no CPU throttling',
  timings: Object.fromEntries(
    Object.entries(samples).map(([name, values]) => {
      const sorted = [...values].sort((a, b) => a - b)
      return [
        name,
        { samples: values, median: sorted[Math.floor(sorted.length / 2)], maximum: sorted.at(-1) },
      ]
    }),
  ),
}
mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`)
console.log(`Wrote full-snapshot domain measurements to ${output}`)
