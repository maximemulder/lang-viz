import { useAtom } from 'jotai'
import { lazy, Suspense, useEffect, useState } from 'react'
import { FeatureErrorBoundary } from './components/FeatureErrorBoundary'
import { WordTrailMapSummary } from './features/etymology/WordTrailMapSummary'
import { LanguageFinder, LanguageFinderFallback } from './features/languages/LanguageFinder.tsx'
import { WorldMap } from './features/map/WorldMap.tsx'
import { workspaceAtom } from './state/explorerState'

const EtymologyExplorer = lazy(() => import('./features/etymology/EtymologyExplorer'))

export const App = () => {
  const [workspace, setWorkspace] = useAtom(workspaceAtom)
  const [hasOpenedMap, setHasOpenedMap] = useState(workspace === 'geography')
  useEffect(() => {
    if (workspace === 'geography') setHasOpenedMap(true)
  }, [workspace])
  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Interactive atlas</p>
          <h1>Languages of the world</h1>
        </div>
        <nav className="workspace-nav" aria-label="Explorer workspace">
          <button
            type="button"
            aria-pressed={workspace === 'geography'}
            onClick={() => setWorkspace('geography')}
          >
            Geography
          </button>
          <button
            type="button"
            aria-pressed={workspace === 'etymology'}
            onClick={() => setWorkspace('etymology')}
          >
            Word histories
          </button>
        </nav>
        <p className="app-summary">
          Explore where languages are spoken and how words connect them.
        </p>
      </header>
      <main className="explorer-content">
        <div className="atlas-workspace" hidden={workspace !== 'geography'}>
          <section className="map-shell" aria-label="Language map">
            {(hasOpenedMap || workspace === 'geography') && (
              <WorldMap active={workspace === 'geography'} />
            )}
          </section>
          <div className="atlas-sidebar">
            <WordTrailMapSummary />
            <FeatureErrorBoundary
              fallback={
                <aside className="language-finder">
                  <h2>Atlas data unavailable</h2>
                  <p>
                    Generate the geographic data using the setup steps in README.md, then reload.
                    Word histories can be explored independently.
                  </p>
                </aside>
              }
            >
              <Suspense fallback={<LanguageFinderFallback />}>
                <LanguageFinder />
              </Suspense>
            </FeatureErrorBoundary>
          </div>
        </div>
        {workspace === 'etymology' && (
          <FeatureErrorBoundary
            fallback={
              <section className="word-loading">
                <h2>Word histories could not open</h2>
                <p>Reload the page to try again.</p>
              </section>
            }
          >
            <Suspense
              fallback={
                <section className="word-loading" aria-busy="true">
                  Opening Word Trails…
                </section>
              }
            >
              <EtymologyExplorer />
            </Suspense>
          </FeatureErrorBoundary>
        )}
      </main>
    </div>
  )
}
