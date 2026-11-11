import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createStore } from 'jotai/vanilla'
import {
  createExplorerSession,
  type ExplorerAction,
  isCurrentTrailFocus,
  reduceExplorerSession,
  resolveExplorerSession,
} from '../src/domain/explorerSession.ts'
import { etymologyRepositoryAtom } from '../src/state/etymologyData.ts'
import {
  atlasWordTrailAtom,
  explorerActionAtom,
  explorerSessionAtom,
  resolvedExplorerAtom,
  wordTrailAtom,
} from '../src/state/explorerState.ts'
import { explorerRepository } from './fixtures/explorer.ts'

const english = {
  name: 'English',
  classification: { kind: 'glottolog', glottocode: 'stan1293' },
} as const
const configuredSession = () => {
  const actions: ExplorerAction[] = [
    { type: 'trace', id: '69562' },
    { type: 'trail-options', depth: 6, branches: false, placeholders: true },
    { type: 'expand', id: '69421' },
    { type: 'select', selection: { kind: 'edge', id: '1' } },
    { type: 'comparison', conceptId: '1001', collectionId: '1' },
    { type: 'comparison-filter', family: 'Family', includeMissing: true },
    { type: 'search', query: 'saved', languageId: '41500' },
  ]
  return actions.reduce(reduceExplorerSession, createExplorerSession())
}

test('workspace round trips preserve all exploration settings and evidence', () => {
  const before = configuredSession()
  const geography = reduceExplorerSession(before, { type: 'workspace', workspace: 'geography' })
  const after = reduceExplorerSession(geography, { type: 'workspace', workspace: 'etymology' })
  assert.deepEqual(after, before)
  assert.equal(after.trail, before.trail)
  assert.equal(after.comparison, before.comparison)
  assert.equal(after.search, before.search)
  assert.equal(after.selection, before.selection)
})

test('tracing resets word-specific evidence, expansion, discovery, and comparison only', () => {
  const before = configuredSession()
  const after = reduceExplorerSession(before, { type: 'trace', id: '38213' })
  assert.equal(after.trail.root, '38213')
  assert.equal(after.trail.depth, 6)
  assert.equal(after.trail.placeholders, true)
  assert.deepEqual([...after.trail.expanded], [])
  assert.deepEqual(after.selection, { kind: 'word', id: '38213' })
  assert.deepEqual(after.search, { query: '', languageId: null, atlasTarget: null })
  assert.equal(after.view, 'history')
  assert.equal(after.comparison.conceptId, null)
  assert.equal(after.comparison.collectionId, null)
  assert.equal(after.comparison.family, 'Family')
  assert.equal(after.comparison.includeMissing, true)
  assert.equal(before.trail.root, '69562')
})

test('graph and overlay share one derived trail, following changes until cleared', () => {
  const store = createStore()
  const send = (action: ExplorerAction) => store.set(explorerActionAtom, action)
  store.set(etymologyRepositoryAtom, explorerRepository())
  send({ type: 'trace', id: '69562' })
  send({ type: 'trail-options', branches: false })
  const graph = store.get(wordTrailAtom)
  assert.equal(store.get(atlasWordTrailAtom), null)
  send({ type: 'show-trail' })
  assert.equal(store.get(wordTrailAtom), graph)
  assert.equal(store.get(atlasWordTrailAtom), graph)
  send({ type: 'expand', id: '69421' })
  assert.equal(store.get(atlasWordTrailAtom), store.get(wordTrailAtom))
  assert.deepEqual(store.get(wordTrailAtom)?.ids, ['69562', '69421', '69470'])
  send({ type: 'trace', id: '38213' })
  assert.deepEqual(store.get(atlasWordTrailAtom)?.ids, ['38213'])
  send({ type: 'clear-overlay' })
  assert.equal(store.get(atlasWordTrailAtom), null)
  assert.deepEqual(store.get(wordTrailAtom)?.ids, ['38213'])
})

test('store state survives UI subscriptions disappearing; separate stores remain independent', () => {
  const first = createStore(),
    second = createStore()
  const unsubscribe = first.sub(explorerSessionAtom, () => {})
  first.set(explorerActionAtom, { type: 'trace', id: '69562' })
  unsubscribe()
  assert.equal(first.get(explorerSessionAtom).trail.root, '69562')
  assert.equal(second.get(explorerSessionAtom).trail.root, null)
})

test('comparison selection overrides root defaults, survives switching, and reports incompatible scopes', () => {
  const repository = explorerRepository()
  const root = reduceExplorerSession(createExplorerSession(), { type: 'trace', id: '69562' })
  assert.equal(resolveExplorerSession(root, repository).conceptId, '3090')
  const collection = reduceExplorerSession(root, { type: 'comparison', collectionId: '1' })
  assert.equal(resolveExplorerSession(collection, repository).conceptId, '1001')
  const chosen = reduceExplorerSession(collection, { type: 'comparison', conceptId: '3090' })
  assert.match(resolveExplorerSession(chosen, repository).issues.join(), /not in collection/)
  const compatible = reduceExplorerSession(chosen, {
    type: 'comparison',
    collectionId: '3',
    conceptId: '3090',
  })
  assert.deepEqual(resolveExplorerSession(compatible, repository).issues, [])
  const repeated = reduceExplorerSession(compatible, { type: 'comparison', collectionId: '3' })
  assert.equal(repeated.comparison.conceptId, '3090')
})

test('unknown URL IDs remain visible as errors and never select an unrelated default word', () => {
  const state = reduceExplorerSession(createExplorerSession(), {
    type: 'restore-route',
    route: {
      workspace: 'etymology',
      word: '9999',
      view: 'family',
      concept: '9998',
      collection: '9997',
    },
  })
  const resolved = resolveExplorerSession(state, explorerRepository())
  assert.equal(state.trail.root, '9999')
  assert.equal(resolved.conceptId, '9998')
  assert.equal(resolved.collectionId, '9997')
  assert.ok(resolved.issues.some((issue) => issue === 'Unknown word: 9999'))
  assert.ok(resolved.issues.some((issue) => issue === 'Unknown concept: 9998'))
  assert.ok(resolved.issues.some((issue) => issue === 'Unknown collection: 9997'))
})

test('language navigation resolves unique exact metadata and keeps unmatched/ambiguous searches usable', () => {
  const state = reduceExplorerSession(configuredSession(), {
    type: 'language-words',
    target: english,
  })
  const repository = explorerRepository()
  assert.equal(state.trail.root, '69562')
  assert.equal(state.search.query, '')
  assert.equal(resolveExplorerSession(state, repository).languageId, '41500')
  assert.equal(resolveExplorerSession(state, repository).languageMatch, 'exact')
  const englishRecord = repository.data.languages['41500']
  assert.ok(englishRecord)
  const ambiguous = {
    ...repository,
    data: {
      ...repository.data,
      languages: {
        ...repository.data.languages,
        '9': englishRecord,
      },
    },
  }
  assert.equal(resolveExplorerSession(state, ambiguous).languageId, null)
  assert.equal(resolveExplorerSession(state, ambiguous).languageMatch, 'ambiguous')
  const source = reduceExplorerSession(state, {
    type: 'language-words',
    target: {
      name: 'Source-defined',
      classification: { kind: 'source', datasetId: 'source', label: 'Label', note: '' },
    },
  })
  assert.equal(resolveExplorerSession(source, repository).languageMatch, 'unmatched')
  const edited = reduceExplorerSession(state, { type: 'search', query: 'new text' })
  assert.equal(resolveExplorerSession(edited, repository).languageId, '41500')
  const unscoped = reduceExplorerSession(edited, { type: 'search', languageId: null })
  assert.equal(resolveExplorerSession(unscoped, repository).languageMatch, null)
  assert.equal(resolveExplorerSession(unscoped, repository).languageId, null)
})

test('a delayed repository result cannot override newer word, comparison, or language navigation', async () => {
  const store = createStore()
  let complete!: (repository: ReturnType<typeof explorerRepository>) => void
  const pending = new Promise<ReturnType<typeof explorerRepository>>((resolve) => {
    complete = resolve
  }).then((repository) => store.set(etymologyRepositoryAtom, repository))
  store.set(explorerActionAtom, { type: 'language-words', target: english })
  store.set(explorerActionAtom, { type: 'trace', id: '38213' })
  store.set(explorerActionAtom, { type: 'comparison', conceptId: '1001', collectionId: '1' })
  const before = store.get(explorerSessionAtom)
  complete(explorerRepository())
  await pending
  assert.equal(store.get(explorerSessionAtom), before)
  assert.equal(store.get(resolvedExplorerAtom)?.languageId, null)
  assert.equal(store.get(resolvedExplorerAtom)?.conceptId, '1001')
  assert.deepEqual(store.get(wordTrailAtom)?.ids, ['38213'])
})

test('data arriving after a newer language request resolves only the current scope', async () => {
  const store = createStore()
  let complete!: (repository: ReturnType<typeof explorerRepository>) => void
  const pending = new Promise<ReturnType<typeof explorerRepository>>((resolve) => {
    complete = resolve
  }).then((repository) => store.set(etymologyRepositoryAtom, repository))
  store.set(explorerActionAtom, { type: 'language-words', target: english })
  store.set(explorerActionAtom, {
    type: 'language-words',
    target: {
      name: 'Latin',
      classification: { kind: 'glottolog', glottocode: 'lati1261' },
    },
  })
  store.set(explorerActionAtom, { type: 'search', query: 'typed while loading' })
  store.set(explorerActionAtom, { type: 'workspace', workspace: 'geography' })
  complete(explorerRepository())
  await pending
  assert.equal(store.get(resolvedExplorerAtom)?.languageId, '2')
  assert.equal(store.get(explorerSessionAtom).search.query, 'typed while loading')
  assert.equal(store.get(explorerSessionAtom).workspace, 'geography')
})

test('delayed map focus is cancelled by newer trail, navigation, clearing, or focus requests', async () => {
  for (const action of [
    { type: 'trace', id: '38213' },
    { type: 'clear-overlay' },
    { type: 'workspace', workspace: 'etymology' },
    { type: 'trail-options', depth: 6 },
    { type: 'select', selection: { kind: 'word', id: '69421' } },
    { type: 'view', view: 'family' },
    { type: 'comparison', conceptId: '1001' },
    { type: 'show-trail' },
  ] satisfies ExplorerAction[]) {
    let state = reduceExplorerSession(createExplorerSession(), { type: 'trace', id: '69562' })
    state = reduceExplorerSession(state, { type: 'show-trail' })
    const request = state.overlay.focusRequest
    assert.ok(request)
    assert.ok(isCurrentTrailFocus(state, request))
    let complete!: () => void
    const ready = new Promise<void>((resolve) => {
      complete = resolve
    })
    let moved = false
    const pending = ready.then(() => {
      if (isCurrentTrailFocus(state, request)) moved = true
    })
    state = reduceExplorerSession(state, action)
    complete()
    await pending
    assert.equal(moved, false, action.type)
  }
})

test('only explicit show actions request the map camera and increment request identity', () => {
  const empty = createExplorerSession()
  assert.equal(reduceExplorerSession(empty, { type: 'show-trail' }), empty)
  const state = configuredSession()
  assert.equal(state.overlay.focusRequest, null)
  const once = reduceExplorerSession(state, { type: 'show-trail' })
  const twice = reduceExplorerSession(once, { type: 'show-trail' })
  assert.equal(twice.overlay.focusRequest?.id, 2)
  assert.notEqual(twice.overlay.focusRequest, once.overlay.focusRequest)
  assert.throws(
    () => reduceExplorerSession(state, { type: 'trail-options', depth: Number.NaN }),
    RangeError,
  )
})
