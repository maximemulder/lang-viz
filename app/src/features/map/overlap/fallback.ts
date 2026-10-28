import { classifyRings, VectorTile } from '@mapbox/vector-tile'
import { type Feature, fromVectorTileJs, GeoJSONWrapper } from '@maplibre/vt-pbf'
import { PbfReader } from 'pbf'
import type { MultiPolygon } from './geometry.ts'
import { coverageRectangles } from './tiles.ts'
import type { TileCoordinate } from './types.ts'

let clipper:
  | Promise<Awaited<ReturnType<typeof import('./geos.ts').createFallbackClipper>>>
  | undefined

/** Preserve the source tile outside the displayed coverage, including its properties. */
export const clipFallbackTile = async (
  data: Uint8Array,
  tile: TileCoordinate,
  coverage: readonly TileCoordinate[],
): Promise<Uint8Array> => {
  if (!data.length) return data
  const rectangles = coverageRectangles(tile, coverage, 1)
  if (!rectangles.length) return data
  if (
    rectangles.some(
      ([left, top, right, bottom]) => left === 0 && top === 0 && right === 1 && bottom === 1,
    )
  ) {
    return new Uint8Array()
  }
  clipper ??= import('./geos.ts').then(({ createFallbackClipper }) => createFallbackClipper())
  const clip = await clipper
  const source = new VectorTile(new PbfReader(data))
  const layers: Record<string, GeoJSONWrapper> = {}
  for (const [name, layer] of Object.entries(source.layers)) {
    const features = Array.from({ length: layer.length }, (_, i) => layer.feature(i)).filter(
      (feature) => feature.type === 3,
    )
    const inputs: MultiPolygon[] = features.map((feature) =>
      classifyRings(feature.loadGeometry()).map((polygon) =>
        polygon.map((ring) => ring.map(({ x, y }) => [x, y])),
      ),
    )
    const clipped = clip(inputs, layer.extent, coverageRectangles(tile, coverage, layer.extent))
    const output: Feature[] = []
    for (const [i, polygons] of clipped.entries()) {
      const feature = features[i]
      if (!feature || !polygons.length) continue
      // MVT requires clockwise exterior rings in its downward-growing Y axis.
      const geometry = polygons.flatMap((polygon) =>
        polygon.map((ring, index) => {
          let area = 0
          for (let j = 1; j < ring.length; j++) {
            const a = ring[j - 1]
            const b = ring[j]
            if (a && b) area += a[0] * b[1] - b[0] * a[1]
          }
          return (area > 0 === (index === 0) ? ring : [...ring].reverse()).map(
            ([x, y]): [number, number] => [Math.round(x), Math.round(y)],
          )
        }),
      )
      output.push({
        type: 3,
        geometry,
        tags: feature.properties,
        ...(feature.id === undefined ? {} : { id: feature.id }),
      })
    }
    layers[name] = new GeoJSONWrapper(output, { extent: layer.extent, version: 2 })
    layers[name].name = name
  }
  return fromVectorTileJs({ layers })
}
