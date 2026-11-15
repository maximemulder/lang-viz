import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createStore } from 'jotai/vanilla'
import {
  createAdministrativeLoader,
  indexAdministrative,
} from '../src/features/administrative/repository.ts'
import {
  searchFamilies,
  searchLanguages,
  searchTerritories,
  selectFamily,
  selectLanguage,
  selectTerritory,
  selectTerritoryMetric,
} from '../src/features/administrative/selectors.ts'
import {
  administrativeLoadStateAtom,
  administrativeRepositoryAtom,
  administrativeSessionAtom,
  focusAdministrativeTerritoryAtom,
  loadAdministrativeAtom,
  selectAdministrativeAtom,
  setAdministrativeMetricAtom,
} from '../src/features/administrative/state.ts'
import { mapCameraIntentAtom } from '../src/state/mapCameraIntent.ts'

const fixture = () => ({
  schemaVersion: 2,
  manifest: {
    sourceBranchCommit: 'a'.repeat(40),
    cldrRelease: null,
    cldrSourceFile: null,
    producerRevision: `sha256:${'b'.repeat(64)}`,
    joinedCsv: { sha256: 'c'.repeat(64), bytes: 100 },
    glottolog: { sha256: 'd'.repeat(64), bytes: 100, commit: 'e'.repeat(40) },
    attribution: [{ name: 'Source', sourceUrl: 'https://example.org', license: 'test' }],
    coverage: {
      observationCount: 3,
      territoryCount: 2,
      sourceLanguageCount: 2,
      glottocodeCount: 1,
      familyCount: 1,
    },
  },
  territories: [
    { code: 'AA', unContainmentCodes: '', population: '100', gdpUsd: '200', literacyPercent: '90' },
    { code: 'BB', unContainmentCodes: '', population: '80', gdpUsd: '100', literacyPercent: '70' },
  ],
  languageAssociations: ['en', 'en_Latn'].map((sourceLanguageCode) => ({
    sourceLanguageCode,
    glottocode: 'test1234',
    matchMethod: 'source_join_verified_against_pinned_glottolog',
    glottologLevel: 'language',
    glottologLanguageParentId: null,
    iso6393: 'eng',
    name: 'Test language',
    familyId: 'fami1234',
    macroareas: ['Europe'],
    latitude: null,
    longitude: null,
    glottologCountries: [],
  })),
  atlasAssociations: [
    { glottocode: 'test1234', status: 'unresolved', matchMethod: null, atlasLanguageId: null },
  ],
  families: [{ id: 'fami1234', name: 'Example family' }],
  observations: [
    {
      territoryCode: 'AA',
      sourceLanguageCode: 'en',
      populationPercent: '80',
      speakerCount: '80',
      officialStatus: 'official',
      languageLiteracyPercent: null,
      languageWritingPercent: null,
    },
    {
      territoryCode: 'AA',
      sourceLanguageCode: 'en_Latn',
      populationPercent: '80',
      speakerCount: '80',
      officialStatus: 'unspecified',
      languageLiteracyPercent: null,
      languageWritingPercent: null,
    },
    {
      territoryCode: 'BB',
      sourceLanguageCode: 'en',
      populationPercent: '50',
      speakerCount: '40',
      officialStatus: 'unspecified',
      languageLiteracyPercent: null,
      languageWritingPercent: null,
    },
  ],
})

test('administrative selectors keep source rows, overlapping shares, and sums labeled as estimates', () => {
  const repository = indexAdministrative(fixture())
  assert.equal(selectTerritory(repository, 'AA')?.overlappingPercentages, true)
  assert.deepEqual(
    selectTerritory(repository, 'AA')?.observations.map(
      (row) => row.observation.sourceLanguageCode,
    ),
    ['en', 'en_Latn'],
  )
  assert.equal(selectLanguage(repository, 'en')?.sumOfReportedEstimates, 120)
  assert.equal(selectFamily(repository, 'fami1234')?.sumOfReportedEstimates, 200)
  assert.equal(selectFamily(repository, 'fami1234')?.familyName, 'Example family')
  assert.deepEqual(
    searchFamilies(repository, 'Example').map((family) => family.id),
    ['fami1234'],
  )
  assert.equal(
    selectTerritoryMetric(repository, 'AA', { kind: 'family-estimate', familyId: 'fami1234' }),
    160,
  )
  assert.equal(
    selectTerritoryMetric(repository, 'BB', {
      kind: 'language-estimate',
      sourceLanguageCode: 'en_Latn',
    }),
    null,
  )
  assert.equal(selectTerritoryMetric(repository, 'AA', { kind: 'territory-literacy' }), 90)
  assert.deepEqual(
    searchTerritories(repository, 'Alpha', (territory) =>
      territory.code === 'AA' ? 'Alpha' : 'Beta',
    ).map((row) => row.code),
    ['AA'],
  )
  assert.deepEqual(
    searchLanguages(repository, 'Latn').map((row) => row.sourceLanguageCode),
    ['en_Latn'],
  )
})

test('repository rejects broken joins, repeated rows, bad counts, and unsupported versions', () => {
  for (const change of [
    (data: ReturnType<typeof fixture>) => {
      data.schemaVersion = 1
    },
    (data: ReturnType<typeof fixture>) => {
      const first = data.observations[0]
      if (first) first.territoryCode = 'XX'
    },
    (data: ReturnType<typeof fixture>) => {
      const second = data.observations[1]
      if (second) second.sourceLanguageCode = 'en'
    },
    (data: ReturnType<typeof fixture>) => {
      data.manifest.coverage.observationCount = 4
    },
    (data: ReturnType<typeof fixture>) => {
      const first = data.atlasAssociations[0]
      if (first) first.glottocode = 'bad'
    },
    (data: ReturnType<typeof fixture>) => {
      const first = data.observations[0]
      if (first) first.populationPercent = '101'
    },
  ]) {
    const data = fixture()
    change(data)
    assert.throws(() => indexAdministrative(data), /Invalid administrative supplement/)
  }
})

test('loader shares success, retries a failure, and isolates administrative state from camera intent', async () => {
  let requests = 0
  const load = createAdministrativeLoader(async () => {
    requests++
    if (requests === 1) return new Response('<html>missing</html>')
    return Response.json(fixture())
  })
  const first = load()
  assert.strictEqual(first, load())
  await assert.rejects(first, /not installed/)
  const repository = await load()
  assert.strictEqual(await load(), repository)
  assert.equal(requests, 2)

  const store = createStore()
  const originalIntent = { other: 'language' }
  store.set(mapCameraIntentAtom, originalIntent)
  await store.set(loadAdministrativeAtom, () => Promise.reject(new Error('Missing supplement')))
  assert.deepEqual(store.get(administrativeLoadStateAtom), {
    status: 'error',
    message: 'Missing supplement',
  })
  assert.strictEqual(store.get(mapCameraIntentAtom), originalIntent)
  await store.set(loadAdministrativeAtom, () => Promise.resolve(repository))
  assert.equal(store.get(administrativeLoadStateAtom).status, 'ready')
  assert.strictEqual(store.get(mapCameraIntentAtom), originalIntent)
  assert.equal(store.set(selectAdministrativeAtom, { kind: 'territory', id: 'AA' }), true)
  assert.equal(store.set(selectAdministrativeAtom, { kind: 'territory', id: 'XX' }), false)
  assert.equal(
    store.set(setAdministrativeMetricAtom, { kind: 'language-estimate', sourceLanguageCode: 'en' }),
    true,
  )
  assert.equal(store.get(administrativeSessionAtom).selection?.id, 'AA')
  assert.strictEqual(store.get(mapCameraIntentAtom), originalIntent)
  assert.equal(store.set(focusAdministrativeTerritoryAtom, 'XX'), false)
  assert.equal(store.set(focusAdministrativeTerritoryAtom, 'AA'), true)
  assert.deepEqual(store.get(mapCameraIntentAtom), { territoryCode: 'AA', requestId: 1 })
  assert.ok(store.get(administrativeRepositoryAtom))
})
