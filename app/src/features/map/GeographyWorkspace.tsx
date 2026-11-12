import { useSetAtom } from 'jotai'
import { type ReactNode, Suspense, useEffect } from 'react'
import { useMap } from 'react-map-gl/maplibre'
import { WorkspaceBoundary } from '../../components/WorkspaceBoundary.tsx'
import { atlasDataAtom } from '../../state/atlasState.ts'
import { LanguageFinder, LanguageFinderFallback } from '../languages/LanguageFinder.tsx'
import { WorldMap } from './WorldMap.tsx'

/** Remains mounted after first use, retaining the map, camera, and finder state. */
export default function GeographyWorkspace({
  visible,
  mapLayers,
  sidebarHeader,
}: {
  readonly visible: boolean
  readonly mapLayers?: ReactNode
  readonly sidebarHeader?: ReactNode
}) {
  const maps = useMap()
  const retry = useSetAtom(atlasDataAtom)
  useEffect(() => {
    if (!visible) return
    const frame = requestAnimationFrame(() => maps['atlas-map']?.resize())
    return () => cancelAnimationFrame(frame)
  }, [visible, maps])
  return (
    <WorkspaceBoundary name="atlas data" onRetry={retry}>
      <section className="map-shell" aria-label="Language map">
        <WorldMap>{mapLayers}</WorldMap>
      </section>
      <div className="geography-sidebar">
        {sidebarHeader}
        <Suspense fallback={<LanguageFinderFallback />}>
          <LanguageFinder />
        </Suspense>
      </div>
    </WorkspaceBoundary>
  )
}
