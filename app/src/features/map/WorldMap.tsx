import { setWorkerUrl } from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { useState } from 'react'
import MapView, { NavigationControl, ScaleControl } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import { GEOGRAPHIC_BASEMAP } from './geographicBasemap'

setWorkerUrl(maplibreWorkerUrl)

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

export const WorldMap = () => {
  const [projectionMode, setProjectionMode] = useState<ProjectionMode>('globe')

  return (
    <MapView
      initialViewState={INITIAL_VIEW}
      mapStyle={GEOGRAPHIC_BASEMAP}
      projection={PROJECTIONS[projectionMode]}
      minZoom={0.5}
      maxZoom={12}
      renderWorldCopies={false}
      reuseMaps
    >
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

      <div className="map-hint" role="status">
        <span className="map-hint__marker" aria-hidden="true" />
        Language layers will appear here
      </div>
    </MapView>
  )
}
