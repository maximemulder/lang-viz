import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createStore } from 'jotai/vanilla'
import { createWalsLoader } from '../src/data/walsRepository.ts'
import { validateWalsData } from '../src/domain/walsValidation.ts'
import {
  loadWalsAtom,
  walsActionAtom,
  walsLoadStateAtom,
  walsRepositoryAtom,
  walsSessionAtom,
} from '../src/features/wals/state.ts'
import { explorerSessionAtom } from '../src/state/explorerState.ts'
import { languagePanelAtom } from '../src/state/languageControls.ts'
import { mapCameraIntentAtom } from '../src/state/mapCameraIntent.ts'
import { walsData } from './fixtures/wals.ts'

test('WALS validates and indexes zero coordinates, citations, missingness, and unobserved records', async () => {
  const repository = await createWalsLoader(async () => Response.json(walsData()))()
  assert.deepEqual(repository.data.records.ird?.coordinates, [0, 0])
  assert.equal(repository.data.records.orphan?.coordinates, null)
  assert.equal(repository.index.bySource.get('empty')?.size, 0)
  assert.equal(repository.index.bySource.get('ird')?.get('12A'), '12A-ird')
  assert.deepEqual(repository.index.byGlottocode.get('iris1253'), ['ird', 'iri'])
  assert.deepEqual(repository.index.byIso.get('gle'), ['ird', 'iri'])
  assert.ok(repository.index.byFeature.get('12A')?.includes('12A-ird'))
  assert.ok(repository.index.byCategory.get('12A-1')?.includes('12A-ird'))
  assert.deepEqual(repository.data.observations['12A-ird']?.references, [
    { sourceId: 'Grammar', pages: '4–9' },
  ])
})

test('WALS rejects malformed structure, foreign keys, versions, categories, evidence, and unsafe URLs', () => {
  for (const value of [null, [], {}, { schemaVersion: 2 }])
    assert.throws(() => validateWalsData(value), /Invalid WALS data/)
  // biome-ignore lint/suspicious/noExplicitAny: Malformed runtime payloads are the subject of this test.
  const edits: ((data: any) => void)[] = [
    (d) => {
      d.adapterVersion = 2
    },
    (d) => {
      d.provenance.commit = 'bad'
    },
    (d) => {
      d.provenance.files['test.csv'].sha256 = 'bad'
    },
    (d) => {
      d.provenance.files['test.csv'].bytes = -1
    },
    (d) => {
      d.provenance.license = 'javascript:alert(1)'
    },
    (d) => {
      d.sourceNotices.errata = null
    },
    (d) => {
      d.records.ird.name = null
    },
    (d) => {
      d.records.ird.iso6393 = 1
    },
    (d) => {
      d.records.ird.glottocode = ''
    },
    (d) => {
      d.records.ird.isoCodes = [null]
    },
    (d) => {
      d.records.ird.coordinates = [0]
    },
    (d) => {
      d.records.ird.coordinates = [181, 0]
    },
    (d) => {
      d.records.ird.coordinates = [0, 91]
    },
    (d) => {
      d.records.ird.coordinates = [0, Number.NaN]
    },
    (d) => {
      d.records.ird.coordinates = [null, 0]
    },
    (d) => {
      d.records['family-fake'] = d.records.ird
    },
    (d) => {
      d.features['12A'].chapterTitle = null
    },
    (d) => {
      d.features['12A'].references = [{ sourceId: 'missing', pages: '' }]
    },
    (d) => {
      d.categories['12A-1'].featureId = 'missing'
    },
    (d) => {
      d.categories['12A-1'].number = 0
    },
    (d) => {
      d.categories.duplicate = d.categories['12A-1']
    },
    (d) => {
      d.categories['12A-1'].number = 1.5
    },
    (d) => {
      d.observations['12A-ird'].categoryId = '81A-1'
    },
    (d) => {
      d.observations['12A-ird'].sourceId = 'missing'
    },
    (d) => {
      d.observations['12A-ird'].featureId = 'missing'
    },
    (d) => {
      d.observations['12A-ird'].categoryId = 'missing'
    },
    (d) => {
      d.observations.duplicate = d.observations['12A-ird']
    },
    (d) => {
      d.observations['12A-ird'].references[0].pages = 3
    },
    (d) => {
      d.observations['12A-ird'].exampleIds = ['missing']
    },
    (d) => {
      d.observations['12A-ird'].url = 'javascript:alert(1)'
    },
    (d) => {
      d.references.Grammar.fields.title = null
    },
    (d) => {
      d.references.Grammar.type = null
    },
    (d) => {
      d.examples.ex.sourceId = 'missing'
    },
    (d) => {
      d.examples.ex.gloss = null
    },
    (d) => {
      d.diagnostics.counts.bad = -1
    },
    (d) => {
      d.diagnostics.observationsByFeature.missing = 1
    },
    (d) => {
      d.diagnostics.missingCoordinates[0].sourceId = 'iri'
    },
    (d) => {
      d.diagnostics.referencesWithoutTitle = ['missing']
    },
  ]
  for (const edit of edits) {
    const data = structuredClone(walsData())
    edit(data)
    assert.throws(() => validateWalsData(data), /Invalid WALS data/, edit.toString())
  }
})

test('WALS shares in-flight work and successful results, including synchronous request failures', async () => {
  let done!: (response: Response) => void
  let count = 0
  const load = createWalsLoader(() => {
    count++
    return new Promise((resolve) => {
      done = resolve
    })
  })
  const first = load()
  assert.strictEqual(first, load())
  await Promise.resolve()
  done(Response.json(walsData()))
  const repository = await first
  assert.strictEqual(await load(), repository)
  assert.equal(count, 1)
  let requests = 0
  const retry = createWalsLoader(() => {
    if (++requests === 1) throw new Error('sync failure')
    return Promise.resolve(Response.json(walsData()))
  })
  await assert.rejects(retry(), /sync failure/)
  assert.ok((await retry()).data.records.ird)
})

test('WALS HTTP, JSON, schema and network failures are shared and retryable', async () => {
  for (const failure of [
    () => Promise.resolve(new Response('', { status: 503 })),
    () => Promise.resolve(new Response('<html>missing</html>')),
    () => Promise.resolve(Response.json({ schemaVersion: 1 })),
    () => Promise.reject(new Error('offline')),
  ]) {
    let count = 0
    const load = createWalsLoader(() =>
      ++count === 1 ? failure() : Promise.resolve(Response.json(walsData())),
    )
    const first = load()
    assert.strictEqual(first, load())
    await assert.rejects(first)
    assert.ok((await load()).index.bySource.has('ird'))
    assert.equal(count, 2)
  }
})

test('late completion cannot rewrite navigation; stores share data work but isolate sessions/loading', async () => {
  let done!: (response: Response) => void
  const load = createWalsLoader(
    () =>
      new Promise((resolve) => {
        done = resolve
      }),
  )
  const a = createStore()
  const b = createStore()
  const first = a.set(loadWalsAtom, load)
  assert.strictEqual(a.set(loadWalsAtom, load), first)
  const second = b.set(loadWalsAtom, load)
  a.set(walsActionAtom, { type: 'select-variety', profileId: 'atlas:irish', sourceId: 'ird' })
  a.set(walsActionAtom, {
    type: 'inspect',
    sourceId: 'ird',
    featureId: '12A',
    profileId: 'atlas:irish',
  })
  const session = a.get(walsSessionAtom)
  const camera = {}
  a.set(mapCameraIntentAtom, camera)
  const explorer = a.get(explorerSessionAtom)
  const panel = a.get(languagePanelAtom)
  await Promise.resolve()
  await Promise.resolve()
  done(Response.json(walsData()))
  await Promise.all([first, second])
  assert.strictEqual(a.get(walsSessionAtom), session)
  assert.strictEqual(a.get(mapCameraIntentAtom), camera)
  assert.strictEqual(a.get(explorerSessionAtom), explorer)
  assert.strictEqual(a.get(languagePanelAtom), panel)
  assert.strictEqual(a.get(walsRepositoryAtom), b.get(walsRepositoryAtom))
  assert.equal(b.get(walsSessionAtom).profiles.size, 0)
  assert.equal(a.get(walsLoadStateAtom).status, 'ready')
  const c = createStore()
  assert.equal(c.get(walsLoadStateAtom).status, 'idle')
  assert.equal(c.get(walsRepositoryAtom), null)
})

test('store loading failures stay local and expose a retry without resetting choices', async () => {
  const a = createStore()
  const b = createStore()
  a.set(walsActionAtom, { type: 'select-variety', profileId: 'profile', sourceId: 'ird' })
  const session = a.get(walsSessionAtom)
  await a.set(loadWalsAtom, async () => {
    throw new Error('offline')
  })
  assert.deepEqual(a.get(walsLoadStateAtom), { status: 'error', message: 'offline' })
  assert.equal(b.get(walsLoadStateAtom).status, 'idle')
  await a.set(
    loadWalsAtom,
    createWalsLoader(async () => Response.json(walsData())),
  )
  assert.equal(a.get(walsLoadStateAtom).status, 'ready')
  assert.strictEqual(a.get(walsSessionAtom), session)
})
