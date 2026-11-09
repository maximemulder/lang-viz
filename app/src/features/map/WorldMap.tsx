import { useAtomValue, useSetAtom } from 'jotai'
import type { FilterSpecification, MapLayerMouseEvent } from 'maplibre-gl'
import { addProtocol, setWorkerUrl } from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { Protocol } from 'pmtiles'
import { memo, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import MapView, { Layer, NavigationControl, ScaleControl, Source } from 'react-map-gl/maplibre'
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
  languageOpacityAtom,
  mapEntriesAtom,
  overlapModeAtom,
  selectedMapAreasAtom,
  temporalViewAtom,
  viewportLanguageIdsAtom,
} from '../../state/atlasState'
import { type BackgroundMode, GEOGRAPHIC_BASEMAP } from './geographicBasemap'
import { InspectionHighlight } from './InspectionHighlight'
import { visibleVariantIds } from './inspection'
import { LanguageInspector, type MapInspection } from './LanguageInspector'
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
const SELECTED_LANGUAGE_LAYER_ID = 'selected-language-areas'
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
  const temporalSelection = useAtomValue(temporalViewAtom)
  const datasetSelection = useAtomValue(geographyDatasetFilterAtom)
  const overlapMode = useAtomValue(overlapModeAtom)
  const opacity = useAtomValue(languageOpacityAtom)
  const [coverageKey, setCoverageKey] = useState<string | null>(null)
  const areas = useAtomValue(selectedMapAreasAtom)
  const memberships = mapAreaMemberships(areas)
  const variantIds = Object.keys(memberships).sort()
  const sourceColors = mapAreaSourceColors(areas)
  const sourcePriorities = mapAreaSourcePriorities(areas)
  const selectionKey = mapAreaSelectionKey(areas, overlapMode)
  const hasComposition = areas.some(
    ({ mode, refines }) => mode === 'descendants' || refines?.length,
  )
  const coverageReady =
    (overlapMode === 'hatching' || hasComposition) && coverageKey === selectionKey
  const filter: FilterSpecification = ['in', ['get', 'variant_id'], ['literal', variantIds]]
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
        <Layer
          id={SELECTED_LANGUAGE_LAYER_ID}
          source={LANGUAGE_SOURCE_ID}
          source-layer={data.manifest.vectorLayer}
          type="fill"
          filter={filter}
          layout={{
            'fill-sort-key': [
              'coalesce',
              ['get', ['get', 'variant_id'], ['literal', sourcePriorities]],
              0,
            ],
          }}
          paint={{
            'fill-color': [
              'coalesce',
              ['get', ['get', 'variant_id'], ['literal', sourceColors]],
              '#777777',
            ],
            // Once ready, coverage and its spatially clipped vector fallback
            // replace these fills. Neither draws beneath the other's interiors.
            'fill-opacity': coverageReady
              ? 0
              : overlapMode === 'blending' && !hasComposition
                ? opacity
                : 1,
            'fill-layer-opacity': overlapMode === 'hatching' || hasComposition ? opacity : 1,
            'fill-opacity-transition': { duration: 0 },
            'fill-layer-opacity-transition': { duration: 0 },
          }}
        />
        <Layer
          id="inspected-language-areas"
          source={LANGUAGE_SOURCE_ID}
          source-layer={data.manifest.vectorLayer}
          type="line"
          // Selection changes rebuild this bucket; hover only changes feature paint.
          filter={filter}
          paint={{
            'line-color': '#111111',
            'line-opacity': ['case', ['boolean', ['feature-state', 'inspected'], false], 0.95, 0],
            'line-opacity-transition': { duration: 0 },
            'line-width': 2,
          }}
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

  return (
    <div className={`map-hint${visibleInPeriodCount ? ' map-hint--active' : ''}`} role="status">
      <span className="map-hint__marker" aria-hidden="true" />
      {entries.length
        ? `${visibleInPeriodCount.toLocaleString()} of ${entries.length.toLocaleString()} map entries shown`
        : 'Choose languages from the finder'}
    </div>
  )
}

export const WorldMap = () => {
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>('terrain')
  const [projectionMode, setProjectionMode] = useState<ProjectionMode>('globe')
  const [inspection, setInspection] = useState<MapInspection | null>(null)
  const areas = useAtomValue(selectedMapAreasAtom)
  const inspectionSelectionKey = useMemo(() => mapAreaSelectionKey(areas), [areas])
  const refinements = useMemo(() => mapAreaRefinements(areas), [areas])
  const inspectionRef = useRef<MapInspection | null>(null)
  const inspectionFilterRef = useRef({
    inspectionSelectionKey,
  })
  const pendingHoverEventRef = useRef<MapLayerMouseEvent | null>(null)
  const hoverQueryFrameRef = useRef<number | null>(null)
  const viewportDirtyRef = useRef(true)
  const setViewportLanguageIds = useSetAtom(viewportLanguageIdsAtom)

  const updateInspection = (nextInspection: MapInspection | null) => {
    inspectionRef.current = nextInspection
    setInspection(nextInspection)
  }

  useEffect(() => {
    const previousFilters = inspectionFilterRef.current
    if (previousFilters.inspectionSelectionKey !== inspectionSelectionKey) {
      inspectionFilterRef.current = { inspectionSelectionKey }
      cancelPendingHoverQuery()
      updateInspection(null)
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

  // Pattern zoom fades blend two stripe phases and create false category colors.
  return (
    <MapView
      initialViewState={INITIAL_VIEW}
      mapStyle={MAP_STYLE}
      projection={PROJECTIONS[projectionMode]}
      minZoom={0.5}
      maxZoom={12}
      renderWorldCopies={false}
      fadeDuration={0}
      reuseMaps
      onMouseMove={(event) => {
        if (inspectionRef.current?.pinned) return

        pendingHoverEventRef.current = event
        if (hoverQueryFrameRef.current !== null) return

        hoverQueryFrameRef.current = window.requestAnimationFrame(() => {
          hoverQueryFrameRef.current = null
          const latestEvent = pendingHoverEventRef.current
          pendingHoverEventRef.current = null
          if (!latestEvent || inspectionRef.current?.pinned) return

          const nextInspection = inspectionFromVariants(
            visibleVariantIds(latestEvent.target, latestEvent.point, refinements),
            latestEvent.lngLat.lng,
            latestEvent.lngLat.lat,
            false,
          )
          latestEvent.target.getCanvas().style.cursor = nextInspection ? 'pointer' : ''

          if (!hasSameVariants(inspectionRef.current, nextInspection)) {
            updateInspection(nextInspection)
          }
        })
      }}
      onMouseOut={(event) => {
        cancelPendingHoverQuery()
        event.target.getCanvas().style.cursor = ''
        if (!inspectionRef.current?.pinned) updateInspection(null)
      }}
      onClick={(event) => {
        cancelPendingHoverQuery()
        updateInspection(
          inspectionFromVariants(
            visibleVariantIds(event.target, event.point, refinements),
            event.lngLat.lng,
            event.lngLat.lat,
            true,
          ),
        )
      }}
      onMoveStart={() => {
        viewportDirtyRef.current = true
      }}
      onSourceData={(event) => {
        if (event.sourceId === LANGUAGE_SOURCE_ID) viewportDirtyRef.current = true
      }}
      onIdle={(event) => {
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
        <InspectionHighlight variantIds={inspection?.variantIds ?? NO_VARIANT_IDS} />
      </Suspense>
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
        {inspection && (
          <LanguageInspector inspection={inspection} onClose={() => updateInspection(null)} />
        )}
      </Suspense>
    </MapView>
  )
}
