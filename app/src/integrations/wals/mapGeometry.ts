import type { FeatureCollection, Point } from 'geojson'
import { combinedBounds, type GeographicBounds } from '../../domain/languageFocus.ts'

/** Point bounds use the shared shortest longitude arc, with no atlas geometry request. */
export const walsExampleBounds = (geometry: FeatureCollection<Point>) =>
  combinedBounds(
    geometry.features.flatMap(({ geometry: { coordinates } }) => {
      const [longitude, latitude] = coordinates
      return longitude !== undefined && latitude !== undefined
        ? [[longitude, latitude, longitude, latitude] as const]
        : []
    }),
  )

/** A single Mercator world cannot display an unwrapped arc across its fixed edges. */
export const walsCameraBounds = (
  bounds: GeographicBounds | null,
  singleWorldMercator: boolean,
): GeographicBounds | null =>
  bounds && singleWorldMercator && bounds[2] > 180 ? [-180, bounds[1], 180, bounds[3]] : bounds
