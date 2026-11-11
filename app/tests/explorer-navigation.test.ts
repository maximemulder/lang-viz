import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createStore } from 'jotai/vanilla'
import { parseExplorerRoute, serializeExplorerRoute } from '../src/domain/explorerRoute.ts'
import {
  type ExplorerAction,
  type ExplorerRoute,
  sessionRoute,
} from '../src/domain/explorerSession.ts'
import {
  connectExplorerNavigation,
  type NavigationBrowser,
} from '../src/state/explorerNavigation.ts'
import {
  explorerActionAtom,
  explorerRouteIssuesAtom,
  explorerSessionAtom,
} from '../src/state/explorerState.ts'

class MemoryBrowser implements NavigationBrowser {
  entries: { url: string; state: unknown }[]
  index = 0
  pushes = 0
  replacements = 0
  listeners = new Map<string, Set<() => void>>()
  constructor(url = 'https://example.test/lang-viz/?overlap-test=1') {
    this.entries = [{ url, state: { hostState: 'preserved' } }]
  }
  get current() {
    const entry = this.entries[this.index]
    if (!entry) throw new RangeError('No history entry')
    return entry
  }
  get location() {
    return { href: this.current.url }
  }
  get history() {
    return {
      state: this.current.state,
      pushState: (state: unknown, _unused: string, url?: string | URL | null) => {
        this.entries.splice(this.index + 1)
        this.entries.push({ url: new URL(String(url), this.location.href).href, state })
        this.index++
        this.pushes++
      },
      replaceState: (state: unknown, _unused: string, url?: string | URL | null) => {
        this.entries[this.index] = { url: new URL(String(url), this.location.href).href, state }
        this.replacements++
      },
    }
  }
  addEventListener(type: string, listener: () => void) {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }
  removeEventListener(type: string, listener: () => void) {
    this.listeners.get(type)?.delete(listener)
  }
  emit(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener()
  }
  back() {
    this.index--
    this.emit('popstate')
    this.emit('hashchange')
  }
  forward() {
    this.index++
    this.emit('popstate')
    this.emit('hashchange')
  }
  hash(fragment: string) {
    const url = new URL(this.location.href)
    url.hash = fragment
    this.history.pushState(this.history.state, '', url)
    this.emit('popstate')
    this.emit('hashchange')
  }
}

test('empty, legacy, concept-only, and explicit Geography links parse without dataset access', () => {
  assert.equal(parseExplorerRoute('').route.workspace, 'geography')
  assert.deepEqual(parseExplorerRoute('#word=69562&view=family').route, {
    workspace: 'etymology',
    word: '69562',
    view: 'family',
    concept: null,
    collection: null,
  })
  assert.equal(
    parseExplorerRoute('#concept=1001&collection=1&view=family').route.workspace,
    'etymology',
  )
  assert.equal(
    parseExplorerRoute('#workspace=geography&word=69562&view=family').route.workspace,
    'geography',
  )
})

test('canonical route round trips preserve workspace, root, view, concept, and collection', () => {
  for (const workspace of ['geography', 'etymology'] as const) {
    for (const view of ['history', 'family'] as const) {
      for (const word of [null, '69562']) {
        const route: ExplorerRoute = { workspace, word, view, concept: '1001', collection: '1' }
        const encoded = serializeExplorerRoute(route)
        assert.deepEqual(parseExplorerRoute(encoded), { route, issues: [] })
        assert.equal(serializeExplorerRoute(parseExplorerRoute(encoded).route), encoded)
      }
    }
  }
  const empty = parseExplorerRoute('').route
  assert.deepEqual(parseExplorerRoute(serializeExplorerRoute(empty)).route, empty)
})

test('malformed encoding, invalid IDs, duplicate fields, and unknown enums normalize with diagnostics', () => {
  for (const hash of [
    '#word=%ZZ',
    '#word=01',
    '#word=-1',
    '#word=',
    '#word=1&word=2',
    '#workspace=other',
    '#view=other',
    '#workspace=geography&workspace=etymology',
  ]) {
    const parsed = parseExplorerRoute(hash)
    assert.ok(parsed.issues.length > 0, hash)
    assert.deepEqual(parseExplorerRoute(serializeExplorerRoute(parsed.route)).issues, [])
  }
  assert.equal(parseExplorerRoute('#word=999999').route.word, '999999')
})

test('initial connection reads legacy links and replaces only their canonical spelling', () => {
  const browser = new MemoryBrowser('https://example.test/lang-viz/?debug=1#word=69562&view=family')
  const store = createStore()
  const dispose = connectExplorerNavigation(store, browser)
  assert.equal(store.get(explorerSessionAtom).trail.root, '69562')
  assert.equal(store.get(explorerSessionAtom).workspace, 'etymology')
  assert.equal(browser.pushes, 0)
  assert.equal(browser.replacements, 1)
  assert.equal(new URL(browser.location.href).pathname, '/lang-viz/')
  assert.equal(new URL(browser.location.href).search, '?debug=1')
  assert.deepEqual(browser.history.state, { hostState: 'preserved' })
  dispose()
})

test('meaningful navigation pushes history; settings, selection, and canonicalization do not', () => {
  const browser = new MemoryBrowser(),
    store = createStore()
  const dispose = connectExplorerNavigation(store, browser)
  const send = (action: ExplorerAction) => store.set(explorerActionAtom, action)
  send({ type: 'trace', id: '69562' })
  send({ type: 'view', view: 'family' })
  send({ type: 'comparison', conceptId: '1001', collectionId: '1' })
  assert.equal(browser.pushes, 3)
  send({ type: 'trail-options', depth: 6, branches: false })
  send({ type: 'expand', id: '69421' }) // changes visualization to history: one meaningful navigation
  assert.equal(browser.pushes, 4)
  send({ type: 'select', selection: { kind: 'edge', id: '1' } })
  send({ type: 'search', query: 'wine' })
  send({ type: 'comparison-filter', family: 'Family', includeMissing: true })
  assert.equal(browser.pushes, 4)
  send({ type: 'show-trail' })
  assert.equal(browser.pushes, 5)
  assert.equal(parseExplorerRoute(new URL(browser.location.href).hash).route.workspace, 'geography')
  send({ type: 'clear-overlay' })
  assert.equal(browser.pushes, 5)
  dispose()
})

test('Back/Forward restores explicit comparison scope without the old root-default overwrite', () => {
  const browser = new MemoryBrowser(),
    store = createStore()
  const dispose = connectExplorerNavigation(store, browser)
  store.set(explorerActionAtom, { type: 'trace', id: '69562' })
  store.set(explorerActionAtom, { type: 'comparison', conceptId: '1001', collectionId: '1' })
  const before = sessionRoute(store.get(explorerSessionAtom))
  store.set(explorerActionAtom, { type: 'workspace', workspace: 'geography' })
  const pushes = browser.pushes
  browser.back()
  assert.deepEqual(sessionRoute(store.get(explorerSessionAtom)), before)
  browser.forward()
  assert.equal(store.get(explorerSessionAtom).workspace, 'geography')
  assert.equal(store.get(explorerSessionAtom).comparison.conceptId, '1001')
  assert.equal(browser.pushes, pushes)
  dispose()
})

test('live hash changes update focus once even when both browser events fire', () => {
  const browser = new MemoryBrowser(),
    store = createStore()
  const dispose = connectExplorerNavigation(store, browser)
  let notifications = 0
  const unsubscribe = store.sub(explorerSessionAtom, () => {
    notifications++
  })
  browser.hash('#word=38213&view=history')
  assert.equal(store.get(explorerSessionAtom).trail.root, '38213')
  assert.equal(notifications, 1)
  assert.equal(browser.pushes, 1) // external browser navigation only
  assert.equal(browser.replacements, 2) // initial URL and legacy canonicalization
  unsubscribe()
  dispose()
})

test('incidental edits cannot overwrite an external hash before its queued event arrives', () => {
  const browser = new MemoryBrowser(),
    store = createStore()
  const dispose = connectExplorerNavigation(store, browser)
  const incoming = new URL(browser.location.href)
  incoming.hash = '#word=38213&view=history'
  browser.history.pushState(browser.history.state, '', incoming)
  store.set(explorerActionAtom, { type: 'search', query: 'edit before hash event' })
  assert.equal(browser.location.href, incoming.href)
  assert.equal(browser.pushes, 1)
  browser.emit('hashchange')
  assert.equal(store.get(explorerSessionAtom).trail.root, '38213')
  assert.equal(browser.pushes, 1)
  dispose()
})

test('refreshing a Geography URL keeps Geography and encoded lexical navigation', () => {
  const browser = new MemoryBrowser(),
    store = createStore()
  const dispose = connectExplorerNavigation(store, browser)
  store.set(explorerActionAtom, { type: 'trace', id: '69562' })
  store.set(explorerActionAtom, { type: 'comparison', conceptId: '1001', collectionId: '1' })
  store.set(explorerActionAtom, { type: 'workspace', workspace: 'geography' })
  const route = sessionRoute(store.get(explorerSessionAtom))
  dispose()
  const reloaded = createStore(),
    nextBrowser = new MemoryBrowser(browser.location.href)
  const disconnect = connectExplorerNavigation(reloaded, nextBrowser)
  assert.deepEqual(sessionRoute(reloaded.get(explorerSessionAtom)), route)
  assert.equal(reloaded.get(explorerSessionAtom).overlay.enabled, false)
  disconnect()
})

test('invalid links keep diagnostics without repeated event/write loops', () => {
  const browser = new MemoryBrowser('https://example.test/#word=1&word=2')
  const store = createStore(),
    dispose = connectExplorerNavigation(store, browser)
  assert.match(store.get(explorerRouteIssuesAtom).join(), /Repeated URL parameter/)
  for (let i = 0; i < 10; i++) {
    browser.emit('popstate')
    browser.emit('hashchange')
  }
  assert.equal(browser.pushes, 0)
  assert.equal(browser.replacements, 1)
  assert.match(store.get(explorerRouteIssuesAtom).join(), /Repeated URL parameter/)
  dispose()
})

test('disconnect removes subscriptions and both listeners; reconnect is safe', () => {
  const browser = new MemoryBrowser(),
    store = createStore()
  const dispose = connectExplorerNavigation(store, browser)
  dispose()
  store.set(explorerActionAtom, { type: 'trace', id: '69562' })
  assert.equal(browser.pushes, 0)
  browser.hash('#word=38213')
  assert.equal(store.get(explorerSessionAtom).trail.root, '69562')
  const reconnect = connectExplorerNavigation(store, browser)
  assert.equal(store.get(explorerSessionAtom).trail.root, '38213')
  assert.equal(browser.listeners.get('hashchange')?.size, 1)
  assert.equal(browser.listeners.get('popstate')?.size, 1)
  reconnect()
})
