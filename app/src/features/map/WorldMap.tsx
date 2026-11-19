import { useAtomValue, useSetAtom } from 'jotai'
import type {
  FilterSpecification,
  MapLayerMouseEvent,
  Map as MapLibreMap,
  PointLike,
} from 'maplibre-gl'
import { addProtocol, setWorkerUrl } from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { Protocol } from 'pmtiles'
import {
  memo,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import MapView, { Layer, NavigationControl, ScaleControl, Source } from 'react-map-gl/maplibre'
import { walsAreaMatchesAtom } from '../../integrations/wals/areaState'
import { GeometryPreview } from './geometry/GeometryPreview'
import 'maplibre-gl/dist/maplibre-gl.css'
import { languageArchiveUrl } from '../../data/atlasRepository'
import { selectGeometryArchives } from '../../data/geometryArchives'
import { geometryTileUrl } from '../../data/geometryProtocol'
import {
  mapAreaMemberships,
  mapAreaRefinements,
  mapAreaSelectionKey,
  mapAreaSourceColors,
  mapAreaSourcePriorities,
} from '../../domain/aggregation'
import {
  atlasDataAtom,
  geographyDatasetFilterAtom,
  initializeDefaultMapAtom,
  overlapModeAtom,
  selectedMapAreasAtom,
  temporalViewAtom,
} from '../../state/atlasState'
import {
  focusLanguageOnMapAtom,
  inspectLanguageFromMapAtom,
  languageMapNavigationAtom,
} from '../../state/languageControls'
import { mapCameraIntentAtom } from '../../state/mapCameraIntent.ts'
import {
  clearMapIsolationAtom,
  mapColorsVisibleAtom,
  mapIsolationAtom,
} from '../../state/mapInteraction.ts'
import { type BackgroundMode, GEOGRAPHIC_BASEMAP } from './geographicBasemap'
import { InspectionHighlight } from './InspectionHighlight'
import {
  inspectLanguageInRegion,
  isDoubleMapClick,
  MAP_DOUBLE_CLICK_MS,
} from './interactionRules.ts'
import { LanguageInspector, type MapInspection } from './LanguageInspector'
import { LanguageMapCamera, LanguageMapPreview } from './LanguageMapFocus'
import { LanguageZoom } from './LanguageZoom.tsx'
import { orderLanguageHits, pickLanguageVariants } from './languagePicking'
import { MapAttribution } from './MapAttribution'
import { MapBackground } from './MapBackground'
import {
  IsolatedLanguageLayer,
  IsolationControls,
  IsolationOverview,
  MapSelectionCamera,
} from './MapIsolation.tsx'
import { MapSettings, type ProjectionMode } from './MapSettings'
import { diagnosticsEnabled } from './overlap/diagnostics'
import { OverlapHatching } from './overlap/OverlapHatching'

setWorkerUrl(maplibreWorkerUrl)
const pmtilesProtocol = new Protocol()
addProtocol('pmtiles', pmtilesProtocol.tile)

const BASEMAP_DISABLED =
  diagnosticsEnabled && new URLSearchParams(location.search).get('overlap-basemap') === 'off'
const MAP_STYLE = BASEMAP_DISABLED
  ? {
      ...GEOGRAPHIC_BASEMAP,
      sources: {},
      layers: GEOGRAPHIC_BASEMAP.layers.filter((layer) => layer.type === 'background'),
    }
  : GEOGRAPHIC_BASEMAP

const INITIAL_VIEW = {
  longitude: 12,
  latitude: 18,
  zoom: 1.35,
} as const

const PROJECTIONS = {
  globe: { type: 'vertical-perspective' },
  mercator: { type: 'mercator' },
} as const

const LANGUAGE_SOURCE_ID = 'language-areas'
const LANGUAGE_HIT_LAYER_ID = 'language-area-hit-targets'
const NO_VARIANT_IDS: readonly string[] = []

export interface RegionHit {
  readonly featureId: string
  readonly sourceName: string
  readonly territoryCode: string | null
  readonly longitude: number
  readonly latitude: number
}

export interface RegionInteraction {
  readonly enabled: boolean
  readonly borders: boolean
  readonly languageHoverFeatureIds: readonly string[]
  readonly hitLayers: readonly string[]
  readonly onBordersChange: (enabled: boolean) => void
  readonly onHoverModeChange: (mode: 'language' | 'region') => void
  readonly onHover: (region: RegionHit | null) => void
  readonly onLanguageSelect: () => void
  readonly onSelect: (region: RegionHit | null) => void
  readonly onFocus: (region: RegionHit) => void
}

type MapHit =
  | { readonly kind: 'region'; readonly region: RegionHit | null }
  | {
      readonly kind: 'language'
      readonly ids: readonly string[]
      readonly target: { readonly languageId: string; readonly entryId?: string } | null
      readonly longitude: number
      readonly latitude: number
    }

const pickRegion = (
  map: MapLibreMap,
  point: PointLike,
  layers: readonly string[],
): RegionHit | null => {
  const available = layers.filter((id) => map.getLayer(id))
  if (!available.length) return null
  const hit = map
    .queryRenderedFeatures(point, { layers: available })
    .find((feature) => typeof feature.properties?.featureId === 'string')
  if (!hit || typeof hit.properties?.sourceName !== 'string') return null
  return {
    longitude: map.unproject(point).lng,
    latitude: map.unproject(point).lat,
    featureId: hit.properties.featureId,
    sourceName: hit.properties.sourceName,
    territoryCode:
      typeof hit.properties.territoryCode === 'string' ? hit.properties.territoryCode : null,
  }
}

const inspectionFromVariants = (
  variantIds: readonly string[],
  longitude: number,
  latitude: number,
  pinned: boolean,
): MapInspection | null => {
  return variantIds.length > 0 ? { longitude, latitude, variantIds, pinned } : null
}

const hasSameVariants = (left: MapInspection | null, right: MapInspection | null) => {
  if (left === right) return true
  if (!left || !right || left.variantIds.length !== right.variantIds.length) return false
  return left.variantIds.every((variantId, index) => variantId === right.variantIds[index])
}

const LanguageLayers = memo(() => {
  const isolation = useAtomValue(mapIsolationAtom)
  const colorsVisible = useAtomValue(mapColorsVisibleAtom)
  const data = useAtomValue(atlasDataAtom)
  const temporalSelection = useAtomValue(temporalViewAtom)
  const datasetSelection = useAtomValue(geographyDatasetFilterAtom)
  const overlapMode = useAtomValue(overlapModeAtom)
  const [coverageKey, setCoverageKey] = useState<string | null>(null)
  const areas = useAtomValue(selectedMapAreasAtom)
  const memberships = mapAreaMemberships(areas)
  const variantIds = Object.keys(memberships).sort()
  const sourceColors = mapAreaSourceColors(areas)
  const sourcePriorities = mapAreaSourcePriorities(areas)
  const selectionKey = mapAreaSelectionKey(areas, overlapMode)
  const coverageReady = coverageKey === selectionKey
  const temporalFilter: FilterSpecification =
    temporalSelection === 'all'
      ? ['has', 'variant_id']
      : ['==', ['get', 'temporal_view'], temporalSelection]
  const datasetFilter: FilterSpecification =
    datasetSelection === 'all'
      ? ['has', 'dataset_id']
      : ['in', ['get', 'dataset_id'], ['literal', datasetSelection]]
  const availableGeometryFilter: FilterSpecification = ['all', temporalFilter, datasetFilter]
  const archiveUrl = languageArchiveUrl(
    selectGeometryArchives(
      data.manifest,
      data.variants,
      datasetSelection,
      temporalSelection,
      variantIds,
    ),
  ).replace(/^pmtiles:\/\//, '')

  return (
    <>
      <Source
        id={LANGUAGE_SOURCE_ID}
        type="vector"
        promoteId="variant_id"
        tiles={[geometryTileUrl(archiveUrl)]}
        minzoom={0}
        maxzoom={data.manifest.geometryMaxZoom ?? 8}
        attribution="Language areas: Asher & Moseley (2007), Bouckaert et al. (2012), Carling et al. (2025)"
      >
        <Layer
          id={LANGUAGE_HIT_LAYER_ID}
          source={LANGUAGE_SOURCE_ID}
          source-layer={data.manifest.vectorLayer}
          type="fill"
          filter={availableGeometryFilter}
          paint={{ 'fill-color': '#000000', 'fill-opacity': 0 }}
        />
      </Source>
      <IsolatedLanguageLayer />
      {colorsVisible && isolation?.kind !== 'language' && (
        <OverlapHatching
          variants={areas}
          sourceVariantIds={variantIds}
          sourceColors={sourceColors}
          sourcePriorities={sourcePriorities}
          selectionKey={selectionKey}
          coverageReady={coverageReady}
          onCoverageReady={setCoverageKey}
        />
      )}
    </>
  )
})

export const WorldMap = ({
  children,
  regionInteraction,
  mapAttribution,
}: {
  readonly children?: ReactNode
  readonly regionInteraction: RegionInteraction
  readonly mapAttribution: string
}) => {
  const data = useAtomValue(atlasDataAtom)
  const initializeDefaultMap = useSetAtom(initializeDefaultMapAtom)
  useEffect(() => initializeDefaultMap(), [initializeDefaultMap])
  const matches = useAtomValue(walsAreaMatchesAtom)
  const colorsVisible = useAtomValue(mapColorsVisibleAtom)
  const isolation = useAtomValue(mapIsolationAtom)
  const openDetails = useSetAtom(inspectLanguageFromMapAtom)
  const focusLanguage = useSetAtom(focusLanguageOnMapAtom)
  const clearIsolation = useSetAtom(clearMapIsolationAtom)
  const [hoverInspection, setHoverInspection] = useState<MapInspection | null>(null)
  const hoverRef = useRef<MapInspection | null>(null)
  const navigation = useAtomValue(languageMapNavigationAtom)
  const setCameraIntent = useSetAtom(mapCameraIntentAtom)
  const lastNavigation = useRef(navigation)
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>('terrain')
  const [projectionMode, setProjectionMode] = useState<ProjectionMode>('mercator')
  const [inspection, setInspection] = useState<MapInspection | null>(null)
  const areas = useAtomValue(selectedMapAreasAtom)
  const inspectionSelectionKey = useMemo(() => mapAreaSelectionKey(areas), [areas])
  const refinements = useMemo(() => mapAreaRefinements(areas), [areas])
  const memberships = useMemo(() => mapAreaMemberships(areas), [areas])
  const inspectionRef = useRef<MapInspection | null>(null)
  const inspectionFilterRef = useRef({
    inspectionSelectionKey,
  })
  const lastHoverEventRef = useRef<MapLayerMouseEvent | null>(null)
  const inspectionDirtyRef = useRef(false)
  const pendingHoverEventRef = useRef<MapLayerMouseEvent | null>(null)
  const hoverQueryFrameRef = useRef<number | null>(null)
  const pendingClickRef = useRef<MapHit | null>(null)
  const clickPositionRef = useRef<{ x: number; y: number; time: number } | null>(null)
  const lastDoubleClickRef = useRef(-Infinity)
  const clickTimerRef = useRef<number | null>(null)

  const regionMode = regionInteraction.enabled
  const cancelClickTimer = useCallback(() => {
    if (clickTimerRef.current !== null) window.clearTimeout(clickTimerRef.current)
    clickTimerRef.current = null
  }, [])
  useEffect(() => {
    cancelClickTimer()
    pendingClickRef.current = null
    clickPositionRef.current = null
    if (!regionMode) return
    pendingHoverEventRef.current = null
    if (hoverQueryFrameRef.current !== null) {
      window.cancelAnimationFrame(hoverQueryFrameRef.current)
      hoverQueryFrameRef.current = null
    }
    hoverRef.current = null
    setHoverInspection(null)
    inspectionRef.current = null
    setInspection(null)
  }, [regionMode, cancelClickTimer])

  useEffect(() => () => cancelClickTimer(), [cancelClickTimer])

  const updateInspection = useCallback((nextInspection: MapInspection | null) => {
    inspectionRef.current = nextInspection
    setInspection(nextInspection)
  }, [])

  useEffect(() => {
    if (lastNavigation.current !== navigation) {
      lastNavigation.current = navigation
      if (navigation) {
        cancelPendingHoverQuery()
        updateInspection(null)
      }
    }
    const previousFilters = inspectionFilterRef.current
    if (previousFilters.inspectionSelectionKey !== inspectionSelectionKey) {
      inspectionFilterRef.current = { inspectionSelectionKey }
      cancelPendingHoverQuery()
      updateInspection(null)
      hoverRef.current = null
      setHoverInspection(null)
    }
  })

  const cancelPendingHoverQuery = () => {
    pendingHoverEventRef.current = null
    if (hoverQueryFrameRef.current !== null) {
      window.cancelAnimationFrame(hoverQueryFrameRef.current)
      hoverQueryFrameRef.current = null
    }
  }

  useEffect(
    () => () => {
      pendingHoverEventRef.current = null
      if (hoverQueryFrameRef.current !== null) {
        window.cancelAnimationFrame(hoverQueryFrameRef.current)
      }
    },
    [],
  )

  const languageForHit = (id: string) =>
    areas.find((area) => area.id === id)?.languageId ?? data.variantById.get(id)?.languageId
  const hitVariants = (event: MapLayerMouseEvent) =>
    orderLanguageHits(
      pickLanguageVariants(event.target, event.point, {
        data,
        areas,
        refinements,
        memberships,
        matching: Boolean(matches),
        isolation,
      }),
      data,
      areas,
    )
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        updateInspection(null)
        clearIsolation()
      }
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [updateInspection, clearIsolation])
  const interactionKey = `${matches?.categoryId ?? ''}:${isolation?.kind ?? ''}:${isolation?.id ?? ''}`
  const previousInteractionKey = useRef(interactionKey)
  useEffect(() => {
    if (previousInteractionKey.current === interactionKey) return
    previousInteractionKey.current = interactionKey
    hoverRef.current = null
    setHoverInspection(null)
    updateInspection(null)
  }, [interactionKey, updateInspection])
  const queryHover = (event: MapLayerMouseEvent) => {
    pendingHoverEventRef.current = event
    if (hoverQueryFrameRef.current !== null) return

    hoverQueryFrameRef.current = window.requestAnimationFrame(() => {
      hoverQueryFrameRef.current = null
      const latestEvent = pendingHoverEventRef.current
      pendingHoverEventRef.current = null
      if (!latestEvent) return

      const location = latestEvent.target.unproject(latestEvent.point)
      const nextInspection = inspectionFromVariants(
        hitVariants(latestEvent),
        location.lng,
        location.lat,
        false,
      )
      latestEvent.target.getCanvas().style.cursor = nextInspection ? 'pointer' : ''

      const previous = hoverRef.current
      if (hasSameVariants(previous, nextInspection)) {
        if (!previous || !nextInspection) return
        if (
          previous.longitude === nextInspection.longitude &&
          previous.latitude === nextInspection.latitude
        )
          return
        // Keep the variant IDs stable so moving the popup does not repaint the outline.
        hoverRef.current = {
          ...previous,
          longitude: nextInspection.longitude,
          latitude: nextInspection.latitude,
        }
      } else {
        hoverRef.current = nextInspection
      }
      setHoverInspection(hoverRef.current)
    })
  }

  const resolveMapHit = (event: MapLayerMouseEvent): MapHit => {
    if (regionInteraction.enabled) {
      const region = pickRegion(event.target, event.point, regionInteraction.hitLayers)
      const inside = region && regionInteraction.languageHoverFeatureIds.includes(region.featureId)
      if (
        !inspectLanguageInRegion(
          region?.featureId ?? null,
          regionInteraction.languageHoverFeatureIds,
          Boolean(inside && hitVariants(event).length),
        )
      )
        return { kind: 'region', region }
    }
    const ids = hitVariants(event)
    const languages = [...new Set(ids.map(languageForHit).filter((id): id is string => !!id))].sort(
      (a, b) =>
        Number(
          data.languageById.get(b)?.level === 'language' ||
            data.languageById.get(b)?.level === 'dialect',
        ) -
        Number(
          data.languageById.get(a)?.level === 'language' ||
            data.languageById.get(a)?.level === 'dialect',
        ),
    )
    const selectedArea = ids.length === 1 ? areas.find((area) => area.id === ids[0]) : null
    return {
      kind: 'language',
      ids,
      target: languages[0]
        ? {
            languageId: languages[0],
            ...(selectedArea ? { entryId: selectedArea.id } : {}),
          }
        : null,
      longitude: event.lngLat.lng,
      latitude: event.lngLat.lat,
    }
  }

  const activateMapHit = (hit: MapHit, focus: boolean) => {
    cancelPendingHoverQuery()
    if (hit.kind === 'region') {
      if (!hit.region) return
      regionInteraction.onSelect(hit.region)
      if (focus) regionInteraction.onFocus(hit.region)
    } else if (hit.target) {
      if (regionInteraction.enabled) regionInteraction.onLanguageSelect()
      openDetails(hit.target)
      updateInspection(null)
      if (focus) focusLanguage({ ...hit.target, point: [hit.longitude, hit.latitude] })
    } else {
      // Several languages at this point still require an explicit choice in the popup.
      updateInspection(inspectionFromVariants(hit.ids, hit.longitude, hit.latitude, true))
    }
  }

  // Pattern zoom fades blend two stripe phases and create false category colors.
  return (
    <MapView
      id="atlas-map"
      initialViewState={INITIAL_VIEW}
      mapStyle={MAP_STYLE}
      attributionControl={false}
      projection={PROJECTIONS[projectionMode]}
      minZoom={0.5}
      maxZoom={12}
      renderWorldCopies={false}
      fadeDuration={0}
      doubleClickZoom={false}
      reuseMaps
      onMouseMove={(event) => {
        if (regionInteraction.enabled) {
          const region = pickRegion(event.target, event.point, regionInteraction.hitLayers)
          if (region && regionInteraction.languageHoverFeatureIds.includes(region.featureId)) {
            regionInteraction.onHover(null)
            lastHoverEventRef.current = event
            queryHover(event)
          } else {
            event.target.getCanvas().style.cursor = region ? 'pointer' : ''
            hoverRef.current = null
            setHoverInspection(null)
            regionInteraction.onHover(region)
          }
          return
        }
        lastHoverEventRef.current = event
        queryHover(event)
      }}
      onMouseOut={(event) => {
        lastHoverEventRef.current = null
        cancelPendingHoverQuery()
        event.target.getCanvas().style.cursor = ''
        hoverRef.current = null
        setHoverInspection(null)
        regionInteraction?.onHover(null)
      }}
      onClick={(event) => {
        const now = performance.now()
        const point = { x: event.point.x, y: event.point.y, time: now }
        const previousHit = pendingClickRef.current
        if (
          (previousHit && isDoubleMapClick(clickPositionRef.current, point)) ||
          event.originalEvent.detail >= 2
        ) {
          cancelClickTimer()
          pendingClickRef.current = null
          clickPositionRef.current = null
          lastDoubleClickRef.current = now
          activateMapHit(previousHit ?? resolveMapHit(event), true)
          return
        }
        cancelClickTimer()
        const hit = resolveMapHit(event)
        pendingClickRef.current = hit
        clickPositionRef.current = point
        // Do not resize the map or move the camera between the two clicks.
        clickTimerRef.current = window.setTimeout(() => {
          clickTimerRef.current = null
          pendingClickRef.current = null
          clickPositionRef.current = null
          activateMapHit(hit, false)
        }, MAP_DOUBLE_CLICK_MS)
      }}
      onDblClick={(event) => {
        event.preventDefault()
        // The second click already zoomed to the original hit. A native dblclick
        // must not pick again after the camera, sidebar or view has changed.
        const now = performance.now()
        if (now - lastDoubleClickRef.current <= MAP_DOUBLE_CLICK_MS) return
        cancelClickTimer()
        const hit = pendingClickRef.current ?? resolveMapHit(event)
        pendingClickRef.current = null
        clickPositionRef.current = null
        lastDoubleClickRef.current = now
        activateMapHit(hit, true)
      }}
      onMoveStart={(event) => {
        regionInteraction.onHover(null)
        if (event.originalEvent) setCameraIntent(null)
        inspectionDirtyRef.current = true
      }}
      onSourceData={(event) => {
        if (event.sourceId?.startsWith('language-overlap-regions-'))
          inspectionDirtyRef.current = true
      }}
      onIdle={() => {
        if (inspectionDirtyRef.current) {
          inspectionDirtyRef.current = false
          if (lastHoverEventRef.current && !regionInteraction?.enabled)
            queryHover(lastHoverEventRef.current)
        }
      }}
    >
      {!BASEMAP_DISABLED && (
        <MapBackground mode={isolation || !colorsVisible ? 'minimal' : backgroundMode} />
      )}
      <Suspense fallback={null}>
        <LanguageLayers />
        <Layer
          id="language-highlight-anchor"
          type="background"
          paint={{ 'background-opacity': 0 }}
        />
        <InspectionHighlight
          variantIds={hoverInspection?.variantIds ?? inspection?.variantIds ?? NO_VARIANT_IDS}
        />
        {hoverInspection?.variantIds.every((id) => !areas.some((area) => area.id === id)) && (
          <GeometryPreview
            key={JSON.stringify(hoverInspection.variantIds)}
            id="language-hover"
            ids={hoverInspection.variantIds}
            fillOpacity={0}
            coordinateDisplay={false}
          />
        )}
        <LanguageMapPreview
          active={!regionMode && colorsVisible && !isolation}
          mapInspectionActive={Boolean(hoverInspection || inspection)}
        />
        {!regionMode && colorsVisible && <LanguageZoom />}
        <LanguageMapCamera />
        <IsolationOverview />
        <MapSelectionCamera />
      </Suspense>
      {children}
      <NavigationControl position="top-right" showCompass={false} />
      <ScaleControl position="bottom-right" unit="metric" />
      <MapAttribution attribution={mapAttribution} />

      <IsolationControls />
      <MapSettings
        projectionMode={projectionMode}
        onProjectionChange={setProjectionMode}
        backgroundMode={backgroundMode}
        onBackgroundChange={setBackgroundMode}
        regionInteraction={regionInteraction}
      />

      <Suspense fallback={null}>
        {hoverInspection && !inspection && (
          <LanguageInspector
            regionView={regionMode}
            inspection={hoverInspection}
            onClose={() => {
              hoverRef.current = null
              setHoverInspection(null)
            }}
          />
        )}
        {inspection && (
          <LanguageInspector inspection={inspection} onClose={() => updateInspection(null)} />
        )}
      </Suspense>
    </MapView>
  )
}
