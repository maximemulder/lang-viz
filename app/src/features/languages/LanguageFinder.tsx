import { useAtom, useAtomValue } from 'jotai'
import { type KeyboardEvent, useRef } from 'react'
import { mapEntriesAtom, selectedMapAreasAtom } from '../../state/atlasState'
import { type LanguagePanelView, languagePanelAtom } from '../../state/languageControls'
import { ExploreLanguages } from './ExploreLanguages'
import { LanguageDetails } from './LanguageDetails'
import { OnMapLanguages } from './OnMapLanguages'

const VIEWS = ['explore', 'map'] as const
const LABELS = { explore: 'Explore', map: 'On map' }

export const LanguageFinder = () => {
  const [panel, setPanel] = useAtom(languagePanelAtom)
  const selected = useAtomValue(mapEntriesAtom)
  const displayed = useAtomValue(selectedMapAreasAtom)
  const tabRefs = useRef<Partial<Record<LanguagePanelView, HTMLButtonElement | null>>>({})
  const selectView = (view: LanguagePanelView) => setPanel({ ...panel, view })
  const handleTabKey = (event: KeyboardEvent, view: LanguagePanelView) => {
    const views = VIEWS
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
      <div className="language-finder__inspection">{panel.detailId && <LanguageDetails />}</div>
      <div className="language-tabs" role="tablist" aria-label="Language views">
        {VIEWS.map((view) => (
          <button
            key={view}
            type="button"
            role="tab"
            id={`language-tab-${view}`}
            aria-controls={`language-panel-${view}`}
            aria-selected={panel.view === view}
            aria-label={
              view === 'map'
                ? `On map, ${selected.length.toLocaleString()} entries, ${displayed.length.toLocaleString()} displayed`
                : undefined
            }
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
    </aside>
  )
}

export const LanguageFinderFallback = () => (
  <aside className="language-finder language-finder--loading" aria-busy="true">
    <h2>Loading catalog…</h2>
    <div className="loading-line" />
    <div className="loading-line loading-line--short" />
  </aside>
)
