import { classifyRings, VectorTile } from '@mapbox/vector-tile'
import { type Feature, fromVectorTileJs, GeoJSONWrapper } from '@maplibre/vt-pbf'
import { PbfReader } from 'pbf'
import type { MultiPolygon } from './geometry.ts'
import { coverageRectangles } from './tiles.ts'
import type { TileCoordinate } from './types.ts'

let clipper:
  | Promise<Awaited<ReturnType<typeof import('./geos.ts').createFallbackClipper>>>
  | undefined

export interface FallbackClipMetrics {
  features: number
  clippedFeatures: number
  untouchedFeatures: number
  coveredFeatures: number
  decodeMs: number
  initializeMs: number
  overlayMs: number
  encodeMs: number
}

/** Preserve the source tile outside the displayed coverage, including its properties. */
export const clipFallbackTile = async (
  data: Uint8Array,
  tile: TileCoordinate,
  coverage: readonly TileCoordinate[],
  metrics?: FallbackClipMetrics,
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
  let started = performance.now()
  const source = new VectorTile(new PbfReader(data))
  if (metrics) metrics.decodeMs += performance.now() - started
  const layers: Record<string, GeoJSONWrapper> = {}
  for (const [name, layer] of Object.entries(source.layers)) {
    started = performance.now()
    const masks = coverageRectangles(tile, coverage, layer.extent)
    const features = Array.from({ length: layer.length }, (_, i) => layer.feature(i)).filter(
      (feature) => feature.type === 3,
    )
    const geometries = new Map<number, [number, number][][]>()
    const candidates: { index: number; geometry: MultiPolygon }[] = []
    for (const [index, feature] of features.entries()) {
      if (metrics) metrics.features++
      const [left, top, right, bottom] = feature.bbox() as [number, number, number, number]
      if (masks.some(([l, t, r, b]) => left >= l && top >= t && right <= r && bottom <= b)) {
        if (metrics) metrics.coveredFeatures++
        continue
      }
      const rings = feature.loadGeometry()
      if (
        left >= 0 &&
        top >= 0 &&
        right <= layer.extent &&
        bottom <= layer.extent &&
        masks.every(([l, t, r, b]) => right <= l || bottom <= t || left >= r || top >= b)
      ) {
        // Preserve original integer MVT rings, holes, and winding. Geometry in
        // the source tile buffer must still go through the clipping path.
        geometries.set(
          index,
          rings.map((ring) => ring.map(({ x, y }) => [x, y])),
        )
        if (metrics) metrics.untouchedFeatures++
      } else {
        candidates.push({
          index,
          geometry: classifyRings(rings).map((polygon) =>
            polygon.map((ring) => ring.map(({ x, y }) => [x, y])),
          ),
        })
        if (metrics) metrics.clippedFeatures++
      }
    }
    if (metrics) metrics.decodeMs += performance.now() - started
    if (candidates.length) {
      started = performance.now()
      clipper ??= import('./geos.ts').then(({ createFallbackClipper }) => createFallbackClipper())
      const clip = await clipper
      if (metrics) metrics.initializeMs += performance.now() - started
      started = performance.now()
      const clipped = clip(
        candidates.map(({ geometry }) => geometry),
        layer.extent,
        masks,
      )
      if (metrics) metrics.overlayMs += performance.now() - started
      for (const [i, polygons] of clipped.entries()) {
        const candidate = candidates[i]
        if (!candidate || !polygons.length) continue
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
        geometries.set(candidate.index, geometry)
      }
    }
    started = performance.now()
    const output: Feature[] = []
    // Iterate source order: fallback overlaps use the same source-order colors.
    for (const [i, feature] of features.entries()) {
      const geometry = geometries.get(i)
      if (!geometry?.length) continue
      output.push({
        type: 3,
        geometry,
        tags: feature.properties,
        ...(feature.id === undefined ? {} : { id: feature.id }),
      })
    }
    layers[name] = new GeoJSONWrapper(output, { extent: layer.extent, version: 2 })
    layers[name].name = name
    if (metrics) metrics.encodeMs += performance.now() - started
  }
  started = performance.now()
  const result = fromVectorTileJs({ layers })
  if (metrics) metrics.encodeMs += performance.now() - started
  return result
}
