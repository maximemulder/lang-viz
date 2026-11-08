import { useAtom, useAtomValue } from 'jotai'
import { type KeyboardEvent, useRef } from 'react'
import { selectedMapAreasAtom, visibleLanguageIdsAtom } from '../../state/atlasState'
import { type LanguagePanelView, languagePanelAtom } from '../../state/languageControls'
import { ExploreLanguages } from './ExploreLanguages'
import { GeographyFilters } from './GeographyFilters'
import { LanguageDetails } from './LanguageDetails'
import { OnMapLanguages } from './OnMapLanguages'

const VIEWS = ['explore', 'map', 'details'] as const
const LABELS = { explore: 'Explore', map: 'On map', details: 'Details' }

export const LanguageFinder = () => {
  const [panel, setPanel] = useAtom(languagePanelAtom)
  const selected = useAtomValue(visibleLanguageIdsAtom)
  const displayed = useAtomValue(selectedMapAreasAtom)
  const tabRefs = useRef<Partial<Record<LanguagePanelView, HTMLButtonElement | null>>>({})
  const selectView = (view: LanguagePanelView) => setPanel({ ...panel, view })
  const handleTabKey = (event: KeyboardEvent, view: LanguagePanelView) => {
    const views = VIEWS.filter((view) => view !== 'details' || panel.detailId !== null)
    const index = views.indexOf(view)
    const next =
      event.key === 'ArrowRight'
        ? views[(index + 1) % views.length]
        : event.key === 'ArrowLeft'
          ? views[(index + views.length - 1) % views.length]
          : event.key === 'Home'
            ? views[0]
            : event.key === 'End'
              ? views.at(-1)
              : undefined
    if (!next) return
    event.preventDefault()
    selectView(next)
    tabRefs.current[next]?.focus()
  }
  return (
    <aside className="language-finder" aria-label="Language controls">
      <header className="language-finder__header">
        <div>
          <p className="eyebrow">Language layers</p>
          <h2>Your atlas</h2>
        </div>
        <span className="selection-count" aria-live="polite">
          {displayed.length === selected.length
            ? `${displayed.length.toLocaleString()} shown`
            : `${displayed.length.toLocaleString()} of ${selected.length.toLocaleString()} shown`}
        </span>
      </header>
      <GeographyFilters />
      <div className="language-tabs" role="tablist" aria-label="Language views">
        {VIEWS.map((view) => (
          <button
            key={view}
            type="button"
            role="tab"
            id={`language-tab-${view}`}
            aria-controls={`language-panel-${view}`}
            aria-selected={panel.view === view}
            disabled={view === 'details' && panel.detailId === null}
            tabIndex={panel.view === view ? 0 : -1}
            ref={(element) => {
              tabRefs.current[view] = element
            }}
            onClick={() => selectView(view)}
            onKeyDown={(event) => handleTabKey(event, view)}
          >
            {LABELS[view]}
            {view === 'map' && <span>{selected.length.toLocaleString()}</span>}
          </button>
        ))}
      </div>
      {/* Keep list views mounted so their searches, expansion and scroll positions survive inspection. */}
      <section
        className="language-panel"
        id="language-panel-explore"
        role="tabpanel"
        aria-labelledby="language-tab-explore"
        hidden={panel.view !== 'explore'}
      >
        <ExploreLanguages />
      </section>
      <section
        className="language-panel"
        id="language-panel-map"
        role="tabpanel"
        aria-labelledby="language-tab-map"
        hidden={panel.view !== 'map'}
      >
        <OnMapLanguages />
      </section>
      <section
        className="language-panel language-panel--details"
        id="language-panel-details"
        role="tabpanel"
        aria-labelledby="language-tab-details"
        hidden={panel.view !== 'details'}
      >
        {panel.view === 'details' && (
          <>
            <button
              type="button"
              className="language-back"
              onClick={() => {
                selectView(panel.returnView)
                tabRefs.current[panel.returnView]?.focus()
              }}
            >
              ← Back to {LABELS[panel.returnView]}
            </button>
            <LanguageDetails />
          </>
        )}
      </section>
    </aside>
  )
}

export const LanguageFinderFallback = () => (
  <aside className="language-finder language-finder--loading" aria-busy="true">
    <p className="eyebrow">Language layers</p>
    <h2>Loading catalog…</h2>
    <div className="loading-line" />
    <div className="loading-line loading-line--short" />
  </aside>
)
