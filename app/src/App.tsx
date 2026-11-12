import { useAtomValue, useSetAtom, useStore } from 'jotai'
import { lazy, Suspense, useEffect, useState } from 'react'
import { MapProvider } from 'react-map-gl/maplibre'
import { WorkspaceBoundary } from './components/WorkspaceBoundary.tsx'
import { connectExplorerNavigation } from './state/explorerNavigation.ts'
import { explorerActionAtom, explorerSessionAtom } from './state/explorerState.ts'

const GeographyWorkspace = lazy(() => import('./integrations/GeographyExplorations.tsx'))
const EtymologyExplorer = lazy(() => import('./features/etymology/EtymologyExplorer.tsx'))

export const App = () => {
  const store = useStore()
  const session = useAtomValue(explorerSessionAtom)
  const dispatch = useSetAtom(explorerActionAtom)
  const [connected, setConnected] = useState(false)
  const [lexicalAttempt, setLexicalAttempt] = useState(0)
  const [geographyVisited, setGeographyVisited] = useState(false)
  useEffect(() => {
    const disconnect = connectExplorerNavigation(store, window)
    setConnected(true)
    return disconnect
  }, [store])
  useEffect(() => {
    if (connected && session.workspace === 'geography') setGeographyVisited(true)
  }, [connected, session.workspace])
  const geography = session.workspace === 'geography'
  return (
    <MapProvider>
      <div className="app-shell">
        <header className="app-header">
          <div>
            <p className="eyebrow">Interactive atlas</p>
            <h1>Languages of the world</h1>
          </div>
          <nav className="workspace-nav" aria-label="Workspace">
            <button
              type="button"
              aria-pressed={geography}
              onClick={() => dispatch({ type: 'workspace', workspace: 'geography' })}
            >
              Geography
            </button>
            <button
              type="button"
              aria-pressed={!geography}
              onClick={() => dispatch({ type: 'workspace', workspace: 'etymology' })}
            >
              Word histories
            </button>
          </nav>
          <p className="app-summary">Explore where languages are spoken and how they relate.</p>
        </header>
        <main className="workspace-host">
          {connected ? (
            <>
              {(geographyVisited || geography) && (
                <div className="workspace-panel atlas-workspace" hidden={!geography}>
                  <WorkspaceBoundary name="the geography workspace">
                    <Suspense
                      fallback={
                        <p className="workspace-loading" role="status">
                          Loading geography…
                        </p>
                      }
                    >
                      <GeographyWorkspace visible={geography} />
                    </Suspense>
                  </WorkspaceBoundary>
                </div>
              )}
              {!geography && (
                <div className="workspace-panel lexical-panel">
                  <WorkspaceBoundary
                    name="word histories"
                    onRetry={() => setLexicalAttempt((value) => value + 1)}
                  >
                    <Suspense
                      fallback={
                        <p className="workspace-loading" role="status">
                          Loading word histories…
                        </p>
                      }
                    >
                      <EtymologyExplorer key={lexicalAttempt} />
                    </Suspense>
                  </WorkspaceBoundary>
                </div>
              )}
            </>
          ) : (
            <p role="status">Opening workspace…</p>
          )}
        </main>
      </div>
    </MapProvider>
  )
}
