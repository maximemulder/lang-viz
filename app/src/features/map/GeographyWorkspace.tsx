import { useSetAtom } from 'jotai'
import { lazy, type ReactNode, Suspense, useEffect, useState } from 'react'
import { useMap } from 'react-map-gl/maplibre'
import { WorkspaceBoundary } from '../../components/WorkspaceBoundary.tsx'
import { atlasDataAtom } from '../../state/atlasState.ts'
import { LanguageFinder, LanguageFinderFallback } from '../languages/LanguageFinder.tsx'
import { type AreaInteraction, WorldMap } from './WorldMap.tsx'

const AdministrativePanel = lazy(() => import('../administrative/AdministrativePanel.tsx'))

/** Remains mounted after first use, retaining the map, camera, and finder state. */
export default function GeographyWorkspace({
  visible,
  administrative,
  mapLayers,
  areaInteraction,
  sidebarHeader,
}: {
  readonly visible: boolean
  readonly administrative: boolean
  readonly mapLayers?: ReactNode
  readonly areaInteraction: AreaInteraction
  readonly sidebarHeader?: ReactNode
}) {
  const maps = useMap()
  const retry = useSetAtom(atlasDataAtom)
  const [administrativeVisited, setAdministrativeVisited] = useState(false)
  useEffect(() => {
    if (administrative) setAdministrativeVisited(true)
  }, [administrative])
  useEffect(() => {
    if (!visible) return
    const frame = requestAnimationFrame(() => maps['atlas-map']?.resize())
    return () => cancelAnimationFrame(frame)
  }, [visible, maps])
  return (
    <>
      <WorkspaceBoundary name="atlas data" onRetry={retry}>
        <section className="map-shell" aria-label="Language map">
          <WorldMap administrative={administrative} areaInteraction={areaInteraction}>
            {mapLayers}
          </WorldMap>
        </section>
      </WorkspaceBoundary>
      <div className="geography-sidebar">
        <div className="geography-sidebar__language" hidden={administrative}>
          {sidebarHeader}
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
