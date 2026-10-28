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
import type { OverlapCollection, OverlapRequest } from './types.ts'
import { patternId } from './types.ts'

const MAX_CACHED_TILES = 48
const MAX_CACHED_BYTES = 16 * 1024 * 1024
const MAX_CACHED_RESULT_VERTICES = 150_000
const MAX_TILE_VERTICES = 100_000
const MAX_OUTPUT_VERTICES = 200_000

const inputsFromFeatures = (features: readonly VectorTileFeature[]): CoverageInput[] => {
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
          if (vertexCount > MAX_TILE_VERTICES) throw new OverlapBudgetError()
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
    { readonly layer: VectorTileLayer | undefined; readonly bytes: number }
  >()
  private readonly results = new Map<
    string,
    { readonly regions: CoverageRegion[]; readonly vertices: number }
  >()
  private cachedBytes = 0
  private cachedResultVertices = 0

  async compute(
    archive: PMTiles,
    request: OverlapRequest,
    isCurrent: () => boolean,
  ): Promise<OverlapCollection | null> {
    const collection: OverlapCollection = {
      type: 'FeatureCollection',
      features: [],
      revision: request.requestId,
      coverageTiles: request.tiles,
    }
    const selected = new Set(request.variantIds)
    let outputVertices = 0
    for (const tile of request.tiles) {
      if (!isCurrent()) return null
      const key = `${tile.z}/${tile.x}/${tile.y}`
      let cached = this.tiles.get(key)
      if (!cached) {
        const response = await archive.getZxy(tile.z, tile.x, tile.y)
        if (!isCurrent()) return null
        cached = {
          layer: response
            ? new VectorTile(new PbfReader(response.data)).layers[request.sourceLayer]
            : undefined,
          bytes: response?.data.byteLength ?? 0,
        }
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
      if (!layer) continue
      // Inspect inexpensive metadata first. Unselected tiles and cached
      // memberships need no geometry decoding or Boolean operations.
      const features: VectorTileFeature[] = []
      const localIdSet = new Set<string>()
      for (let i = 0; i < layer.length; i++) {
        const feature = layer.feature(i)
        const id = feature.properties.variant_id
        if (feature.type !== 3 || typeof id !== 'string' || !selected.has(id)) continue
        features.push(feature)
        localIdSet.add(id)
      }
      const localIds = [...localIdSet].sort()
      if (localIds.length === 0) continue
      const resultKey = `${key}:${localIds.join('|')}`
      let regions = this.results.get(resultKey)?.regions
      if (!regions) {
        const partitionCoverage = await loadCoveragePartition()
        if (!isCurrent()) return null
        const inputs = inputsFromFeatures(features)
        regions = partitionCoverage(inputs, layer.extent, {
          deadline: performance.now() + 1_500,
          includeSingles: true,
        })
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
        this.results.set(resultKey, { regions, vertices })
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
      for (const region of regions) {
        const coordinates = region.geometry.map((polygon) =>
          polygon.map((ring) =>
            ring.map((point) => {
              outputVertices++
              return tilePositionToLngLat(point, tile, layer.extent)
            }),
          ),
        )
        if (outputVertices > MAX_OUTPUT_VERTICES) throw new OverlapBudgetError()
        collection.features.push({
          type: 'Feature',
          properties: { pattern: patternId(region.members), variantIds: region.members },
          geometry: { type: 'MultiPolygon', coordinates },
        })
      }
      // Allow newer selections to cancel between tiles instead of queueing jobs.
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
    return isCurrent() ? collection : null
  }
}
