import { Suspense } from 'react'
import { LanguageFinder, LanguageFinderFallback } from './features/languages/LanguageFinder.tsx'
import { WorldMap } from './features/map/WorldMap.tsx'

export const App = () => (
  <div className="app-shell">
    <header className="app-header">
      <div>
        <p className="eyebrow">Interactive atlas</p>
        <h1>Languages of the world</h1>
      </div>
      <p className="app-summary">Explore where languages are spoken and how they relate.</p>
    </header>

    <main className="atlas-workspace">
      <section className="map-shell" aria-label="Language map">
        <WorldMap />
      </section>
      <Suspense fallback={<LanguageFinderFallback />}>
        <LanguageFinder />
      </Suspense>
    </main>
  </div>
)
