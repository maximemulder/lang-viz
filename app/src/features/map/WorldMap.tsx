import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import type { FilterSpecification, MapLayerMouseEvent } from 'maplibre-gl'
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
import { isolatedLanguageIdAtom } from '../../state/mapInteraction'
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
  languageColorsAtom,
  mapEntriesAtom,
  overlapModeAtom,
  selectedMapAreasAtom,
  temporalViewAtom,
  viewportLanguageIdsAtom,
} from '../../state/atlasState'
import {
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
  const isolatedId = useAtomValue(isolatedLanguageIdAtom)
  const colors = useAtomValue(languageColorsAtom)
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
  const isolatedVariants =
    areas.find((area) => area.languageId === isolatedId)?.variants ??
    data.variants.filter(
      (v) =>
        v.languageId === isolatedId &&
        (datasetSelection === 'all' || datasetSelection.includes(v.datasetId)) &&
        (temporalSelection === 'all' || v.temporalCoverage.viewId === temporalSelection),
    )
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
        {isolatedId && (
          <Layer
            id="isolated-language-area"
            source={LANGUAGE_SOURCE_ID}
            source-layer={data.manifest.vectorLayer}
            type="fill"
            filter={['in', ['get', 'variant_id'], ['literal', isolatedVariants.map((v) => v.id)]]}
            paint={{ 'fill-color': colors.get(isolatedId) ?? '#71ac85', 'fill-opacity': 0.85 }}
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
        onCoverageReady={setCoverageKey}
      />
    </>
  )
})

const MapHint = () => {
  const entries = useAtomValue(mapEntriesAtom)
  const visibleInPeriodCount = useAtomValue(selectedMapAreasAtom).length
  const matches = useAtomValue(walsAreaMatchesAtom)
  const isolated = useAtomValue(isolatedLanguageIdAtom)
  if (matches || isolated) return null

  return (
    <div className={`map-hint${visibleInPeriodCount ? ' map-hint--active' : ''}`} role="status">
      <span className="map-hint__marker" aria-hidden="true" />
      {entries.length
        ? `${visibleInPeriodCount.toLocaleString()} of ${entries.length.toLocaleString()} map entries shown`
        : 'Select entries in Explore, then Add to map'}
    </div>
  )
}

export const WorldMap = ({ children }: { readonly children?: ReactNode }) => {
  const data = useAtomValue(atlasDataAtom)
  const [isolatedId, setIsolatedId] = useAtom(isolatedLanguageIdAtom)
  const matches = useAtomValue(walsAreaMatchesAtom)
  const openDetails = useSetAtom(openLanguageDetailsAtom)
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
  const setViewportLanguageIds = useSetAtom(viewportLanguageIdsAtom)

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
      isolatedId,
    })
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsolatedId(null)
        updateInspection(null)
      }
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [setIsolatedId, updateInspection])
  const interactionKey = `${isolatedId ?? ''}:${matches?.categoryId ?? ''}`
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

  // Pattern zoom fades blend two stripe phases and create false category colors.
  return (
    <MapView
      id="atlas-map"
      initialViewState={INITIAL_VIEW}
      mapStyle={MAP_STYLE}
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
      }}
      onClick={(event) => {
        cancelPendingHoverQuery()
        const ids = hitVariants(event)
        const primary = ids.length === 1 && ids[0] ? languageForHit(ids[0]) : null
        if (primary) openDetails({ languageId: primary, moveMap: false })
        updateInspection(inspectionFromVariants(ids, event.lngLat.lng, event.lngLat.lat, true))
      }}
      onDblClick={(event) => {
        event.preventDefault()
        cancelPendingHoverQuery()
        const ids = hitVariants(event)
        const unique = [
          ...new Set(ids.map(languageForHit).filter((id): id is string => Boolean(id))),
        ]
        if (unique.length === 1 && unique[0]) {
          setIsolatedId(unique[0])
          openDetails({ languageId: unique[0], moveMap: false })
          updateInspection(null)
        } else
          updateInspection(inspectionFromVariants(ids, event.lngLat.lng, event.lngLat.lat, true))
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
          if (lastHoverEventRef.current) queryHover(lastHoverEventRef.current)
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

      <MapSettings
        projectionMode={projectionMode}
        onProjectionChange={setProjectionMode}
        backgroundMode={backgroundMode}
        onBackgroundChange={setBackgroundMode}
      />

      <Suspense fallback={null}>
        <MapHint />
        {isolatedId && (
          <div className="map-isolation-control" role="status">
            <span>Only {data.languageById.get(isolatedId)?.name}</span>
            <button type="button" onClick={() => setIsolatedId(null)}>
              Show all again
            </button>
          </div>
        )}
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
