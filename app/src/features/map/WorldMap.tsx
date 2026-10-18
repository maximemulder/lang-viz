import { useAtomValue, useSetAtom } from 'jotai'
import type { FilterSpecification } from 'maplibre-gl'
import { addProtocol, setWorkerUrl } from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { Protocol } from 'pmtiles'
import { Suspense, useState } from 'react'
import MapView, { Layer, NavigationControl, ScaleControl, Source } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import { languageArchiveUrl } from '../../data/atlasRepository'
import { temporalVariantsForLanguage, temporalView } from '../../domain/temporal'
import {
  atlasDataAtom,
  geometryOverridesAtom,
  temporalViewAtom,
  viewportLanguageIdsAtom,
  visibleLanguageIdsAtom,
} from '../../state/atlasState'
import { GEOGRAPHIC_BASEMAP } from './geographicBasemap'

setWorkerUrl(maplibreWorkerUrl)
const pmtilesProtocol = new Protocol()
addProtocol('pmtiles', pmtilesProtocol.tile)

const INITIAL_VIEW = {
  longitude: 12,
  latitude: 18,
  zoom: 1.35,
} as const

const PROJECTIONS = {
  globe: { type: 'vertical-perspective' },
  mercator: { type: 'mercator' },
} as const

type ProjectionMode = keyof typeof PROJECTIONS

const LANGUAGE_SOURCE_ID = 'language-areas'
const LANGUAGE_HIT_LAYER_ID = 'language-area-hit-targets'

const LanguageLayers = () => {
  const data = useAtomValue(atlasDataAtom)
  const visibleLanguageIds = useAtomValue(visibleLanguageIdsAtom)
  const overrides = useAtomValue(geometryOverridesAtom)
  const temporalSelection = useAtomValue(temporalViewAtom)
  const variantIds = visibleLanguageIds.flatMap((languageId) => {
    const language = data.languageById.get(languageId)
    if (!language || language.geometryVariantIds.length === 0) return []
    const variants = temporalVariantsForLanguage(data, language, temporalSelection)
    const override = overrides[languageId]
    const variant = variants.find(({ id }) => id === override) ?? variants[0]
    return variant ? [variant.id] : []
  })
  const filter: FilterSpecification = ['in', ['get', 'variant_id'], ['literal', variantIds]]
  const temporalFilter: FilterSpecification =
    temporalSelection === 'all'
      ? ['has', 'variant_id']
      : ['==', ['get', 'temporal_view'], temporalSelection]

  return (
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
        filter={temporalFilter}
        paint={{ 'fill-color': '#000000', 'fill-opacity': 0 }}
      />
      <Layer
        id="selected-language-areas"
        source={LANGUAGE_SOURCE_ID}
        source-layer={data.manifest.vectorLayer}
        type="fill"
        filter={filter}
        paint={{
          'fill-color': ['get', 'color'],
          'fill-opacity': 0.58,
          'fill-outline-color': '#fff8e8',
        }}
      />
    </Source>
  )
}

const MapHint = () => {
  const data = useAtomValue(atlasDataAtom)
  const visibleLanguageIds = useAtomValue(visibleLanguageIdsAtom)
  const temporalSelection = useAtomValue(temporalViewAtom)
  const visibleInPeriodCount = visibleLanguageIds.filter((languageId) => {
    const language = data.languageById.get(languageId)
    return language && temporalVariantsForLanguage(data, language, temporalSelection).length > 0
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
  const setViewportLanguageIds = useSetAtom(viewportLanguageIdsAtom)

  return (
    <MapView
      initialViewState={INITIAL_VIEW}
      mapStyle={GEOGRAPHIC_BASEMAP}
      projection={PROJECTIONS[projectionMode]}
      minZoom={0.5}
      maxZoom={12}
      renderWorldCopies={false}
      reuseMaps
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
        <LanguageLayers />
      </Suspense>
      <NavigationControl position="top-right" showCompass={false} />
      <ScaleControl position="bottom-right" unit="metric" />

      <label className="map-projection-control">
        <span>Projection</span>
        <select
          value={projectionMode}
          onChange={(event) => {
            const nextProjection = event.currentTarget.value

            if (nextProjection === 'globe' || nextProjection === 'mercator') {
              setProjectionMode(nextProjection)
            }
          }}
        >
          <option value="globe">Globe</option>
          <option value="mercator">Mercator</option>
        </select>
      </label>

      <Suspense fallback={null}>
        <MapHint />
      </Suspense>
    </MapView>
  )
}
