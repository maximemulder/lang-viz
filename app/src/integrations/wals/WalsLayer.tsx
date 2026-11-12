import { useAtomValue, useSetAtom, useStore } from 'jotai'
import { useEffect, useMemo, useState } from 'react'
import { Marker, Popup, useMap } from 'react-map-gl/maplibre'
import { walsRepositoryAtom } from '../../features/wals/state.ts'
import { mapCameraIntentAtom } from '../../state/mapCameraIntent.ts'
import { startOverlayCamera } from '../map/overlayCamera.ts'
import { walsCameraBounds, walsExampleBounds } from './mapGeometry.ts'
import {
  inspectWalsObservationAtom,
  walsCameraRequestAtom,
  walsExampleGeometryAtom,
} from './state.ts'
import './walsMap.css'

export default function WalsLayer() {
  const repository = useAtomValue(walsRepositoryAtom)
  const geometry = useAtomValue(walsExampleGeometryAtom)
  const request = useAtomValue(walsCameraRequestAtom)
  const store = useStore()
  const inspect = useSetAtom(inspectWalsObservationAtom)
  const [chosenPoint, setChosenPoint] = useState<string | number | null>(null)
  const { current } = useMap()
  const map = current?.getMap()
  const bounds = useMemo(() => (geometry ? walsExampleBounds(geometry) : null), [geometry])
  useEffect(() => {
    if (!map || !request) return
    return startOverlayCamera({
      map,
      bounds: () =>
        walsCameraBounds(
          bounds,
          map.getProjection().type === 'mercator' && !map.getRenderWorldCopies(),
        ),
      isCurrent: () => store.get(walsCameraRequestAtom) === request,
      canStop: () => !store.get(mapCameraIntentAtom) || store.get(mapCameraIntentAtom) === request,
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      frames: {
        request: (callback) => window.requestAnimationFrame(callback),
        cancel: (id) => window.cancelAnimationFrame(id),
      },
    })
  }, [map, request, bounds, store])
  if (!repository || !geometry) return null
  const point = geometry.features.find((feature) => feature.id === chosenPoint)
  return (
    <>
      {geometry.features.map(({ id, geometry: { coordinates }, properties }) => {
        const [longitude, latitude] = coordinates
        if (longitude === undefined || latitude === undefined) return null
        const names = properties.sourceIds
          .map((sourceId) => `${repository.data.records[sourceId]?.name} (${sourceId})`)
          .join(', ')
        const origin = properties.role !== 'example'
        const shared = properties.sourceIds.length > 1
        const label = `${origin ? 'WALS origin' : 'WALS example'}: ${names}. ${properties.featureId}: ${repository.data.categories[properties.categoryId]?.name}. ${shared ? `Choose among ${properties.sourceIds.length} displayed observations at this location.` : 'Inspect recorded observation.'}`
        return (
          <Marker
            key={id}
            longitude={longitude}
            latitude={latitude}
            anchor="center"
            style={{ zIndex: 2 }}
          >
            <button
              type="button"
              className={`wals-map-marker${origin ? ' is-origin' : ''}`}
              data-wals-sources={properties.sourceIds.join(' ')}
              data-wals-feature={properties.featureId}
              aria-label={label}
              title={label}
              onMouseMove={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                if (shared) setChosenPoint(id ?? null)
                else {
                  const sourceId = properties.sourceIds[0]
                  if (sourceId) inspect({ sourceId, featureId: properties.featureId })
                }
              }}
            >
              <span className="wals-map-symbol" aria-hidden="true" />
              {shared && properties.sourceIds.length}
            </button>
          </Marker>
        )
      })}
      {point &&
        point.geometry.coordinates[0] !== undefined &&
        point.geometry.coordinates[1] !== undefined && (
          <Popup
            longitude={point.geometry.coordinates[0]}
            latitude={point.geometry.coordinates[1]}
            closeOnClick={false}
            onClose={() => setChosenPoint(null)}
            className="wals-map-popup"
          >
            <fieldset
              onKeyDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              aria-label="Choose a WALS observation at this location"
            >
              <p>{point.properties.sourceIds.length} displayed observations at this location:</p>
              {point.properties.sourceIds.map((sourceId) => (
                <button
                  type="button"
                  key={sourceId}
                  onClick={() => {
                    inspect({ sourceId, featureId: point.properties.featureId })
                    setChosenPoint(null)
                  }}
                >
                  Inspect {repository.data.records[sourceId]?.name} ({sourceId})
                </button>
              ))}
            </fieldset>
          </Popup>
        )}
    </>
  )
}
