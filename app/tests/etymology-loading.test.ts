import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createEtymologyLoader } from '../src/data/etymologyRepository.ts'
import { prepareEtymology } from '../src/data/prepareEtymology.ts'
import { validateEtymologyData } from '../src/domain/etymologyValidation.ts'
import { explorerRepository } from './fixtures/explorer.ts'

test('browser validator accepts the compiled contract, including zero coordinates', () => {
  const { data } = explorerRepository()
  validateEtymologyData(data)
})

test('malformed or incompatible bundles fail before indexing', () => {
  // biome-ignore lint/suspicious/noExplicitAny: Deliberately construct invalid runtime payloads.
  const mutate = (edit: (data: Record<string, any>) => void) => {
    const data = structuredClone(explorerRepository().data)
    edit(data)
    assert.throws(() => validateEtymologyData(data), /Invalid word-history data/)
  }
  for (const value of [null, [], {}, { schemaVersion: 2 }])
    assert.throws(() => validateEtymologyData(value), /Invalid word-history data/)
  mutate((data) => {
    data.provenance.adapterVersion = 2
  })
  mutate((data) => {
    data.provenance.inputs = [{ name: 'x', sha256: 'bad', metadata: {} }]
  })
  mutate((data) => {
    data.languages['41500'].lat = 91
  })
  mutate((data) => {
    data.languages['41500'].lat = null
  })
  mutate((data) => {
    data.languages['41500'].time = { From: 2, Until: 1 }
  })
  mutate((data) => {
    data.lexemes['69562'].l = '999'
  })
  mutate((data) => {
    data.lexemes['69562'].refs = [{ FkSourceId: 9 }]
  })
  mutate((data) => {
    data.lexemes['69562'].f = null
  })
  mutate((data) => {
    data.edges[0].p = '999'
  })
  mutate((data) => {
    data.edges[0].t = 99
  })
  mutate((data) => {
    data.edges.push(data.edges[0])
  })
  mutate((data) => {
    data.concepts['3090'].groups[0].list = '999'
  })
  mutate((data) => {
    data.concepts['3090'].lexemes = ['999']
  })
  mutate((data) => {
    data.lists.push(data.lists[0])
  })
})

test('loader shares concurrent requests and caches a successful validated repository', async () => {
  let resolve!: (response: Response) => void
  let requests = 0
  const load = createEtymologyLoader(() => {
    requests++
    return new Promise((done) => {
      resolve = done
    })
  })
  const first = load()
  assert.strictEqual(load(), first)
  resolve(Response.json(explorerRepository().data))
  const repository = await first
  assert.ok(repository.index.incoming.get('69562'))
  assert.strictEqual(await load(), repository)
  assert.equal(requests, 1)
})

test('HTTP, parse, validation, and network errors are retryable without replacing a ready repository', async () => {
  for (const failure of [
    () => Promise.resolve(new Response('', { status: 503 })),
    () => Promise.resolve(new Response('<html>not JSON</html>')),
    () => Promise.resolve(Response.json({ schemaVersion: 1 })),
    () => Promise.reject(new Error('offline')),
  ]) {
    let requests = 0
    const load = createEtymologyLoader(() =>
      ++requests === 1 ? failure() : Promise.resolve(Response.json(explorerRepository().data)),
    )
    await assert.rejects(load())
    assert.ok((await load()).data.lexemes['69562'])
    assert.equal(requests, 2)
  }
})

test('transferred bytes prepare a repository with linked Map indexes', () => {
  const bytes = new TextEncoder().encode(JSON.stringify(explorerRepository().data)).buffer
  const { repository, timings } = prepareEtymology(bytes)
  assert.strictEqual(repository.index.incoming.get('69562')?.[0], repository.data.edges[0])
  assert.deepEqual(repository.index.byLanguage.get('2'), ['69421'])
  assert.ok(Object.values(timings).every((duration) => duration >= 0))
})

test('asynchronous preparation failure is shared and retryable', async () => {
  let preparations = 0
  let reject!: (reason: Error) => void
  const expected = explorerRepository()
  const load = createEtymologyLoader(
    async () => Response.json(expected.data),
    async () => {
      preparations++
      if (preparations === 1)
        return new Promise((_, fail) => {
          reject = fail
        })
      return expected
    },
  )
  const first = load()
  assert.strictEqual(first, load())
  await new Promise((done) => setImmediate(done))
  const rejected = assert.rejects(first, /worker stopped/)
  reject(new Error('worker stopped'))
  await rejected
  assert.strictEqual(await load(), expected)
  assert.equal(preparations, 2)
})
