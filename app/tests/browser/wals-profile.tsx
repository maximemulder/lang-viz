import { Provider, useAtomValue } from 'jotai'
import { createStore } from 'jotai/vanilla'
import { createRoot } from 'react-dom/client'
import {
  LanguageFeatures,
  WalsStandaloneInspection,
} from '../../src/features/wals/LanguageFeatures.tsx'
import {
  inspectWalsObservationAtom,
  walsAtlasCatalogAtom,
} from '../../src/integrations/wals/state.ts'
import {
  closeLanguageDetailsAtom,
  languagePanelAtom,
  openLanguageDetailsAtom,
} from '../../src/state/languageControls.ts'
import { profileWalsCatalog } from '../fixtures/wals-profile.ts'

const store = createStore()
store.set(walsAtlasCatalogAtom, profileWalsCatalog())
const open = (languageId: string) =>
  store.set(openLanguageDetailsAtom, { languageId, moveMap: false })
open('atlas:irish')
// Test-only controls exercise public application actions, never React internals.
const Fixture = () => {
  const panel = useAtomValue(languagePanelAtom)
  return (
    <main style={{ maxWidth: '360px', margin: 'auto', fontFamily: 'sans-serif' }}>
      <h1>WALS profile acceptance fixture</h1>
      <nav aria-label="Fixture controls">
        {['atlas:irish', 'broa1234', 'empt1234', 'no-record'].map((id) => (
          <button key={id} type="button" onClick={() => open(id)}>
            {id}
          </button>
        ))}
        <button type="button" onClick={() => store.set(closeLanguageDetailsAtom)}>
          Close profile
        </button>
        <button
          type="button"
          onClick={() =>
            store.set(inspectWalsObservationAtom, { sourceId: 'orphan', featureId: '12A' })
          }
        >
          Inspect unmatched
        </button>
        <button type="button" onClick={() => store.set(walsAtlasCatalogAtom, null)}>
          Catalog pending
        </button>
        <button type="button" onClick={() => store.set(walsAtlasCatalogAtom, profileWalsCatalog())}>
          Catalog ready
        </button>
        <button
          type="button"
          onClick={() =>
            store.set(inspectWalsObservationAtom, { sourceId: 'ird', featureId: '12A' })
          }
        >
          Inspect Donegal
        </button>
      </nav>
      <output id="profile-id">{panel.detailId}</output>
      {panel.detailId && <LanguageFeatures profileId={panel.detailId} />}
      <WalsStandaloneInspection />
    </main>
  )
}
const root = document.getElementById('root')
if (!root) throw new Error('Missing fixture root')
createRoot(root).render(
  <Provider store={store}>
    <Fixture />
  </Provider>,
)
