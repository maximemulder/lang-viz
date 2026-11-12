import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createStore } from 'jotai/vanilla'
import type { Language } from '../../src/domain/atlas.ts'
import { indexWals } from '../../src/domain/wals.ts'
import { validateWalsData } from '../../src/domain/walsValidation.ts'
import { walsRepositoryAtom, walsSessionAtom } from '../../src/features/wals/state.ts'
import { associateWals } from '../../src/integrations/wals/languageMatching.ts'
import {
  inspectWalsObservationAtom,
  walsAtlasCatalogAtom,
  walsInspectionAtom,
} from '../../src/integrations/wals/state.ts'
import { languagePanelAtom } from '../../src/state/languageControls.ts'
import { mapCameraIntentAtom } from '../../src/state/mapCameraIntent.ts'

// Explicit, local full-data check. Not matched by npm test; never downloads or generates data.
const root = fileURLToPath(new URL('../../../', import.meta.url))
const browserDirectory = resolve(process.env.WALS_BROWSER_DATA ?? join(root, 'app/public/wals'))
const releasePin = resolve(process.env.WALS_RELEASE_PIN ?? join(root, 'wals-release.json'))
const bytes = readFileSync(join(browserDirectory, 'features.json'))
const catalogBytes = readFileSync(new URL('../../public/data/languages.json', import.meta.url))
const data: unknown = JSON.parse(bytes.toString())
const start = performance.now()
validateWalsData(data)
const validated = performance.now()
const repository = indexWals(data)
const indexed = performance.now()
const catalog: Language[] = JSON.parse(catalogBytes.toString())
const associations = associateWals(repository, catalog)
const associated = performance.now()

test('WALS release verifies independently and contains the reviewed seven-feature snapshot', () => {
  const result = spawnSync(
    'python3',
    [
      '-m',
      'pipeline.wals.data_release',
      'verify',
      '--pin',
      releasePin,
      '--output',
      browserDirectory,
    ],
    {
      cwd: root,
      encoding: 'utf8',
    },
  )
  assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stdout}\n${result.stderr}`)
  const expected = JSON.parse(
    readFileSync(new URL('../../../pipeline/wals/snapshot.json', import.meta.url), 'utf8'),
  )
  const pin = JSON.parse(readFileSync(releasePin, 'utf8'))
  const sourcePin = JSON.parse(readFileSync(join(root, 'pipeline/wals/sources.json'), 'utf8'))
  assert.deepEqual(
    JSON.parse(readFileSync(join(browserDirectory, 'sources.json'), 'utf8')),
    sourcePin,
  )
  assert.equal(data.provenance.snapshot, pin.snapshot)
  assert.equal(data.provenance.commit, pin.sourceCommit)
  assert.deepEqual(Object.keys(data.features).sort(), [
    '12A',
    '13A',
    '30A',
    '37A',
    '81A',
    '87A',
    '92A',
  ])
  assert.deepEqual(data.diagnostics.counts, expected.counts)
  assert.deepEqual(data.diagnostics.observationsByFeature, expected.observationsByFeature)
  assert.deepEqual(
    Object.fromEntries(
      [...repository.index.byFeature].map(([id, observations]) => [id, observations.length]),
    ),
    expected.observationsByFeature,
  )
  for (const [table, count] of [
    ['records', 'sourceRecords'],
    ['features', 'exportedFeatures'],
    ['categories', 'exportedCategories'],
    ['observations', 'exportedObservations'],
    ['references', 'exportedReferences'],
    ['examples', 'exportedExamples'],
  ] as const)
    assert.equal(Object.keys(data[table]).length, expected.counts[count])
  for (const record of Object.values(data.records))
    assert.equal(Object.hasOwn(record, 'atlasId'), false)
})

/** Reproduce only the reviewed prototype policy, including its language-only ISO lookup. */
const prototype = () => {
  const byGlottocode = new Map(
    catalog
      .filter((l) => l.classification.kind === 'glottolog')
      .map((l) => [l.classification.kind === 'glottolog' ? l.classification.glottocode : '', l]),
  )
  const byIso = new Map<string, Language[]>()
  for (const language of catalog) {
    if (language.iso6393 && language.level === 'language') {
      const values = byIso.get(language.iso6393) ?? []
      values.push(language)
      byIso.set(language.iso6393, values)
    }
  }
  return [...repository.index.bySource.keys()].map((sourceId) => {
    const record = data.records[sourceId]
    assert.ok(record)
    let target = record.glottocode ? byGlottocode.get(record.glottocode) : undefined
    let method = target ? 'glottocode' : 'unmatched'
    const candidates = record.iso6393 ? byIso.get(record.iso6393) : undefined
    if (!target && candidates?.length === 1) {
      target = candidates[0]
      method = 'unique-iso'
    }
    return { sourceId, method, atlasId: target?.id ?? null, level: target?.level ?? null }
  })
}

test('full WALS snapshot: all prior broad/ISO links are reviewed and only Albanian changes target availability', () => {
  const old = prototype()
  const family = old.filter((a) => a.level === 'family')
  const iso = old.filter((a) => a.method === 'unique-iso')
  const changes = old.filter((a) => {
    const current = associations.bySource.get(a.sourceId)
    return a.atlasId !== (current?.status === 'associated' ? current.atlasId : null)
  })
  const report = {
    snapshot: data.provenance.snapshot,
    commit: data.provenance.commit,
    bundleSha256: createHash('sha256').update(bytes).digest('hex'),
    catalogSha256: createHash('sha256').update(catalogBytes).digest('hex'),
    timingsMs: {
      validation: validated - start,
      indexing: indexed - validated,
      association: associated - indexed,
    },
    diagnostics: associations.diagnostics,
    prototypeFamilies: family,
    prototypeIso: iso,
    changes,
    associations: Object.fromEntries(associations.bySource),
  }
  const output = new URL('../../test-results/wals-02/', import.meta.url)
  mkdirSync(output, { recursive: true })
  writeFileSync(new URL('associations.json', output), `${JSON.stringify(report, null, 2)}\n`)
  assert.equal(data.provenance.snapshot, 'wals-v2020.6')
  assert.equal(repository.index.bySource.size, 2662)
  assert.equal(family.length, 37)
  assert.equal(iso.length, 10)
  for (const before of [...family, ...iso]) {
    const current = associations.bySource.get(before.sourceId)
    assert.equal(current?.status, 'associated')
    if (current?.status === 'associated') {
      assert.equal(current.atlasId, before.atlasId, before.sourceId)
      assert.equal(current.method, before.method, before.sourceId)
      assert.equal(current.scope, before.level === 'family' ? 'broader' : 'exact')
      assert.match(current.explanation, /only WALS/)
    }
  }
  assert.deepEqual(
    changes.map((a) => a.sourceId),
    ['alb'],
  )
  const albanian = associations.bySource.get('alb')
  assert.equal(albanian?.status, 'associated')
  if (albanian?.status === 'associated') {
    assert.equal(albanian.method, 'unique-iso')
    assert.equal(albanian.atlasId, 'alba1267')
    assert.equal(albanian.scope, 'broader')
  }
  assert.deepEqual(associations.diagnostics.status, { associated: 2656, unmatched: 6 })
  assert.deepEqual(associations.diagnostics.method, { glottocode: 2645, 'unique-iso': 11 })
  assert.deepEqual(associations.diagnostics.level, { language: 2572, dialect: 46, family: 38 })
})

test('full WALS snapshot: Donegal, Kyuquot and Eastern Aleut inspection never substitutes the default record', () => {
  const store = createStore()
  store.set(walsRepositoryAtom, repository)
  store.set(walsAtlasCatalogAtom, catalog)
  for (const [sourceId, featureId, defaultId, profileId] of [
    ['ird', '12A', 'iri', 'iris1253'],
    ['kyq', '37A', 'nuu', 'nuuc1236'],
    ['aea', '12A', 'ale', 'aleu1260'],
  ] as const) {
    assert.equal(repository.index.bySource.get(defaultId)?.has(featureId), false)
    assert.equal(store.set(inspectWalsObservationAtom, { sourceId, featureId }), true)
    assert.deepEqual(store.get(walsSessionAtom).profiles.get(profileId), { sourceId, featureId })
    assert.equal(store.get(walsInspectionAtom)?.observationId, `${featureId}-${sourceId}`)
    assert.equal(store.get(languagePanelAtom).detailId, profileId)
    assert.equal(store.get(mapCameraIntentAtom), null)
  }
})
