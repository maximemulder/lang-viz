import { setWorkerUrl } from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import MapView, { NavigationControl, ScaleControl } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'

setWorkerUrl(maplibreWorkerUrl)

const BASEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron'

const INITIAL_VIEW = {
  longitude: 12,
  latitude: 18,
  zoom: 1.35,
} as const

export const WorldMap = () => (
  <MapView
    initialViewState={INITIAL_VIEW}
    mapStyle={BASEMAP_STYLE_URL}
    minZoom={0.5}
    maxZoom={12}
    reuseMaps
  >
    <NavigationControl position="top-right" showCompass={false} />
    <ScaleControl position="bottom-right" unit="metric" />

    <div className="map-hint" role="status">
      <span className="map-hint__marker" aria-hidden="true" />
      Language layers will appear here
    </div>
  </MapView>
)
