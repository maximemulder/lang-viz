import { useAtomValue, useSetAtom } from 'jotai'
import { lazy, type ReactNode, Suspense, useEffect, useRef, useState } from 'react'
import { useMap } from 'react-map-gl/maplibre'
import { WorkspaceBoundary } from '../../components/WorkspaceBoundary.tsx'
import { atlasDataAtom } from '../../state/atlasState.ts'
import { explorerSessionAtom } from '../../state/explorerState.ts'
import { languagePanelAtom } from '../../state/languageControls.ts'
import { administrativeSessionAtom } from '../administrative/state.ts'
import { LanguageDetails } from '../languages/LanguageDetails.tsx'
import { LanguageFinder, LanguageFinderFallback } from '../languages/LanguageFinder.tsx'
import { WalsStandaloneInspection } from '../wals/LanguageFeatures.tsx'
import { walsSessionAtom } from '../wals/state.ts'
import { type AreaInteraction, WorldMap } from './WorldMap.tsx'

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
  areaInteraction,
  sidebarHeader,
}: {
  readonly visible: boolean
  readonly administrative: boolean
  readonly mapAttribution: string
  readonly mapLayers?: ReactNode
  readonly areaInteraction: AreaInteraction
  readonly sidebarHeader?: ReactNode
}) {
  const maps = useMap()
  const mapShell = useRef<HTMLElement>(null)
  const retry = useSetAtom(atlasDataAtom)
  const languagePanel = useAtomValue(languagePanelAtom)
  const administrativeSelection = useAtomValue(administrativeSessionAtom).selection
  const wals = useAtomValue(walsSessionAtom)
  const lexical = useAtomValue(explorerSessionAtom).overlay.enabled
  const hasLanguageDetails = Boolean(
    languagePanel.detailId ||
      (wals.inspection && !wals.inspection.profileId) ||
      wals.overlay?.visible ||
      lexical,
  )
  const hasDetails = administrative ? Boolean(administrativeSelection) : hasLanguageDetails
  const coverLanguageControls =
    !administrative && Boolean(languagePanel.detailId) && languagePanel.detailPlacement === 'cover'
  const dockMapDetails =
    !administrative &&
    Boolean(languagePanel.detailId) &&
    languagePanel.detailOrigin === 'map' &&
    languagePanel.detailPlacement === 'beside'
  const [administrativeVisited, setAdministrativeVisited] = useState(false)
  useEffect(() => {
    if (administrative) setAdministrativeVisited(true)
  }, [administrative])
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
          aria-label={administrative ? 'Administrative areas map' : 'Language map'}
        >
          <WorldMap areaInteraction={areaInteraction} mapAttribution={mapAttribution}>
            {mapLayers}
          </WorldMap>
        </section>
      </WorkspaceBoundary>
      {hasDetails && (
        <aside
          className={`geography-inspector${coverLanguageControls ? ' geography-inspector--cover' : ''}${dockMapDetails ? ' geography-inspector--map-docked' : ''}`}
          aria-label="Details"
        >
          {administrative ? (
            <Suspense fallback={<p className="workspace-loading">Loading details…</p>}>
              <AdministrativeDetails />
            </Suspense>
          ) : (
            <>
              {sidebarHeader}
              <WorkspaceBoundary name="language details" onRetry={retry}>
                <Suspense fallback={<p className="workspace-loading">Loading details…</p>}>
                  {languagePanel.detailId && <LanguageDetails />}
                  <WalsStandaloneInspection />
                </Suspense>
              </WorkspaceBoundary>
            </>
          )}
        </aside>
      )}
      <div className="geography-sidebar" inert={coverLanguageControls}>
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
