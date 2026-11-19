import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { lazy, Suspense } from 'react'
import { ADMINISTRATIVE_ATTRIBUTION } from '../features/administrative/attribution.ts'
import {
  REGION_LABEL_LAYERS,
  REGION_POINT_LAYER,
  REGION_POLYGON_LAYER,
} from '../features/administrative/boundaryLayers.ts'
import {
  administrativeHoverAtom,
  administrativeSessionAtom,
  boundaryIndexAtom,
  focusAdministrativeShapeAtom,
  hoveredAdministrativeRegionAtom,
  languageBordersAtom,
  selectAdministrativeAtom,
} from '../features/administrative/state.ts'
import GeographyWorkspace from '../features/map/GeographyWorkspace.tsx'
import { walsSessionAtom } from '../features/wals/state.ts'
import { explorerActionAtom, explorerSessionAtom } from '../state/explorerState.ts'
import {
  clearMapIsolationAtom,
  mapColorsVisibleAtom,
  mapIsolationAtom,
} from '../state/mapInteraction.ts'
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
  const colorsVisible = useAtomValue(mapColorsVisibleAtom)
  const regionSelection = useAtomValue(administrativeSessionAtom).selection
  const isolation = useAtomValue(mapIsolationAtom)
  const boundaryIndex = useAtomValue(boundaryIndexAtom)
  const clearIsolation = useSetAtom(clearMapIsolationAtom)
  const lexical = useAtomValue(explorerSessionAtom).overlay.enabled
  const wordVisible = useAtomValue(wordTrailVisibleAtom)
  const wals = useAtomValue(walsSessionAtom).overlay
  const [languageBorders, setLanguageBorders] = useAtom(languageBordersAtom)
  const dispatch = useSetAtom(explorerActionAtom)
  const setRegionHover = useSetAtom(administrativeHoverAtom)
  const setHoveredRegion = useSetAtom(hoveredAdministrativeRegionAtom)
  const selectRegion = useSetAtom(selectAdministrativeAtom)
  const focusShape = useSetAtom(focusAdministrativeShapeAtom)
  return (
    <GeographyWorkspace
      visible={visible}
      administrative={administrative}
      mapAttribution={ADMINISTRATIVE_ATTRIBUTION}
      regionInteraction={{
        enabled: administrative,
        borders: administrative || languageBorders,
        onBordersChange: (borders) => {
          setHoveredRegion(null)
          setRegionHover(null)
          setLanguageBorders(borders)
        },
        onHoverModeChange: (mode) => {
          setHoveredRegion(null)
          setRegionHover(null)
          clearIsolation()
          dispatch({ type: 'map-mode', mode })
        },
        languageHoverFeatureIds:
          isolation?.kind === 'region'
            ? isolation.featureIds
            : regionSelection?.kind === 'territory'
              ? (boundaryIndex?.associations.get(regionSelection.id)?.featureIds ?? [])
              : regionSelection?.kind === 'source-shape'
                ? [regionSelection.id]
                : [],
        hitLayers: [...REGION_LABEL_LAYERS, REGION_POINT_LAYER, REGION_POLYGON_LAYER],
        onHover: (region) => {
          setHoveredRegion(region?.featureId ?? null)
          setRegionHover(region)
        },
        onLanguageSelect: () => dispatch({ type: 'map-mode', mode: 'language' }),
        onSelect: (region) => {
          if (region)
            selectRegion(
              region.territoryCode
                ? { kind: 'territory', id: region.territoryCode }
                : { kind: 'source-shape', id: region.featureId },
            )
        },
        onFocus: (region) => {
          focusShape(region.featureId)
        },
      }}
      mapLayers={
        <>
          {(administrative || languageBorders) && (
            <Suspense fallback={null}>
              <BoundaryLayer administrative={administrative} />
            </Suspense>
          )}
          {lexical && wordVisible && !administrative && !isolation && colorsVisible && (
            <Suspense fallback={null}>
              <WordTrailLayer />
            </Suspense>
          )}
          {wals?.visible && visible && !administrative && !isolation && colorsVisible && (
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
