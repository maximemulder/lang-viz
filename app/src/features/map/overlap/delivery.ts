import { VectorTile } from '@mapbox/vector-tile'
import { type Feature, fromVectorTileJs, GeoJSONWrapper } from '@maplibre/vt-pbf'
import { PbfReader } from 'pbf'
import type { CoverageTile } from './compute.ts'
import type { OverlapProperties, TileCoordinate } from './types.ts'

export const COVERAGE_LAYER = 'overlap_coverage'
const EXTENT = 8192

export interface DeliveryTile {
  readonly tile: TileCoordinate
  readonly data: Uint8Array
  readonly patterns: readonly OverlapProperties[]
  readonly features: number
  readonly vertices: number
}

export const tileKey = ({ z, x, y }: TileCoordinate) => `${z}/${x}/${y}`

export const isTileDescendant = (source: TileCoordinate, target: TileCoordinate) => {
  const scale = 2 ** (source.z - target.z)
  return (
    scale > 1 &&
    Math.floor(source.x / scale) === target.x &&
    Math.floor(source.y / scale) === target.y
  )
}

const encode = (features: Feature[]) => {
  if (!features.length) return new Uint8Array()
  const layer = new GeoJSONWrapper(features, { extent: EXTENT, version: 2 })
  layer.name = COVERAGE_LAYER
  return fromVectorTileJs({ layers: { [COVERAGE_LAYER]: layer } })
}

/** MVT winding is clockwise for shells in downward-growing tile Y coordinates. */
export const encodeCoverageTile = (result: CoverageTile): DeliveryTile => ({
  tile: result.tile,
  patterns: result.features.map(({ properties }) => properties),
  features: result.features.length,
  vertices: result.vertices,
  data: encode(
    result.features.map((feature) => ({
      type: 3,
      tags: { pattern: feature.properties.pattern },
      geometry: feature.geometry.coordinates.flatMap((polygon) =>
        polygon.map((ring, index) => {
          let area = 0
          for (let i = 1; i < ring.length; i++) {
            const a = ring[i - 1]
            const b = ring[i]
            if (a && b) area += a[0] * b[1] - b[0] * a[1]
          }
          return (area > 0 === (index === 0) ? ring : [...ring].reverse()).map(
            (point): [number, number] => [
              Math.round((point[0] * EXTENT) / result.extent),
              Math.round((point[1] * EXTENT) / result.extent),
            ],
          )
        }),
      ),
    })),
  ),
})

/** Serve native tiles directly; combine descendants only during zoom-out retention.
 * The vector source maxzoom is the computation zoom, so children are overzoomed
 * by MapLibre and never need a second clipping/overlay pass here.
 */
export const deliveryTile = (
  tiles: ReadonlyMap<string, DeliveryTile>,
  target: TileCoordinate,
): Uint8Array => {
  const native = tiles.get(tileKey(target))
  if (native) return native.data
  const features: Feature[] = []
  for (const result of tiles.values()) {
    const scale = 2 ** (result.tile.z - target.z)
    if (
      scale <= 1 ||
      Math.floor(result.tile.x / scale) !== target.x ||
      Math.floor(result.tile.y / scale) !== target.y ||
      !result.data.length
    )
      continue
    const layer = new VectorTile(new PbfReader(result.data)).layers[COVERAGE_LAYER]
    if (!layer) continue
    const offsetX = result.tile.x / scale - target.x
    const offsetY = result.tile.y / scale - target.y
    for (let i = 0; i < layer.length; i++) {
      const feature = layer.feature(i)
      features.push({
        type: 3,
        tags: feature.properties,
        geometry: feature
          .loadGeometry()
          .map((ring) =>
            ring.map(({ x, y }): [number, number] => [
              Math.round(offsetX * EXTENT + x / scale),
              Math.round(offsetY * EXTENT + y / scale),
            ]),
          ),
      })
    }
  }
  return encode(features)
}
