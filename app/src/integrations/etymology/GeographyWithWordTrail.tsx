import { useAtomValue } from 'jotai'
import { lazy, Suspense } from 'react'
import GeographyWorkspace from '../../features/map/GeographyWorkspace.tsx'
import { explorerSessionAtom } from '../../state/explorerState.ts'

const WordTrailLayer = lazy(() => import('./WordTrailLayer.tsx'))
const WordTrailMapSummary = lazy(() => import('./WordTrailMapSummary.tsx'))

/** Compose the optional lexical overlay without making geography load lexical code. */
export default function GeographyWithWordTrail({ visible }: { readonly visible: boolean }) {
  const enabled = useAtomValue(explorerSessionAtom).overlay.enabled
  return (
    <GeographyWorkspace
      visible={visible}
      mapLayers={
        enabled && (
          <Suspense fallback={null}>
            <WordTrailLayer />
          </Suspense>
        )
      }
      sidebarHeader={
        enabled && (
          <Suspense fallback={null}>
            <WordTrailMapSummary />
          </Suspense>
        )
      }
    />
  )
}
