import { useAtomValue, useSetAtom } from 'jotai'
import type { FilterSpecification, MapGeoJSONFeature, MapLayerMouseEvent } from 'maplibre-gl'
import { addProtocol, setWorkerUrl } from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { Protocol } from 'pmtiles'
import { memo, Suspense, useEffect, useRef, useState } from 'react'
import MapView, { Layer, NavigationControl, ScaleControl, Source } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import { languageArchiveUrl } from '../../data/atlasRepository'
import { geographyVariantsForLanguage } from '../../domain/geography'
import { temporalView } from '../../domain/temporal'
import {
  atlasDataAtom,
  geographyDatasetFilterAtom,
  geometryOverridesAtom,
  languageOpacityAtom,
  overlapModeAtom,
  temporalViewAtom,
  viewportLanguageIdsAtom,
  visibleLanguageIdsAtom,
} from '../../state/atlasState'
import { GEOGRAPHIC_BASEMAP } from './geographicBasemap'
import { LanguageInspector, type MapInspection } from './LanguageInspector'
import { MapSettings, type ProjectionMode } from './MapSettings'
import { diagnosticsEnabled } from './overlap/diagnostics'
import { OverlapHatching } from './overlap/OverlapHatching'

setWorkerUrl(maplibreWorkerUrl)
const pmtilesProtocol = new Protocol()
addProtocol('pmtiles', pmtilesProtocol.tile)

const MAP_STYLE =
  diagnosticsEnabled && new URLSearchParams(location.search).get('overlap-basemap') === 'off'
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
const HOVER_QUERY_INTERVAL_MS = 40
const NO_VARIANT_IDS: readonly string[] = []

const inspectionFromFeatures = (
  features: readonly MapGeoJSONFeature[],
  longitude: number,
  latitude: number,
  pinned: boolean,
): MapInspection | null => {
  const variantIds = [
    ...new Set(
      features.flatMap((feature) => {
        const variantId = feature.properties.variant_id
        return typeof variantId === 'string' ? [variantId] : []
      }),
    ),
  ].sort()

  return variantIds.length > 0 ? { longitude, latitude, variantIds, pinned } : null
}

const hasSameVariants = (left: MapInspection | null, right: MapInspection | null) => {
  if (left === right) return true
  if (!left || !right || left.variantIds.length !== right.variantIds.length) return false
  return left.variantIds.every((variantId, index) => variantId === right.variantIds[index])
}

interface LanguageLayersProps {
  readonly inspectedVariantIds: readonly string[]
}

const LanguageLayers = memo(({ inspectedVariantIds }: LanguageLayersProps) => {
  const data = useAtomValue(atlasDataAtom)
  const visibleLanguageIds = useAtomValue(visibleLanguageIdsAtom)
  const overrides = useAtomValue(geometryOverridesAtom)
  const temporalSelection = useAtomValue(temporalViewAtom)
  const datasetSelection = useAtomValue(geographyDatasetFilterAtom)
  const overlapMode = useAtomValue(overlapModeAtom)
  const opacity = useAtomValue(languageOpacityAtom)
  const [coverageKey, setCoverageKey] = useState<string | null>(null)
  const activeVariants = visibleLanguageIds.flatMap((languageId) => {
    const language = data.languageById.get(languageId)
    if (!language || language.geometryVariantIds.length === 0) return []
    const variants = geographyVariantsForLanguage(
      data,
      language,
      temporalSelection,
      datasetSelection,
    )
    const override = overrides[languageId]
    const variant = variants.find(({ id }) => id === override) ?? variants[0]
    return variant ? [variant] : []
  })
  const variantIds = activeVariants.map(({ id }) => id)
  const selectionKey = JSON.stringify([...variantIds].sort())
  const coverageReady = overlapMode === 'hatching' && coverageKey === selectionKey
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

  return (
    <>
      <Source
        id={LANGUAGE_SOURCE_ID}
        type="vector"
        url={languageArchiveUrl()}
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
          paint={{
            'fill-color': ['get', 'color'],
            // Once ready, coverage and its spatially clipped vector fallback
            // replace these fills. Neither draws beneath the other's interiors.
            'fill-opacity': overlapMode === 'blending' ? opacity : coverageReady ? 0 : 1,
            'fill-layer-opacity': overlapMode === 'hatching' ? opacity : 1,
            'fill-opacity-transition': { duration: 0 },
            'fill-layer-opacity-transition': { duration: 0 },
          }}
        />
        <Layer
          id="inspected-language-areas"
          source={LANGUAGE_SOURCE_ID}
          source-layer={data.manifest.vectorLayer}
          type="line"
          filter={['in', ['get', 'variant_id'], ['literal', inspectedVariantIds]]}
          paint={{
            'line-color': '#fffdf7',
            'line-opacity': 0.95,
            'line-width': 3,
          }}
        />
      </Source>
      <OverlapHatching
        variants={activeVariants}
        selectionKey={selectionKey}
        coverageReady={coverageReady}
        onCoverageReady={setCoverageKey}
      />
    </>
  )
})

const MapHint = () => {
  const data = useAtomValue(atlasDataAtom)
  const visibleLanguageIds = useAtomValue(visibleLanguageIdsAtom)
  const temporalSelection = useAtomValue(temporalViewAtom)
  const datasetSelection = useAtomValue(geographyDatasetFilterAtom)
  const visibleInPeriodCount = visibleLanguageIds.filter((languageId) => {
    const language = data.languageById.get(languageId)
    return (
      language &&
      geographyVariantsForLanguage(data, language, temporalSelection, datasetSelection).length > 0
    )
  }).length

  return (
    <div className={`map-hint${visibleInPeriodCount ? ' map-hint--active' : ''}`} role="status">
      <span className="map-hint__marker" aria-hidden="true" />
      {visibleLanguageIds.length
        ? `${visibleInPeriodCount.toLocaleString()} of ${visibleLanguageIds.length.toLocaleString()} shown · ${temporalView(temporalSelection).shortLabel}`
        : 'Choose languages from the finder'}
    </div>
  )
}

export const WorldMap = () => {
  const [projectionMode, setProjectionMode] = useState<ProjectionMode>('globe')
  const [inspection, setInspection] = useState<MapInspection | null>(null)
  const temporalSelection = useAtomValue(temporalViewAtom)
  const datasetSelection = useAtomValue(geographyDatasetFilterAtom)
  const inspectionRef = useRef<MapInspection | null>(null)
  const inspectionFilterRef = useRef({ datasetSelection, temporalSelection })
  const pendingHoverEventRef = useRef<MapLayerMouseEvent | null>(null)
  const hoverQueryTimerRef = useRef<number | null>(null)
  const setViewportLanguageIds = useSetAtom(viewportLanguageIdsAtom)

  const updateInspection = (nextInspection: MapInspection | null) => {
    inspectionRef.current = nextInspection
    setInspection(nextInspection)
  }

  useEffect(() => {
    const previousFilters = inspectionFilterRef.current
    if (
      previousFilters.datasetSelection !== datasetSelection ||
      previousFilters.temporalSelection !== temporalSelection
    ) {
      inspectionFilterRef.current = { datasetSelection, temporalSelection }
      updateInspection(null)
    }
  })

  const cancelPendingHoverQuery = () => {
    pendingHoverEventRef.current = null
    if (hoverQueryTimerRef.current !== null) {
      window.clearTimeout(hoverQueryTimerRef.current)
      hoverQueryTimerRef.current = null
    }
  }

  useEffect(
    () => () => {
      pendingHoverEventRef.current = null
      if (hoverQueryTimerRef.current !== null) {
        window.clearTimeout(hoverQueryTimerRef.current)
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
        if (hoverQueryTimerRef.current !== null) return

        hoverQueryTimerRef.current = window.setTimeout(() => {
          hoverQueryTimerRef.current = null
          const latestEvent = pendingHoverEventRef.current
          pendingHoverEventRef.current = null
          if (!latestEvent || inspectionRef.current?.pinned) return

          const features = latestEvent.target.getLayer(SELECTED_LANGUAGE_LAYER_ID)
            ? latestEvent.target.queryRenderedFeatures(latestEvent.point, {
                layers: [SELECTED_LANGUAGE_LAYER_ID],
              })
            : []
          const nextInspection = inspectionFromFeatures(
            features,
            latestEvent.lngLat.lng,
            latestEvent.lngLat.lat,
            false,
          )
          latestEvent.target.getCanvas().style.cursor = nextInspection ? 'pointer' : ''

          if (nextInspection || !hasSameVariants(inspectionRef.current, nextInspection)) {
            updateInspection(nextInspection)
          }
        }, HOVER_QUERY_INTERVAL_MS)
      }}
      onMouseLeave={(event) => {
        cancelPendingHoverQuery()
        event.target.getCanvas().style.cursor = ''
        if (!inspectionRef.current?.pinned) updateInspection(null)
      }}
      onClick={(event) => {
        cancelPendingHoverQuery()
        const features = event.target.getLayer(SELECTED_LANGUAGE_LAYER_ID)
          ? event.target.queryRenderedFeatures(event.point, {
              layers: [SELECTED_LANGUAGE_LAYER_ID],
            })
          : []
        updateInspection(inspectionFromFeatures(features, event.lngLat.lng, event.lngLat.lat, true))
      }}
      onIdle={(event) => {
        if (!event.target.getLayer(LANGUAGE_HIT_LAYER_ID)) return
        const languageIds = event.target
          .queryRenderedFeatures({ layers: [LANGUAGE_HIT_LAYER_ID] })
          .flatMap((feature) => {
            const languageId = feature.properties.language_id
            return typeof languageId === 'string' ? [languageId] : []
          })
        setViewportLanguageIds([...new Set(languageIds)])
      }}
    >
      <Suspense fallback={null}>
        <LanguageLayers
          inspectedVariantIds={inspection?.pinned ? inspection.variantIds : NO_VARIANT_IDS}
        />
      </Suspense>
      <NavigationControl position="top-right" showCompass={false} />
      <ScaleControl position="bottom-right" unit="metric" />

      <MapSettings projectionMode={projectionMode} onProjectionChange={setProjectionMode} />

      <Suspense fallback={null}>
        <MapHint />
        {inspection && (
          <LanguageInspector inspection={inspection} onClose={() => updateInspection(null)} />
        )}
      </Suspense>
    </MapView>
  )
}
