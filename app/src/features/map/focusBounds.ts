import type { Map as MapLibreMap } from 'maplibre-gl'
import type { GeographicBounds } from '../../domain/languageFocus.ts'

/** Fit an explicit focus extent in the current viewport and projection. */
export function focusBounds(map: MapLibreMap, bounds: GeographicBounds, extraZoomOut = 1): boolean {
  map.resize()
  // A single Mercator world cannot show both parts of an unwrapped dateline interval.
  const crossesDateline =
    bounds[2] > 180 && map.getProjection().type === 'mercator' && !map.getRenderWorldCopies()
  const areaBounds: [[number, number], [number, number]] = [
    [crossesDateline ? -180 : bounds[0], bounds[1]],
    [crossesDateline ? 180 : bounds[2], bounds[3]],
  ]
  const canvas = map.getCanvas()
  const padding = Math.min(48, canvas.clientWidth / 8, canvas.clientHeight / 8)
  const camera = map.cameraForBounds(areaBounds, { padding })
  if (camera?.zoom === undefined) return false
  map.fitBounds(areaBounds, {
    padding,
    maxZoom: Math.max(map.getMinZoom(), Math.min(6, camera.zoom - extraZoomOut)),
    duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 450,
  })
  return true
}
