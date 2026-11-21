import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useEffect } from 'react'
import { SidebarTabs } from '../../components/SidebarTabs.tsx'
import { walsAtlasCatalogAtom } from '../../integrations/wals/state.ts'
import {
  atlasDataAtom,
  mapEntriesAtom,
  mapGroupsAtom,
  selectedMapAreasAtom,
} from '../../state/atlasState'
import { type LanguagePanelView, languagePanelAtom } from '../../state/languageControls'
import { ExploreLanguages } from './ExploreLanguages'
import { OnMapView } from './OnMapView'

export const LanguageFinder = () => {
  const [panel, setPanel] = useAtom(languagePanelAtom)
  const atlas = useAtomValue(atlasDataAtom)
  const publishCatalog = useSetAtom(walsAtlasCatalogAtom)
  useEffect(() => publishCatalog(atlas.languages), [atlas.languages, publishCatalog])
  const selected = useAtomValue(mapEntriesAtom)
  const groups = useAtomValue(mapGroupsAtom)
  const displayed = useAtomValue(selectedMapAreasAtom)
  const selectView = (view: LanguagePanelView) => setPanel({ ...panel, view })
  return (
    <aside className="language-finder" aria-label="Language controls">
      <SidebarTabs
        className="language-tabs"
        idPrefix="language"
        label="Language views"
        selected={panel.view}
        onSelect={selectView}
        tabs={[
          { value: 'explore', label: 'Explore' },
          {
            value: 'map',
            label: 'Legend',
            ariaLabel: `Legend, ${groups.length.toLocaleString()} groups, ${selected.length.toLocaleString()} areas, ${displayed.length.toLocaleString()} displayed`,
            badge: groups.length.toLocaleString(),
          },
        ]}
      />
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
        <OnMapView />
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
