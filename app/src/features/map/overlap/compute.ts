import type { VectorTileFeature, VectorTileLayer } from '@mapbox/vector-tile'
import { classifyRings, VectorTile } from '@mapbox/vector-tile'
import { PbfReader } from 'pbf'
import type { PMTiles } from 'pmtiles'
import {
  type CoverageInput,
  type CoverageRegion,
  loadCoveragePartition,
  type MultiPolygon,
  OverlapBudgetError,
} from './geometry.ts'
import { tilePositionToLngLat } from './tiles.ts'
import type {
  OverlapCollection,
  OverlapMetrics,
  OverlapProperties,
  OverlapRequest,
  TileCoordinate,
} from './types.ts'
import { patternId } from './types.ts'

const MAX_CACHED_TILES = 48
const MAX_CACHED_BYTES = 16 * 1024 * 1024
const MAX_CACHED_RESULT_VERTICES = 150_000
const MAX_TILE_VERTICES = 100_000
const MAX_OUTPUT_VERTICES = 200_000

const deliveryFeatures = (regions: readonly CoverageRegion[]) => {
  // Keep bounds local to a computation tile, but share properties across islands.
  const features = new Map<string, NativeCoverageFeature>()
  for (const region of regions) {
    const coordinates = region.geometry
    const pattern = patternId(region.members)
    const feature = features.get(pattern)
    if (feature) feature.geometry.coordinates.push(...coordinates)
    else
      features.set(pattern, {
        type: 'Feature',
        properties: { pattern, variantIds: region.members },
        geometry: { type: 'MultiPolygon', coordinates },
      })
  }
  return [...features.values()]
}

/** Complete, disjoint coverage in native tile coordinates, including empty tiles. */
export interface CoverageTile {
  readonly tile: TileCoordinate
  readonly extent: number
  readonly features: NativeCoverageFeature[]
  readonly vertices: number
}

interface NativeCoverageFeature {
  readonly type: 'Feature'
  readonly properties: OverlapProperties
  readonly geometry: { readonly type: 'MultiPolygon'; readonly coordinates: MultiPolygon }
}

const indexFeatures = (layer: VectorTileLayer | undefined) => {
  const index = new Map<string, VectorTileFeature[]>()
  if (!layer) return index
  for (let i = 0; i < layer.length; i++) {
    const feature = layer.feature(i)
    const id = feature.properties.variant_id
    if (feature.type !== 3 || typeof id !== 'string') continue
    const fragments = index.get(id)
    if (fragments) fragments.push(feature)
    else index.set(id, [feature])
  }
  return index
}

const inputsFromFeatures = (
  features: readonly VectorTileFeature[],
  metrics?: OverlapMetrics,
): CoverageInput[] => {
  const inputs: CoverageInput[] = []
  let vertexCount = 0
  for (const feature of features) {
    const id = feature.properties.variant_id
    if (typeof id !== 'string') continue
    const polygons = classifyRings(feature.loadGeometry())
    const geometry: MultiPolygon = polygons.map((polygon) =>
      polygon.map((ring) =>
        ring.map(({ x, y }) => {
          vertexCount++
          if (metrics) metrics.inputVertices++
          if (vertexCount > MAX_TILE_VERTICES) throw new OverlapBudgetError('input-vertices')
          return [x, y]
        }),
      ),
    )
    inputs.push({ id, geometry })
  }
  return inputs
}

/** Independent of React and worker messaging so real PMTiles can be tested in Node. */
export class OverlapComputer {
  private readonly tiles = new Map<
    string,
    {
      readonly layer: VectorTileLayer | undefined
      readonly index: ReadonlyMap<string, readonly VectorTileFeature[]>
      readonly bytes: number
    }
  >()
  private readonly results = new Map<
    string,
    { readonly features: NativeCoverageFeature[]; readonly vertices: number }
  >()
  private cachedBytes = 0
  private cachedResultVertices = 0

  stats() {
    return {
      decodedEntries: this.tiles.size,
      decodedBytes: this.cachedBytes,
      partitionEntries: this.results.size,
      partitionVertices: this.cachedResultVertices,
      indexedFeatures: [...this.tiles.values()].reduce(
        (sum, tile) => sum + (tile.layer?.length ?? 0),
        0,
      ),
    }
  }

  async compute(
    archive: Pick<PMTiles, 'getZxy'>,
    request: OverlapRequest,
    isCurrent: () => boolean,
    metrics?: OverlapMetrics,
  ): Promise<OverlapCollection | null> {
    const collection: OverlapCollection = {
      type: 'FeatureCollection',
      features: [],
      revision: request.requestId,
      coverageTiles: request.tiles,
    }
    for await (const result of this.computeTiles(archive, request, isCurrent, metrics)) {
      collection.features.push(
        ...result.features.map((feature) => ({
          ...feature,
          geometry: {
            type: 'MultiPolygon' as const,
            coordinates: feature.geometry.coordinates.map((polygon) =>
              polygon.map((ring) =>
                ring.map((point) => tilePositionToLngLat(point, result.tile, result.extent)),
              ),
            ),
          },
        })),
      )
    }
    return isCurrent() ? collection : null
  }

  async *computeTiles(
    archive: Pick<PMTiles, 'getZxy'>,
    request: OverlapRequest,
    isCurrent: () => boolean,
    metrics?: OverlapMetrics,
    signal?: AbortSignal,
  ): AsyncGenerator<CoverageTile> {
    const selected = new Set(request.variantIds)
    let outputVertices = 0
    for (const tile of request.tiles) {
      if (!isCurrent()) return
      const key = JSON.stringify([request.archiveUrl, request.sourceLayer, tile.z, tile.x, tile.y])
      let cached = this.tiles.get(key)
      if (cached) {
        if (metrics) metrics.decodedCacheHits++
        this.tiles.delete(key)
        this.tiles.set(key, cached)
      }
      if (!cached) {
        const fetchStart = performance.now()
        const response = await archive.getZxy(tile.z, tile.x, tile.y, signal)
        if (metrics) metrics.fetchMs += performance.now() - fetchStart
        if (!isCurrent()) return
        const decodeStart = performance.now()
        const layer = response
          ? new VectorTile(new PbfReader(response.data)).layers[request.sourceLayer]
          : undefined
        cached = {
          layer,
          index: indexFeatures(layer),
          bytes: response?.data.byteLength ?? 0,
        }
        if (metrics) metrics.decodeMs += performance.now() - decodeStart
        this.tiles.set(key, cached)
        this.cachedBytes += cached.bytes
        while (this.tiles.size > MAX_CACHED_TILES || this.cachedBytes > MAX_CACHED_BYTES) {
          const oldestKey = this.tiles.keys().next().value
          if (oldestKey === undefined) break
          this.cachedBytes -= this.tiles.get(oldestKey)?.bytes ?? 0
          this.tiles.delete(oldestKey)
        }
      }
      const layer = cached.layer
      if (!layer) {
        if (metrics) metrics.completedTiles++
        yield { tile, extent: 4096, features: [], vertices: 0 }
        continue
      }
      // Inspect inexpensive metadata first. Unselected tiles and cached
      // memberships need no geometry decoding or Boolean operations.
      const features: VectorTileFeature[] = []
      const localIds: string[] = []
      const metadataStart = performance.now()
      // Reuse the tile's metadata index across selections and cache hits. Choose
      // the smaller set so small selections don't scan every feature in a tile.
      for (const id of selected.size < cached.index.size ? selected : cached.index.keys()) {
        if (!selected.has(id)) continue
        const fragments = cached.index.get(id)
        if (!fragments) continue
        features.push(...fragments)
        localIds.push(id)
      }
      if (metrics) metrics.decodeMs += performance.now() - metadataStart
      localIds.sort()
      if (localIds.length === 0) {
        if (metrics) metrics.completedTiles++
        yield { tile, extent: layer.extent, features: [], vertices: 0 }
        continue
      }
      const resultKey = `${key}:${localIds.join('|')}`
      let result = this.results.get(resultKey)
      if (result) {
        if (metrics) metrics.partitionCacheHits++
        this.results.delete(resultKey)
        this.results.set(resultKey, result)
      }
      if (!result) {
        const initializeStart = performance.now()
        const partitionCoverage = await loadCoveragePartition()
        if (metrics) metrics.initializeMs += performance.now() - initializeStart
        if (!isCurrent()) return
        const decodeStart = performance.now()
        let inputs: CoverageInput[]
        try {
          inputs = inputsFromFeatures(features, metrics)
        } finally {
          if (metrics) metrics.decodeMs += performance.now() - decodeStart
        }
        const partitionStart = performance.now()
        let regions: CoverageRegion[]
        try {
          regions = partitionCoverage(inputs, layer.extent, {
            deadline: performance.now() + 1_500,
            includeSingles: true,
          })
        } finally {
          if (metrics) metrics.partitionMs += performance.now() - partitionStart
        }
        const vertices = regions.reduce(
          (sum, region) =>
            sum +
            region.geometry.reduce(
              (polygons, polygon) =>
                polygons + polygon.reduce((rings, ring) => rings + ring.length, 0),
              0,
            ),
          0,
        )
        if (outputVertices + vertices > MAX_OUTPUT_VERTICES)
          throw new OverlapBudgetError('output-vertices')
        const outputStart = performance.now()
        // Keep tile coordinates: delivery can encode MVT without reprojection
        // or asking MapLibre to construct another GeoJSON tile index.
        result = { features: deliveryFeatures(regions), vertices }
        if (metrics) metrics.outputMs += performance.now() - outputStart
        this.results.set(resultKey, result)
        this.cachedResultVertices += vertices
        while (
          this.results.size > MAX_CACHED_TILES ||
          this.cachedResultVertices > MAX_CACHED_RESULT_VERTICES
        ) {
          const oldestKey = this.results.keys().next().value
          if (oldestKey === undefined) break
          this.cachedResultVertices -= this.results.get(oldestKey)?.vertices ?? 0
          this.results.delete(oldestKey)
        }
      }
      const outputStart = performance.now()
      outputVertices += result.vertices
      if (metrics) metrics.outputVertices += result.vertices
      if (outputVertices > MAX_OUTPUT_VERTICES) throw new OverlapBudgetError('output-vertices')
      if (metrics) {
        metrics.outputMs += performance.now() - outputStart
        metrics.completedTiles++
      }
      yield { tile, extent: layer.extent, ...result }
      // Allow newer selections to cancel between tiles instead of queueing jobs.
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
  }
}
