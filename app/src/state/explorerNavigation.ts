import type { createStore } from 'jotai/vanilla'
import { parseExplorerRoute, serializeExplorerRoute } from '../domain/explorerRoute.ts'
import { sessionRoute } from '../domain/explorerSession.ts'
import {
  explorerActionAtom,
  explorerRouteIssuesAtom,
  explorerSessionAtom,
} from './explorerState.ts'

type ExplorerStore = Pick<ReturnType<typeof createStore>, 'get' | 'set' | 'sub'>
export interface NavigationBrowser {
  readonly location: Pick<Location, 'href'>
  readonly history: Pick<History, 'state' | 'pushState' | 'replaceState'>
  addEventListener(type: 'hashchange' | 'popstate', listener: () => void): void
  removeEventListener(type: 'hashchange' | 'popstate', listener: () => void): void
}

/** Explicit lifecycle: call once above both workspaces, dispose on unmount. No import-time browser access. */
export const connectExplorerNavigation = (store: ExplorerStore, browser: NavigationBrowser) => {
  let applyingLocation = false
  let lastReadUrl: string | null = null
  let lastSessionRoute = serializeExplorerRoute(sessionRoute(store.get(explorerSessionAtom)))
  const urlForSession = () => {
    const url = new URL(browser.location.href)
    url.hash = serializeExplorerRoute(sessionRoute(store.get(explorerSessionAtom)))
    return url.href
  }
  const readLocation = () => {
    if (lastReadUrl === browser.location.href) return
    applyingLocation = true
    try {
      const parsed = parseExplorerRoute(new URL(browser.location.href).hash)
      store.set(explorerRouteIssuesAtom, parsed.issues)
      store.set(explorerActionAtom, { type: 'restore-route', route: parsed.route })
      lastSessionRoute = serializeExplorerRoute(sessionRoute(store.get(explorerSessionAtom)))
      const canonical = urlForSession()
      if (canonical !== browser.location.href)
        browser.history.replaceState(browser.history.state, '', canonical)
      lastReadUrl = canonical
    } finally {
      applyingLocation = false
    }
  }
  readLocation()
  const unsubscribe = store.sub(explorerSessionAtom, () => {
    if (applyingLocation) return
    const route = serializeExplorerRoute(sessionRoute(store.get(explorerSessionAtom)))
    // Hash events are asynchronous. An incidental edit must not overwrite a new
    // browser fragment that has arrived before its event is delivered.
    if (route === lastSessionRoute) return
    lastSessionRoute = route
    const next = urlForSession()
    if (next !== browser.location.href) {
      browser.history.pushState(browser.history.state, '', next)
      lastReadUrl = next
      store.set(explorerRouteIssuesAtom, [])
    }
  })
  browser.addEventListener('hashchange', readLocation)
  browser.addEventListener('popstate', readLocation)
  return () => {
    unsubscribe()
    browser.removeEventListener('hashchange', readLocation)
    browser.removeEventListener('popstate', readLocation)
  }
}
