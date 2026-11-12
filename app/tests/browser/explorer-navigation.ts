import { createStore } from 'jotai/vanilla'
import type { ExplorerAction } from '../../src/domain/explorerSession.ts'
import { sessionRoute } from '../../src/domain/explorerSession.ts'
import {
  atlasWordTrailAtom,
  etymologyRepositoryAtom,
  resolvedExplorerAtom,
  wordTrailAtom,
} from '../../src/features/etymology/state.ts'
import { connectExplorerNavigation } from '../../src/state/explorerNavigation.ts'
import {
  explorerActionAtom,
  explorerRouteIssuesAtom,
  explorerSessionAtom,
} from '../../src/state/explorerState.ts'
import { explorerRepository } from '../fixtures/explorer.ts'

const store = createStore()
store.set(etymologyRepositoryAtom, explorerRepository())
connectExplorerNavigation(store, window)
const dispatch = (action: ExplorerAction) => store.set(explorerActionAtom, action)
const snapshot = () => {
  const session = store.get(explorerSessionAtom)
  return {
    href: window.location.href,
    route: sessionRoute(session),
    session: { ...session, trail: { ...session.trail, expanded: [...session.trail.expanded] } },
    routeIssues: store.get(explorerRouteIssuesAtom),
    resolved: store.get(resolvedExplorerAtom),
    graphIds: store.get(wordTrailAtom)?.ids ?? null,
    overlayIds: store.get(atlasWordTrailAtom)?.ids ?? null,
  }
}
declare global {
  interface Window {
    explorerNavigationTest: { dispatch: typeof dispatch; snapshot: typeof snapshot }
  }
}
window.explorerNavigationTest = { dispatch, snapshot }
const render = () => {
  const output = document.getElementById('session')
  if (output) output.textContent = JSON.stringify(snapshot(), null, 2)
}
store.sub(explorerSessionAtom, render)
store.sub(explorerRouteIssuesAtom, render)
window.addEventListener('hashchange', render)
window.addEventListener('popstate', render)
render()
for (const id of ['wine', 'water'])
  document
    .getElementById(id)
    ?.addEventListener('click', () =>
      dispatch({ type: 'trace', id: id === 'wine' ? '69562' : '38213' }),
    )
for (const workspace of ['geography', 'etymology'] as const)
  document
    .getElementById(workspace)
    ?.addEventListener('click', () => dispatch({ type: 'workspace', workspace }))
