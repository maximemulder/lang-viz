import { useAtomValue } from 'jotai'
import { lazy, Suspense } from 'react'
import GeographyWorkspace from '../features/map/GeographyWorkspace.tsx'
import { walsSessionAtom } from '../features/wals/state.ts'
import { explorerSessionAtom } from '../state/explorerState.ts'
import { wordTrailVisibleAtom } from './etymology/visibility.ts'
import './geographyExplorations.css'

const WordTrailLayer = lazy(() => import('./etymology/WordTrailLayer.tsx'))
const WordTrailMapSummary = lazy(() => import('./etymology/WordTrailMapSummary.tsx'))
const WalsLayer = lazy(() => import('./wals/WalsLayer.tsx'))
const WalsMapSummary = lazy(() => import('./wals/WalsMapSummary.tsx'))

/** Optional explorations compose here; the map core knows neither feature. */
export default function GeographyExplorations({
  visible,
  administrative,
}: {
  readonly visible: boolean
  readonly administrative: boolean
}) {
  const lexical = useAtomValue(explorerSessionAtom).overlay.enabled
  const wordVisible = useAtomValue(wordTrailVisibleAtom)
  const wals = useAtomValue(walsSessionAtom).overlay
  return (
    <GeographyWorkspace
      visible={visible}
      administrative={administrative}
      mapLayers={
        <>
          {lexical && wordVisible && !administrative && (
            <Suspense fallback={null}>
              <WordTrailLayer />
            </Suspense>
          )}
          {wals?.visible && visible && !administrative && (
            <Suspense fallback={null}>
              <WalsLayer key={`${wals.sourceId}:${wals.featureId}`} />
            </Suspense>
          )}
        </>
      }
      sidebarHeader={
        !administrative &&
        (lexical || wals) && (
          <section className="geography-explorations" aria-label="Map explorations">
            {lexical && (
              <Suspense fallback={null}>
                <WordTrailMapSummary />
              </Suspense>
            )}
            {wals && (
              <Suspense fallback={null}>
                <WalsMapSummary />
              </Suspense>
            )}
          </section>
        )
      }
    />
  )
}
