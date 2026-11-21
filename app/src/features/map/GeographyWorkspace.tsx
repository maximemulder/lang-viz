import { useAtomValue, useSetAtom } from 'jotai'
import { lazy, type ReactNode, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useMap } from 'react-map-gl/maplibre'
import type { DetailsPanelControls } from '../../components/DetailsHeader.tsx'
import { WorkspaceBoundary } from '../../components/WorkspaceBoundary.tsx'
import { atlasDataAtom } from '../../state/atlasState.ts'
import { explorerSessionAtom } from '../../state/explorerState.ts'
import {
  closeLanguageDetailsAtom,
  languagePanelAtom,
  toggleLanguageDetailPlacementAtom,
} from '../../state/languageControls.ts'
import { setLanguageSummarySectionAtom } from '../../state/languageSummary.ts'
import {
  administrativeSessionAtom,
  selectAdministrativeAtom,
  toggleAdministrativeDetailPlacementAtom,
} from '../administrative/state.ts'
import { LanguageDetails } from '../languages/LanguageDetails.tsx'
import { LanguageFinder, LanguageFinderFallback } from '../languages/LanguageFinder.tsx'
import { WalsStandaloneInspection } from '../wals/LanguageFeatures.tsx'
import { walsSessionAtom } from '../wals/state.ts'
import { type RegionInteraction, WorldMap } from './WorldMap.tsx'

const AdministrativePanel = lazy(() => import('../administrative/AdministrativePanel.tsx'))
const AdministrativeDetails = lazy(() =>
  import('../administrative/AdministrativePanel.tsx').then((module) => ({
    default: module.AdministrativeDetails,
  })),
)

/** Remains mounted after first use, retaining the map, camera, and finder state. */
export default function GeographyWorkspace({
  visible,
  administrative,
  mapAttribution,
  mapLayers,
  regionInteraction,
  sidebarHeader,
}: {
  readonly visible: boolean
  readonly administrative: boolean
  readonly mapAttribution: string
  readonly mapLayers?: ReactNode
  readonly regionInteraction: RegionInteraction
  readonly sidebarHeader?: ReactNode
}) {
  const maps = useMap()
  const mapShell = useRef<HTMLElement>(null)
  const sidebar = useRef<HTMLDivElement>(null)
  const focusOnClose = useRef<HTMLElement | null>(null)
  const retry = useSetAtom(atlasDataAtom)
  const setSummarySection = useSetAtom(setLanguageSummarySectionAtom)
  const languagePanel = useAtomValue(languagePanelAtom)
  const { selection: administrativeSelection, detailLayout: administrativeLayout } =
    useAtomValue(administrativeSessionAtom)
  const selectAdministrative = useSetAtom(selectAdministrativeAtom)
  const toggleAdministrativePlacement = useSetAtom(toggleAdministrativeDetailPlacementAtom)
  const closeLanguage = useSetAtom(closeLanguageDetailsAtom)
  const toggleLanguagePlacement = useSetAtom(toggleLanguageDetailPlacementAtom)
  const wals = useAtomValue(walsSessionAtom)
  const lexical = useAtomValue(explorerSessionAtom).overlay.enabled
  const hasLanguageDetails = Boolean(
    languagePanel.detailId ||
      (wals.inspection && !wals.inspection.profileId) ||
      wals.overlay?.visible ||
      lexical,
  )
  const hasDetails = administrative ? Boolean(administrativeSelection) : hasLanguageDetails
  const detailLayout = administrative ? administrativeLayout : languagePanel.detailLayout
  const coversSidebar = detailLayout?.placement === 'cover'
  const detailControls: DetailsPanelControls | null = detailLayout && {
    layout: {
      placement: detailLayout.placement,
      sidebarLabel: administrative ? 'region controls' : 'language controls',
      onToggle: administrative ? toggleAdministrativePlacement : toggleLanguagePlacement,
    },
    onClose: () => {
      const controls = sidebar.current
      if (detailLayout.origin === 'map') {
        focusOnClose.current =
          mapShell.current?.querySelector<HTMLElement>('.maplibregl-canvas') ?? null
      } else if (administrative) {
        focusOnClose.current =
          controls?.querySelector<HTMLElement>(
            '.administrative-results button[aria-current="true"]',
          ) ??
          controls?.querySelector<HTMLElement>('.administrative-search-field input') ??
          null
      } else {
        focusOnClose.current =
          controls?.querySelector<HTMLElement>(
            `#language-panel-${languagePanel.view} [data-inspected="true"] :is(.language-row__identity, .on-map-row__identity)`,
          ) ??
          controls?.querySelector<HTMLElement>(`#language-tab-${languagePanel.view}`) ??
          null
      }
      if (administrative) selectAdministrative(null)
      else closeLanguage()
    },
  }
  useLayoutEffect(() => {
    // The covered sidebar can receive focus again once React removes inert.
    if (detailLayout) return
    focusOnClose.current?.focus({ preventScroll: true })
    focusOnClose.current = null
  }, [detailLayout])
  const [administrativeVisited, setAdministrativeVisited] = useState(false)
  useEffect(() => {
    if (administrative) setAdministrativeVisited(true)
  }, [administrative])
  useEffect(() => {
    if (administrative) setSummarySection('regions', true)
  }, [administrative, setSummarySection])
  useEffect(() => {
    if (!visible) return
    const shell = mapShell.current
    if (!shell) return
    const observer = new ResizeObserver(() => maps['atlas-map']?.resize())
    observer.observe(shell)
    const frame = requestAnimationFrame(() => maps['atlas-map']?.resize())
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [visible, maps])
  return (
    <>
      <WorkspaceBoundary name="atlas data" onRetry={retry}>
        <section
          ref={mapShell}
          className="map-shell"
          aria-label={administrative ? 'Administrative regions map' : 'Language map'}
        >
          <WorldMap regionInteraction={regionInteraction} mapAttribution={mapAttribution}>
            {mapLayers}
          </WorldMap>
        </section>
      </WorkspaceBoundary>
      {hasDetails && (
        <aside
          className={`geography-inspector${detailLayout ? ` geography-inspector--${detailLayout.placement}` : ''}`}
          aria-label="Details"
        >
          {administrative && administrativeSelection?.kind === 'language' && detailControls ? (
            <WorkspaceBoundary name="language details" onRetry={retry}>
              <Suspense fallback={<p className="workspace-loading">Loading details…</p>}>
                <LanguageDetails
                  sourceCode={administrativeSelection.id}
                  controls={detailControls}
                />
              </Suspense>
            </WorkspaceBoundary>
          ) : administrative ? (
            <Suspense fallback={<p className="workspace-loading">Loading details…</p>}>
              {detailControls && <AdministrativeDetails controls={detailControls} />}
            </Suspense>
          ) : (
            <>
              {sidebarHeader}
              <WorkspaceBoundary name="language details" onRetry={retry}>
                <Suspense fallback={<p className="workspace-loading">Loading details…</p>}>
                  {languagePanel.detailId && detailControls && (
                    <LanguageDetails controls={detailControls} />
                  )}
                  <WalsStandaloneInspection />
                </Suspense>
              </WorkspaceBoundary>
            </>
          )}
        </aside>
      )}
      <div ref={sidebar} className="geography-sidebar" inert={coversSidebar}>
        <div className="geography-sidebar__language" hidden={administrative}>
          <WorkspaceBoundary name="language catalog" onRetry={retry}>
            <Suspense fallback={<LanguageFinderFallback />}>
              <LanguageFinder />
            </Suspense>
          </WorkspaceBoundary>
        </div>
        {(administrativeVisited || administrative) && (
          <div className="geography-sidebar__administrative" hidden={!administrative}>
            <Suspense
              fallback={
                <p className="workspace-loading" role="status">
                  Loading administrative view…
                </p>
              }
            >
              <AdministrativePanel />
            </Suspense>
          </div>
        )}
      </div>
    </>
  )
}
