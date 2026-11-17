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
  mapEntriesAtom,
  overlapModeAtom,
  selectedMapAreasAtom,
  temporalViewAtom,
  viewportLanguageIdsAtom,
} from '../../state/atlasState'
import {
  focusLanguageOnMapAtom,
  languageMapNavigationAtom,
  languagePointerPreviewAtom,
  openLanguageDetailsAtom,
} from '../../state/languageControls'
import { mapCameraIntentAtom } from '../../state/mapCameraIntent.ts'
import { type BackgroundMode, GEOGRAPHIC_BASEMAP } from './geographicBasemap'
import { InspectionHighlight } from './InspectionHighlight'
import { LanguageInspector, type MapInspection } from './LanguageInspector'
import { LanguageMapCamera, LanguageMapPreview } from './LanguageMapFocus'
import { pickLanguageVariants } from './languagePicking'
import { MapAttribution } from './MapAttribution'
import { MapBackground } from './MapBackground'
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

export interface AreaHit {
  readonly featureId: string
  readonly sourceName: string
  readonly territoryCode: string | null
}

export interface AreaInteraction {
  readonly enabled: boolean
  readonly borders: boolean
  readonly hitLayers: readonly string[]
  readonly onBordersChange: (enabled: boolean) => void
  readonly onHoverModeChange: (mode: 'language' | 'area') => void
  readonly onHover: (area: AreaHit | null, longitude: number, latitude: number) => void
  readonly onSelect: (area: AreaHit | null) => void
  readonly onFocus: (area: AreaHit) => void
}

type MapHit =
  | { readonly kind: 'area'; readonly area: AreaHit | null }
  | {
      readonly kind: 'language'
      readonly ids: readonly string[]
      readonly target: { readonly languageId: string; readonly entryId?: string } | null
      readonly longitude: number
      readonly latitude: number
    }

const pickArea = (
  map: MapLibreMap,
  point: PointLike,
  layers: readonly string[],
): AreaHit | null => {
  const available = layers.filter((id) => map.getLayer(id))
  if (!available.length) return null
  const hit = map
    .queryRenderedFeatures(point, { layers: available })
    .find((feature) => typeof feature.properties?.featureId === 'string')
  if (!hit || typeof hit.properties?.sourceName !== 'string') return null
  return {
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
      <OverlapHatching
        variants={areas}
        sourceVariantIds={variantIds}
        sourceColors={sourceColors}
        sourcePriorities={sourcePriorities}
        selectionKey={selectionKey}
        coverageReady={coverageReady}
        onCoverageReady={setCoverageKey}
      />
    </>
  )
})

const MapHint = () => {
  const entries = useAtomValue(mapEntriesAtom)
  const visibleInPeriodCount = useAtomValue(selectedMapAreasAtom).length
  const matches = useAtomValue(walsAreaMatchesAtom)
  if (matches) return null

  return (
    <div className={`map-hint${visibleInPeriodCount ? ' map-hint--active' : ''}`} role="status">
      <span className="map-hint__marker" aria-hidden="true" />
      {entries.length
        ? `${visibleInPeriodCount.toLocaleString()} of ${entries.length.toLocaleString()} map entries shown`
        : 'Select entries in Explore, then Add to map'}
    </div>
  )
}

export const WorldMap = ({
  children,
  administrative,
  areaInteraction,
  mapAttribution,
}: {
  readonly children?: ReactNode
  readonly administrative: boolean
  readonly areaInteraction: AreaInteraction
  readonly mapAttribution: string
}) => {
  const data = useAtomValue(atlasDataAtom)
  const initializeDefaultMap = useSetAtom(initializeDefaultMapAtom)
  useEffect(() => initializeDefaultMap(), [initializeDefaultMap])
  const matches = useAtomValue(walsAreaMatchesAtom)
  const openDetails = useSetAtom(openLanguageDetailsAtom)
  const focusLanguage = useSetAtom(focusLanguageOnMapAtom)
  const [hoverInspection, setHoverInspection] = useState<MapInspection | null>(null)
  const hoverRef = useRef<MapInspection | null>(null)
  const sidebarPointer = useAtomValue(languagePointerPreviewAtom)
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
  const viewportDirtyRef = useRef(true)
  const pendingClickRef = useRef<MapHit | null>(null)
  const clickTimerRef = useRef<number | null>(null)
  const setViewportLanguageIds = useSetAtom(viewportLanguageIdsAtom)

  const areaMode = areaInteraction.enabled
  const cancelClickTimer = useCallback(() => {
    if (clickTimerRef.current !== null) window.clearTimeout(clickTimerRef.current)
    clickTimerRef.current = null
  }, [])
  useEffect(() => {
    cancelClickTimer()
    pendingClickRef.current = null
    if (!areaMode) return
    pendingHoverEventRef.current = null
    if (hoverQueryFrameRef.current !== null) {
      window.cancelAnimationFrame(hoverQueryFrameRef.current)
      hoverQueryFrameRef.current = null
    }
    hoverRef.current = null
    setHoverInspection(null)
    inspectionRef.current = null
    setInspection(null)
  }, [areaMode, cancelClickTimer])

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
    pickLanguageVariants(event.target, event.point, {
      data,
      areas,
      refinements,
      memberships,
      matching: Boolean(matches),
    })
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') updateInspection(null)
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [updateInspection])
  const interactionKey = matches?.categoryId ?? ''
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

      if (!hasSameVariants(hoverRef.current, nextInspection)) {
        hoverRef.current = nextInspection
        setHoverInspection(nextInspection)
      }
    })
  }

  const resolveMapHit = (event: MapLayerMouseEvent): MapHit => {
    if (areaInteraction.enabled) {
      return { kind: 'area', area: pickArea(event.target, event.point, areaInteraction.hitLayers) }
    }
    const ids = hitVariants(event)
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
    if (hit.kind === 'area') {
      areaInteraction.onSelect(hit.area)
      if (focus && hit.area) areaInteraction.onFocus(hit.area)
    } else if (hit.target) {
      openDetails({ ...hit.target, moveMap: false })
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
        if (areaInteraction?.enabled) {
          const area = pickArea(event.target, event.point, areaInteraction.hitLayers)
          event.target.getCanvas().style.cursor = area ? 'pointer' : ''
          areaInteraction.onHover(area, event.lngLat.lng, event.lngLat.lat)
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
        areaInteraction?.onHover(null, 0, 0)
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
        if (event.originalEvent) setCameraIntent(null)
        inspectionDirtyRef.current = true
        viewportDirtyRef.current = true
      }}
      onSourceData={(event) => {
        if (event.sourceId?.startsWith('language-overlap-regions-'))
          inspectionDirtyRef.current = true
        if (event.sourceId === LANGUAGE_SOURCE_ID) viewportDirtyRef.current = true
      }}
      onIdle={(event) => {
        if (inspectionDirtyRef.current) {
          inspectionDirtyRef.current = false
          if (lastHoverEventRef.current && !areaInteraction?.enabled)
            queryHover(lastHoverEventRef.current)
        }

        // Hover repaints also become idle; viewport discovery only needs new
        // camera/source data, not a scan of every language on each hover.
        if (!viewportDirtyRef.current || !event.target.getLayer(LANGUAGE_HIT_LAYER_ID)) return
        viewportDirtyRef.current = false
        const languageIds = event.target
          .queryRenderedFeatures({ layers: [LANGUAGE_HIT_LAYER_ID] })
          .flatMap((feature) => {
            const languageId = feature.properties.language_id
            return typeof languageId === 'string' ? [languageId] : []
          })
        setViewportLanguageIds([...new Set(languageIds)])
      }}
    >
      {!BASEMAP_DISABLED && <MapBackground mode={backgroundMode} />}
      <Suspense fallback={null}>
        <LanguageLayers />
        <Layer
          id="language-highlight-anchor"
          type="background"
          paint={{ 'background-opacity': 0 }}
        />
        <InspectionHighlight
          variantIds={
            sidebarPointer
              ? NO_VARIANT_IDS
              : (hoverInspection?.variantIds ?? inspection?.variantIds ?? NO_VARIANT_IDS)
          }
        />
        <LanguageMapPreview mapInspectionActive={Boolean(hoverInspection || inspection)} />
        {hoverInspection &&
          !sidebarPointer &&
          hoverInspection.variantIds.every((id) => !areas.some((area) => area.id === id)) && (
            <GeometryPreview
              key={JSON.stringify(hoverInspection.variantIds)}
              ids={hoverInspection.variantIds}
              fillOpacity={0}
            />
          )}
        <LanguageMapCamera />
      </Suspense>
      {children}
      <NavigationControl position="top-right" showCompass={false} />
      <ScaleControl position="bottom-right" unit="metric" />
      <MapAttribution attribution={mapAttribution} />

      <MapSettings
        projectionMode={projectionMode}
        onProjectionChange={setProjectionMode}
        backgroundMode={backgroundMode}
        onBackgroundChange={setBackgroundMode}
        areaInteraction={areaInteraction}
      />

      <Suspense fallback={null}>
        {!administrative && <MapHint />}
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
          <LanguageInspector inspection={inspection} onClose={() => updateInspection(null)} />
        )}
      </Suspense>
    </MapView>
  )
}
