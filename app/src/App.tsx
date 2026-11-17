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
  const [mapVisited, setMapVisited] = useState(false)
  useEffect(() => {
    const disconnect = connectExplorerNavigation(store, window)
    setConnected(true)
    return disconnect
  }, [store])
  useEffect(() => {
    if (connected && session.workspace === 'map') setMapVisited(true)
  }, [connected, session.workspace])
  const mapWorkspace = session.workspace === 'map'
  const administrative = session.mapMode === 'region'
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
              aria-pressed={mapWorkspace}
              onClick={() => dispatch({ type: 'workspace', workspace: 'map' })}
            >
              Languages
            </button>
            <button
              type="button"
              aria-pressed={session.workspace === 'etymology'}
              onClick={() => dispatch({ type: 'workspace', workspace: 'etymology' })}
            >
              Etymologies
            </button>
          </nav>
          <p className="app-summary">Explore where languages are spoken and how they relate.</p>
        </header>
        <main className="workspace-host">
          {connected ? (
            <>
              {(mapVisited || mapWorkspace) && (
                <div className="workspace-panel atlas-workspace" hidden={!mapWorkspace}>
                  <WorkspaceBoundary name="the map workspace">
                    <Suspense
                      fallback={
                        <p className="workspace-loading" role="status">
                          Loading map…
                        </p>
                      }
                    >
                      <GeographyWorkspace visible={mapWorkspace} administrative={administrative} />
                    </Suspense>
                  </WorkspaceBoundary>
                </div>
              )}
              {session.workspace === 'etymology' && (
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
