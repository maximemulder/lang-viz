import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { lazy, Suspense } from 'react'
import { ADMINISTRATIVE_ATTRIBUTION } from '../features/administrative/attribution.ts'
import { AREA_POINT_LAYER, AREA_POLYGON_LAYER } from '../features/administrative/boundaryLayers.ts'
import {
  boundaryPresentationAtom,
  hoveredAdministrativeAreaAtom,
  selectAdministrativeAtom,
} from '../features/administrative/state.ts'
import GeographyWorkspace from '../features/map/GeographyWorkspace.tsx'
import { walsSessionAtom } from '../features/wals/state.ts'
import { explorerSessionAtom } from '../state/explorerState.ts'
import { wordTrailVisibleAtom } from './etymology/visibility.ts'
import './geographyExplorations.css'

const WordTrailLayer = lazy(() => import('./etymology/WordTrailLayer.tsx'))
const WordTrailMapSummary = lazy(() => import('./etymology/WordTrailMapSummary.tsx'))
const WalsLayer = lazy(() => import('./wals/WalsLayer.tsx'))
const WalsMapSummary = lazy(() => import('./wals/WalsMapSummary.tsx'))
const BoundaryLayer = lazy(() => import('../features/administrative/BoundaryLayer.tsx'))

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
  const [boundary, setBoundary] = useAtom(boundaryPresentationAtom)
  const setHoveredArea = useSetAtom(hoveredAdministrativeAreaAtom)
  const selectArea = useSetAtom(selectAdministrativeAtom)
  return (
    <GeographyWorkspace
      visible={visible}
      administrative={administrative}
      mapAttribution={ADMINISTRATIVE_ATTRIBUTION}
      areaInteraction={{
        enabled: boundary.hover === 'area',
        borders: boundary.borders,
        onBordersChange: (borders) => {
          setHoveredArea(null)
          setBoundary((current) => ({ ...current, borders }))
        },
        onHoverModeChange: (hover) => {
          setHoveredArea(null)
          setBoundary((current) => ({ ...current, hover }))
        },
        hitLayers: [AREA_POINT_LAYER, AREA_POLYGON_LAYER],
        onHover: (area, longitude, latitude) =>
          setHoveredArea(area ? { ...area, longitude, latitude } : null),
        onSelect: (area) => {
          if (area?.territoryCode) selectArea({ kind: 'territory', id: area.territoryCode })
        },
      }}
      mapLayers={
        <>
          {(administrative || boundary.borders || boundary.hover === 'area') && (
            <Suspense fallback={null}>
              <BoundaryLayer administrative={administrative} />
            </Suspense>
          )}
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
