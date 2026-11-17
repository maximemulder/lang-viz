import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { lazy, Suspense } from 'react'
import { ADMINISTRATIVE_ATTRIBUTION } from '../features/administrative/attribution.ts'
import {
  AREA_LABEL_LAYERS,
  AREA_POINT_LAYER,
  AREA_POLYGON_LAYER,
} from '../features/administrative/boundaryLayers.ts'
import {
  focusAdministrativeShapeAtom,
  hoveredAdministrativeAreaAtom,
  languageBordersAtom,
  selectAdministrativeAtom,
} from '../features/administrative/state.ts'
import GeographyWorkspace from '../features/map/GeographyWorkspace.tsx'
import { walsSessionAtom } from '../features/wals/state.ts'
import { explorerActionAtom, explorerSessionAtom } from '../state/explorerState.ts'
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
  const [languageBorders, setLanguageBorders] = useAtom(languageBordersAtom)
  const dispatch = useSetAtom(explorerActionAtom)
  const setHoveredArea = useSetAtom(hoveredAdministrativeAreaAtom)
  const selectArea = useSetAtom(selectAdministrativeAtom)
  const focusShape = useSetAtom(focusAdministrativeShapeAtom)
  return (
    <GeographyWorkspace
      visible={visible}
      administrative={administrative}
      mapAttribution={ADMINISTRATIVE_ATTRIBUTION}
      areaInteraction={{
        enabled: administrative,
        borders: administrative || languageBorders,
        onBordersChange: (borders) => {
          setHoveredArea(null)
          setLanguageBorders(borders)
        },
        onHoverModeChange: (mode) => {
          setHoveredArea(null)
          dispatch({ type: 'map-mode', mode })
        },
        hitLayers: [...AREA_LABEL_LAYERS, AREA_POINT_LAYER, AREA_POLYGON_LAYER],
        onHover: (area, longitude, latitude) =>
          setHoveredArea(area ? { ...area, longitude, latitude } : null),
        onSelect: (area) => {
          if (area)
            selectArea(
              area.territoryCode
                ? { kind: 'territory', id: area.territoryCode }
                : { kind: 'source-shape', id: area.featureId },
            )
        },
        onFocus: (area) => {
          focusShape(area.featureId)
        },
      }}
      mapLayers={
        <>
          {(administrative || languageBorders) && (
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
