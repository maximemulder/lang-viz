import type { FeatureCollection, Geometry, Polygon } from 'geojson'
import initGeos from 'geos-wasm'

let runtime: ReturnType<typeof initGeos> | undefined
/** Exact display mask from the supplied administrative rings, including islands,
 * enclaves and dateline cuts. No language boundary is edited or reconstructed.
 */
export async function countryOutsideMask(
  geometries: readonly Geometry[],
): Promise<FeatureCollection<Polygon>> {
  runtime ??= initGeos()
  const geos = await runtime
  const owned: number[] = []
  const reader = geos.GEOSGeoJSONReader_create()
  const writer = geos.GEOSGeoJSONWriter_create()
  const own = (pointer: number) => {
    if (!pointer) throw new Error('The selected country boundary could not be masked.')
    owned.push(pointer)
    return pointer
  }
  const read = (geometry: Geometry) => {
    const bytes = new TextEncoder().encode(JSON.stringify(geometry))
    const buffer = geos.Module._malloc(bytes.length + 1)
    try {
      geos.Module.HEAPU8.set(bytes, buffer)
      geos.Module.HEAPU8[buffer + bytes.length] = 0
      return own(geos.GEOSGeoJSONReader_readGeometry(reader, buffer))
    } finally {
      geos.Module._free(buffer)
    }
  }
  try {
    if (!geometries.length) throw new Error('No country boundary is available.')
    const collection = read({ type: 'GeometryCollection', geometries: [...geometries] })
    const valid = own(geos.GEOSMakeValid(collection))
    const country = own(geos.GEOSUnaryUnion(valid))
    const features: FeatureCollection<Polygon>['features'] = []
    // Narrow longitude strips avoid the renderer interpreting a 360-degree
    // exterior ring as a dateline seam or the short way around the globe.
    for (const west of [-180, -90, 0, 90]) {
      const east = west + 90
      const world = read({
        type: 'Polygon',
        coordinates: [
          [
            [west, -85.051129],
            [east, -85.051129],
            [east, 85.051129],
            [west, 85.051129],
            [west, -85.051129],
          ],
        ],
      })
      const difference = own(geos.GEOSDifference(world, country))
      const output = geos.GEOSGeoJSONWriter_writeGeometry(writer, difference, -1)
      if (!output) throw new Error('Could not prepare the country view.')
      try {
        const geometry: Geometry = JSON.parse(geos.Module.UTF8ToString(output))
        const polygons =
          geometry.type === 'Polygon'
            ? [geometry.coordinates]
            : geometry.type === 'MultiPolygon'
              ? geometry.coordinates
              : []
        for (const coordinates of polygons)
          features.push({
            type: 'Feature',
            properties: {},
            geometry: { type: 'Polygon', coordinates },
          })
      } finally {
        geos.GEOSFree(output)
      }
    }
    return { type: 'FeatureCollection', features }
  } finally {
    for (const geometry of owned.reverse()) geos.GEOSGeom_destroy(geometry)
    geos.GEOSGeoJSONReader_destroy(reader)
    geos.GEOSGeoJSONWriter_destroy(writer)
  }
}
