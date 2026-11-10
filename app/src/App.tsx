import { Component, type ReactNode, Suspense } from 'react'
import { MapProvider } from 'react-map-gl/maplibre'
import { LanguageFinder, LanguageFinderFallback } from './features/languages/LanguageFinder.tsx'
import { WorldMap } from './features/map/WorldMap.tsx'

class AtlasDataBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    return this.state.error ? (
      <div role="alert">
        <h2>Unable to load atlas data</h2>
        <p>{this.state.error.message}</p>
        <button type="button" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    ) : (
      this.props.children
    )
  }
}

export const App = () => (
  <MapProvider>
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Interactive atlas</p>
          <h1>Languages of the world</h1>
        </div>
        <p className="app-summary">Explore where languages are spoken and how they relate.</p>
      </header>

      <main className="atlas-workspace">
        <AtlasDataBoundary>
          <section className="map-shell" aria-label="Language map">
            <WorldMap />
          </section>
          <Suspense fallback={<LanguageFinderFallback />}>
            <LanguageFinder />
          </Suspense>
        </AtlasDataBoundary>
      </main>
    </div>
  </MapProvider>
)
