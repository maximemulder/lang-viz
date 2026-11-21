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
  mapIsolationAtom,
  type RegionHit,
} from '../../state/mapInteraction.ts'
import { walsContextOpacityAtom } from '../wals/state.ts'
import { AtlasMapCamera } from './AtlasMapCamera'
import { type BackgroundMode, GEOGRAPHIC_BASEMAP } from './geographicBasemap'
import { InspectionHighlight } from './InspectionHighlight'
import { LanguageInspector, type MapInspection } from './LanguageInspector'
import { LanguageMapPreview } from './LanguageMapFocus'
import { LanguageLabels } from './labels/LanguageLabels.tsx'
import { pickLanguageVariants } from './languagePicking'
import { MapAttribution } from './MapAttribution'
import { MapBackground } from './MapBackground'
import { MapIsolationControls } from './MapIsolationControls.tsx'
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

export interface RegionInteraction {
  readonly enabled: boolean
  readonly borders: boolean
  readonly hitLayers: readonly string[]
  readonly languageFeatureIds: readonly string[]
  readonly onBordersChange: (enabled: boolean) => void
  readonly onHoverModeChange: (mode: 'language' | 'region') => void
  readonly onHover: (region: RegionHit | null) => void
  readonly onSelect: (region: RegionHit | null) => void
  readonly onFocus: (region: RegionHit) => void
  readonly onLanguageSelect: () => void
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
  const { lng, lat } = map.unproject(point)
  return {
    longitude: lng,
    latitude: lat,
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

const LanguageLayers = memo(({ regionMode }: { readonly regionMode: boolean }) => {
  const data = useAtomValue(atlasDataAtom)
  const walsOpacity = useAtomValue(walsContextOpacityAtom)
  const isolation = useAtomValue(mapIsolationAtom)
  const isolated = isolation?.kind === 'language' ? isolation : null
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
      isolated ? [...variantIds, ...isolated.variantIds] : variantIds,
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
        {isolated && (
          <Layer
            id="isolated-language-fill"
            beforeId="language-highlight-anchor"
            source-layer={data.manifest.vectorLayer}
            type="fill"
            filter={['in', ['get', 'variant_id'], ['literal', isolated.variantIds]]}
            paint={{
              'fill-color': isolated.color,
              'fill-opacity': 0.82,
              'fill-outline-color': isolated.color,
            }}
          />
        )}
      </Source>
      <OverlapHatching
        variants={areas}
        sourceVariantIds={variantIds}
        sourceColors={sourceColors}
        sourcePriorities={sourcePriorities}
        selectionKey={selectionKey}
        coverageReady={coverageReady}
        emphasisOpacity={regionMode ? 1 : walsOpacity}
        onCoverageReady={setCoverageKey}
      />
      <Layer id="language-highlight-anchor" type="background" paint={{ 'background-opacity': 0 }} />
      {!regionMode && (isolated || walsOpacity === 1) && (
        <LanguageLabels
          data={data}
          selectionKey={selectionKey}
          isolatedIds={isolated?.variantIds}
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
  const isolation = useAtomValue(mapIsolationAtom)
  const clearIsolation = useSetAtom(clearMapIsolationAtom)
  const openDetails = useSetAtom(inspectLanguageFromMapAtom)
  const focusLanguage = useSetAtom(focusLanguageOnMapAtom)
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
  const clickTimerRef = useRef<number | null>(null)

  const regionMode = regionInteraction.enabled
  const cancelClickTimer = useCallback(() => {
    if (clickTimerRef.current !== null) window.clearTimeout(clickTimerRef.current)
    clickTimerRef.current = null
  }, [])
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

  const cancelPendingHoverQuery = useCallback(() => {
    pendingHoverEventRef.current = null
    if (hoverQueryFrameRef.current !== null) {
      window.cancelAnimationFrame(hoverQueryFrameRef.current)
      hoverQueryFrameRef.current = null
    }
  }, [])

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
  const pickAtPointer = (event: MapLayerMouseEvent) => {
    const region = regionMode
      ? pickRegion(event.target, event.point, regionInteraction.hitLayers)
      : null
    if (regionMode && (!region || !regionInteraction.languageFeatureIds.includes(region.featureId)))
      return { ids: [], region }
    const ids = pickLanguageVariants(event.target, event.point, {
      data,
      areas,
      refinements,
      memberships,
      matching: Boolean(matches),
      isolated: isolation?.kind === 'language',
    })
    return { ids, region: ids.length ? null : region }
  }
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (inspectionRef.current) updateInspection(null)
      else clearIsolation()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [updateInspection, clearIsolation])
  const isolatedGeometry =
    isolation?.kind === 'language' ? isolation.variantIds : isolation?.featureIds
  const walsCategory = matches?.categoryId
  const previousInteraction = useRef({ regionMode, isolatedGeometry, walsCategory })
  useEffect(() => {
    const previous = previousInteraction.current
    if (
      previous.regionMode === regionMode &&
      previous.isolatedGeometry === isolatedGeometry &&
      previous.walsCategory === walsCategory
    )
      return
    previousInteraction.current = { regionMode, isolatedGeometry, walsCategory }
    cancelClickTimer()
    pendingClickRef.current = null
    lastHoverEventRef.current = null
    cancelPendingHoverQuery()
    hoverRef.current = null
    setHoverInspection(null)
    updateInspection(null)
  }, [
    regionMode,
    isolatedGeometry,
    walsCategory,
    cancelClickTimer,
    cancelPendingHoverQuery,
    updateInspection,
  ])
  const queryHover = (event: MapLayerMouseEvent) => {
    pendingHoverEventRef.current = event
    if (hoverQueryFrameRef.current !== null) return

    hoverQueryFrameRef.current = window.requestAnimationFrame(() => {
      hoverQueryFrameRef.current = null
      const latestEvent = pendingHoverEventRef.current
      pendingHoverEventRef.current = null
      if (!latestEvent) return

      const { ids, region } = pickAtPointer(latestEvent)
      if (regionMode) regionInteraction.onHover(region)
      const location = latestEvent.target.unproject(latestEvent.point)
      const nextInspection = inspectionFromVariants(ids, location.lng, location.lat, false)
      latestEvent.target.getCanvas().style.cursor = nextInspection || region ? 'pointer' : ''

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
    const { ids, region } = pickAtPointer(event)
    if (regionMode && !ids.length) return { kind: 'region', region }
    const languages = [...new Set(ids.map(languageForHit).filter((id): id is string => !!id))]
    const selectedArea = ids.length === 1 ? areas.find((area) => area.id === ids[0]) : null
    return {
      kind: 'language',
      ids,
      target:
        languages.length === 1 && languages[0]
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
      updateInspection(null)
      regionInteraction.onHover(null)
      regionInteraction.onSelect(hit.region)
      if (focus && hit.region) regionInteraction.onFocus(hit.region)
    } else if (hit.target) {
      if (regionMode) regionInteraction.onLanguageSelect()
      openDetails(hit.target)
      updateInspection(null)
      if (focus) focusLanguage(hit.target)
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
        if (event.originalEvent.detail >= 2) {
          cancelClickTimer()
          return
        }
        cancelClickTimer()
        const hit = resolveMapHit(event)
        pendingClickRef.current = hit
        // Opening details resizes the map, so let a second click use this original hit.
        clickTimerRef.current = window.setTimeout(() => {
          clickTimerRef.current = null
          activateMapHit(hit, false)
        }, 350)
      }}
      onDblClick={(event) => {
        event.preventDefault()
        cancelClickTimer()
        const hit = pendingClickRef.current ?? resolveMapHit(event)
        pendingClickRef.current = null
        activateMapHit(hit, true)
      }}
      onMoveStart={(event) => {
        if (regionMode) regionInteraction.onHover(null)
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
          if (lastHoverEventRef.current && !regionMode) queryHover(lastHoverEventRef.current)
        }
      }}
    >
      {!BASEMAP_DISABLED && <MapBackground mode={backgroundMode} />}
      <Suspense fallback={null}>
        <LanguageLayers regionMode={regionMode} />
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
          active={!regionMode && !isolation}
          mapInspectionActive={Boolean(hoverInspection || inspection)}
        />
      </Suspense>
      <AtlasMapCamera />
      {children}
      <NavigationControl position="top-right" showCompass={false} />
      <ScaleControl position="bottom-right" unit="metric" />
      <MapAttribution attribution={mapAttribution} />
      <MapIsolationControls />

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
            inspection={hoverInspection}
            onClose={() => {
              hoverRef.current = null
              setHoverInspection(null)
            }}
          />
        )}
        {inspection && (
          <LanguageInspector
            inspection={inspection}
            onClose={() => updateInspection(null)}
            {...(regionMode ? { onSelect: regionInteraction.onLanguageSelect } : {})}
          />
        )}
      </Suspense>
    </MapView>
  )
}
