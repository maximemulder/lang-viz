import { classifyRings, VectorTile } from '@mapbox/vector-tile'
import { type Feature, fromVectorTileJs, GeoJSONWrapper } from '@maplibre/vt-pbf'
import { PbfReader } from 'pbf'
import { FALLBACK_BOUNDARY_LAYER, geometryBoundaries } from '../geometryBoundaries.ts'
import { ByteCache } from '../overlap/byteCache.ts'
import { clipFallbackTile } from '../overlap/fallback.ts'
import type { FallbackMetrics } from '../overlap/fallbackCache.ts'
import type { MultiPolygon } from '../overlap/geometry.ts'
import { lazyResource } from '../overlap/lazyResource.ts'
import { bufferTileEdges } from '../overlap/tileBuffer.ts'
import { quantizeTilePolygon } from '../overlap/tileGeometry.ts'
import type { OverlapSelection, TileCoordinate } from '../overlap/types.ts'
import type { GeometryTileStore } from './tileStore.ts'

export interface FallbackGeometry {
  readonly tiles: readonly TileCoordinate[]
  readonly selection: OverlapSelection
  readonly sourceLayer: string
}
const loadUnion = lazyResource(async () =>
  (await import('../overlap/geos.ts')).createFootprintUnion(),
)
const caches = new WeakMap<GeometryTileStore, ByteCache>()
type Point = [number, number]

/** Clip a boundary segment without inventing a border along the clipping box. */
const clipLine = (a: Point, b: Point, extent: number): Point[] => {
  let lo = 0,
    hi = 1
  const dx = b[0] - a[0],
    dy = b[1] - a[1]
  for (const [p, q] of [
    [-dx, a[0]],
    [dx, extent - a[0]],
    [-dy, a[1]],
    [dy, extent - a[1]],
  ]) {
    if (p === undefined || q === undefined) continue
    if (!p) {
      if (q < 0) return []
      continue
    }
    if (p < 0) lo = Math.max(lo, q / p)
    else hi = Math.min(hi, q / p)
    if (lo >= hi) return []
  }
  return [
    [a[0] + lo * dx, a[1] + lo * dy],
    [a[0] + hi * dx, a[1] + hi * dy],
  ]
}

const sourceBoundaries = async (
  bytes: Uint8Array,
  config: FallbackGeometry,
  signal: AbortSignal,
) => {
  const layer = bytes.length
    ? new VectorTile(new PbfReader(bytes)).layers[config.sourceLayer]
    : undefined
  if (!layer) return { extent: 8192, features: [] as Feature[], source: new Uint8Array() }
  const selected = new Set(config.selection.variantIds)
  const sourceFeatures: Feature[] = []
  const groups = new Map<string, { geometry: MultiPolygon; sources: Set<string> }>()
  for (let i = 0; i < layer.length; i++) {
    const feature = layer.feature(i),
      id = feature.properties.variant_id
    if (feature.type !== 3 || typeof id !== 'string' || !selected.has(id)) continue
    const geometry = classifyRings(feature.loadGeometry()).map((p) =>
      p.map((r) => r.map(({ x, y }): Point => [x, y])),
    )
    sourceFeatures.push({
      type: 3,
      tags: feature.properties,
      geometry: geometry.flat(),
      ...(feature.id === undefined ? {} : { id: feature.id }),
    })
    for (const owner of config.selection.variantGroups?.[id] ?? [id]) {
      let group = groups.get(owner)
      if (!group) {
        group = { geometry: [], sources: new Set() }
        groups.set(owner, group)
      }
      group.geometry.push(...geometry)
      group.sources.add(id)
    }
  }
  const faces: Feature[] = []
  const subtractions = new Map<string, MultiPolygon>()
  for (const [other, child] of groups)
    for (const id of config.selection.refinements?.[other] ?? []) {
      if (!groups.has(id)) continue
      const previous = subtractions.get(id)
      if (previous) previous.push(...child.geometry)
      else subtractions.set(id, [...child.geometry])
    }
  for (const [id, group] of groups) {
    signal.throwIfAborted()
    const subtract = subtractions.get(id) ?? []
    const union = group.sources.size > 1 || subtract.length ? await loadUnion() : undefined
    signal.throwIfAborted()
    const geometry = union ? union(group.geometry, subtract) : group.geometry
    faces.push({
      type: 3,
      tags: { variantId: id },
      geometry: geometry.flatMap((p) => quantizeTilePolygon(p, (p) => p)),
    })
  }
  const features = geometryBoundaries(faces, layer.extent).map((feature) => ({
    ...feature,
    geometry: (feature.geometry as Point[][]).flatMap((line) =>
      line.slice(1).flatMap((point, index) => {
        const start = line[index]
        const clipped = start ? clipLine(start, point, layer.extent) : []
        return clipped.length ? [clipped] : []
      }),
    ),
  }))
  const source = new GeoJSONWrapper(sourceFeatures, { extent: layer.extent, version: 2 })
  source.name = config.sourceLayer
  return {
    extent: layer.extent,
    features,
    source: fromVectorTileJs({ layers: { [config.sourceLayer]: source } }),
  }
}

/** Fallback is bounded by the committed snapshot's native tiles. A parent request
 * assembles those tiles at their original LOD; it never fetches camera-level
 * polygons behind retained coverage. Boundaries and fills travel in one MVT.
 */
export const fallbackGeometry = async (
  store: GeometryTileStore,
  archiveUrl: string,
  target: TileCoordinate,
  coverage: readonly TileCoordinate[],
  config: FallbackGeometry,
  signal: AbortSignal,
  metrics?: FallbackMetrics,
): Promise<Uint8Array> => {
  signal.throwIfAborted()
  if (metrics) metrics.requests++
  const covered = new Set(coverage.map((t) => `${t.z}/${t.x}/${t.y}`))
  const missing = config.tiles.filter((tile) => {
    const scale = 2 ** (tile.z - target.z)
    return (
      scale >= 1 &&
      Math.floor(tile.x / scale) === target.x &&
      Math.floor(tile.y / scale) === target.y &&
      !covered.has(`${tile.z}/${tile.x}/${tile.y}`)
    )
  })
  if (!missing.length) return new Uint8Array()
  let cache = caches.get(store)
  if (!cache) {
    cache = new ByteCache(96, 16 * 1024 * 1024)
    caches.set(store, cache)
  }
  const key = JSON.stringify([archiveUrl, target, config.sourceLayer, config.selection, missing])
  const cached = cache.get(key)
  if (cached) {
    if (metrics) metrics.cacheHits++
    return cached
  }
  const fills: Feature[] = [],
    boundaries: Feature[] = []
  const extent = 8192
  for (const tile of missing) {
    const scale = 2 ** (tile.z - target.z)
    signal.throwIfAborted()
    const fetchStarted = performance.now()
    const bytes = await store.read(archiveUrl, tile, signal)
    if (metrics) metrics.fetchMs += performance.now() - fetchStarted
    if (!bytes.length) continue
    const clipStarted = performance.now()
    const outline = await sourceBoundaries(bytes, config, signal)
    const clipped = await clipFallbackTile(outline.source, tile, [], metrics, signal, false, true)
    if (metrics) metrics.clipMs += performance.now() - clipStarted
    const layer = new VectorTile(new PbfReader(clipped)).layers[config.sourceLayer]
    if (!layer) continue
    const project = ([x, y]: Point): Point => [
      (tile.x / scale - target.x) * extent + (x / layer.extent / scale) * extent,
      (tile.y / scale - target.y) * extent + (y / layer.extent / scale) * extent,
    ]
    for (let i = 0; i < layer.length; i++) {
      const feature = layer.feature(i)
      if (feature.type !== 3) continue
      fills.push({
        type: 3,
        tags: feature.properties,
        ...(feature.id === undefined ? {} : { id: feature.id }),
        geometry: classifyRings(feature.loadGeometry()).flatMap((p) =>
          quantizeTilePolygon(
            p.map((r) => r.map(({ x, y }): Point => [x, y])),
            project,
          ),
        ),
      })
    }
    for (const feature of outline.features)
      boundaries.push({
        ...feature,
        type: 2,
        geometry: (feature.geometry as Point[][]).map((line) =>
          line.map((p) => project(p).map(Math.round) as Point),
        ),
      })
  }
  signal.throwIfAborted()
  if (!fills.length && !boundaries.length) return new Uint8Array()
  const polygons = new GeoJSONWrapper(
    fills.map((f) => ({
      ...f,
      type: 3 as const,
      geometry: bufferTileEdges(f.geometry as Point[][], extent),
    })),
    { extent, version: 2 },
  )
  polygons.name = config.sourceLayer
  const lines = new GeoJSONWrapper(boundaries, { extent, version: 2 })
  lines.name = FALLBACK_BOUNDARY_LAYER
  const result = fromVectorTileJs({
    layers: { [config.sourceLayer]: polygons, [FALLBACK_BOUNDARY_LAYER]: lines },
  })
  cache.set(key, result)
  if (metrics) {
    metrics.resultBytes = cache.bytes
    metrics.resultEntries = cache.size
  }
  return result
}
