import { classifyRings, VectorTile, type VectorTileFeature } from '@mapbox/vector-tile'
import { PbfReader } from 'pbf'
import type { AtlasManifest, GeometryVariant } from '../../../domain/atlas.ts'
import { refinedMemberships } from '../../../domain/refinement.ts'
import type { CoverageTile } from './compute.ts'
import { COVERAGE_LAYER } from './delivery.ts'
import { joinParts } from './joinParts.ts'
import type { OverlapMetrics, OverlapRequest, TileCoordinate } from './types.ts'
import { patternId } from './types.ts'

/** Select a prepared profile by actual metadata, never by parsing variant IDs. */
export const createPartsResolver = (
  config: AtlasManifest['coverageParts'],
  variants: readonly Pick<GeometryVariant, 'id' | 'datasetId' | 'temporalCoverage'>[],
) => {
  const profiles = new Map(
    config?.profiles.map((profile) => [
      JSON.stringify([profile.datasetId, profile.viewId]),
      profile,
    ]),
  )
  const profileByVariant = new Map(
    variants.map((variant) => [
      variant.id,
      profiles.get(JSON.stringify([variant.datasetId, variant.temporalCoverage.viewId])),
    ]),
  )
  return (ids: readonly string[]): OverlapRequest['parts'] => {
    if (!config || !ids.length) return undefined
    const profile = profileByVariant.get(ids[0] ?? '')
    if (!profile || ids.some((id) => profileByVariant.get(id) !== profile)) return undefined
    return {
      directory: config.directory,
      maxZoom: profile.maxZoom ?? config.maxZoom,
      profile: profile.id,
      ...(profile.tileIndex ? { tileIndex: profile.tileIndex } : {}),
      ...(profile.tiles ? { tiles: profile.tiles } : {}),
    }
  }
}

interface Part {
  readonly feature: VectorTileFeature
  readonly members: readonly string[]
}
interface PartsTile {
  readonly partsByVariant: ReadonlyMap<string, readonly Part[]>
  readonly extent: number
  readonly bytes: number
}

/** Selection-independent MVT/metadata cache; decoded coordinates belong to result caches. */
export class CoverageParts {
  private readonly fetcher: (url: string, options?: { signal?: AbortSignal }) => Promise<Response>
  constructor(
    fetcher: (url: string, options?: { signal?: AbortSignal }) => Promise<Response> = fetch,
  ) {
    this.fetcher = fetcher
  }
  private readonly tiles = new Map<string, PartsTile>()
  private readonly indexes = new Map<string, Readonly<Record<string, readonly string[]>>>()
  private bytes = 0

  stats() {
    return { partsEntries: this.tiles.size, partsBytes: this.bytes }
  }

  async resolve(
    request: OverlapRequest,
    tile: TileCoordinate,
    metrics?: OverlapMetrics,
    signal?: AbortSignal,
  ): Promise<CoverageTile | null> {
    const config = request.parts
    if (!config || tile.z > config.maxZoom) return null
    let index = config.tiles
    if (config.tileIndex) {
      const url = new URL(config.tileIndex, new URL(config.directory, request.archiveUrl)).href
      index = this.indexes.get(url)
      if (!index) {
        try {
          const started = performance.now()
          const response = await this.fetcher(url, signal ? { signal } : {})
          signal?.throwIfAborted()
          if (!response.ok) return null
          const parsed: unknown = await response.json()
          signal?.throwIfAborted()
          if (metrics) metrics.fetchMs += performance.now() - started
          if (
            !parsed ||
            typeof parsed !== 'object' ||
            Array.isArray(parsed) ||
            !Object.entries(parsed).every(
              ([z, coords]) =>
                /^\d+$/.test(z) &&
                Array.isArray(coords) &&
                coords.every((c) => typeof c === 'string' && /^\d+-\d+$/.test(c)),
            )
          )
            return null
          index = parsed as Readonly<Record<string, readonly string[]>>
          this.indexes.set(url, index)
          if (this.indexes.size > 8) {
            const oldest = this.indexes.keys().next().value
            if (oldest !== undefined) this.indexes.delete(oldest)
          }
        } catch {
          signal?.throwIfAborted()
          return null
        }
      }
    }
    if (index) {
      const level = index[String(tile.z)]
      // No index means unprepared. A complete level's absent tiles are empty,
      // including areas outside the source bounds; neither needs an HTTP request.
      if (!level) return null
      if (!level.includes(`${tile.x}-${tile.y}`)) {
        if (metrics) metrics.partsTiles = (metrics.partsTiles ?? 0) + 1
        return { tile, extent: 8192, features: [], vertices: 0 }
      }
    }
    const directory = new URL(`${config.profile}/`, new URL(config.directory, request.archiveUrl))
    const url = `${directory}${tile.z}-${tile.x}-${tile.y}.pbf`
    let cached = this.tiles.get(url)
    if (cached) {
      this.tiles.delete(url)
      this.tiles.set(url, cached)
      if (metrics) metrics.partsCacheHits = (metrics.partsCacheHits ?? 0) + 1
    } else {
      // Optional preparation may be absent on an older deployment. Only loading
      // and format failures fall back live; cancellation and output budgets propagate.
      try {
        const started = performance.now()
        const response = await this.fetcher(url, signal ? { signal } : {})
        signal?.throwIfAborted()
        if (!response.ok) return null
        const data = new Uint8Array(await response.arrayBuffer())
        if (metrics) metrics.fetchMs += performance.now() - started
        const decodeStart = performance.now()
        const layer = data.length
          ? new VectorTile(new PbfReader(data)).layers[COVERAGE_LAYER]
          : undefined
        if (data.length && !layer) return null
        const partsByVariant = new Map<string, Part[]>()
        for (let i = 0; i < (layer?.length ?? 0); i++) {
          const feature = layer?.feature(i)
          if (feature?.type !== 3) throw new Error('Non-polygon coverage part')
          const ids: unknown =
            typeof feature.properties.variantId === 'string'
              ? [feature.properties.variantId]
              : JSON.parse(String(feature.properties.variantIds))
          if (!Array.isArray(ids) || !ids.length || !ids.every((id) => typeof id === 'string'))
            throw new Error('Invalid coverage part memberships')
          const part = { feature, members: ids }
          for (const id of ids) {
            const parts = partsByVariant.get(id)
            if (parts) parts.push(part)
            else partsByVariant.set(id, [part])
          }
        }
        cached = { partsByVariant, extent: layer?.extent ?? 8192, bytes: data.byteLength }
        if (metrics) metrics.decodeMs += performance.now() - decodeStart
        this.bytes -= this.tiles.get(url)?.bytes ?? 0
        this.tiles.set(url, cached)
        this.bytes += cached.bytes
        while (this.tiles.size > 48 || this.bytes > 16 * 1024 * 1024) {
          const oldest = this.tiles.keys().next().value
          if (oldest === undefined) break
          this.bytes -= this.tiles.get(oldest)?.bytes ?? 0
          this.tiles.delete(oldest)
        }
      } catch {
        signal?.throwIfAborted()
        return null
      }
    }
    signal?.throwIfAborted()
    const started = performance.now()
    const selected = new Set(request.variantIds)
    const parts = new Set<Part>()
    for (const id of selected.size < cached.partsByVariant.size
      ? selected
      : cached.partsByVariant.keys()) {
      if (!selected.has(id)) continue
      for (const part of cached.partsByVariant.get(id) ?? []) parts.add(part)
    }
    const features = new Map<string, CoverageTile['features'][number]>()
    let vertices = 0
    for (const part of parts) {
      const members = refinedMemberships(
        part.members.flatMap((id) =>
          selected.has(id) ? (request.variantGroups?.[id] ?? [id]) : [],
        ),
        request.refinements,
      )
      if (!members.length) continue
      const coordinates = classifyRings(part.feature.loadGeometry()).map((polygon) =>
        polygon.map((ring) =>
          ring.map(({ x, y }): [number, number] => {
            return [x, y]
          }),
        ),
      )
      const pattern = patternId(members)
      const feature = features.get(pattern)
      if (feature) feature.geometry.coordinates.push(...coordinates)
      else
        features.set(pattern, {
          type: 'Feature',
          properties: { pattern, variantIds: members },
          geometry: { type: 'MultiPolygon', coordinates },
        })
    }
    for (const feature of features.values()) {
      feature.geometry.coordinates.splice(
        0,
        feature.geometry.coordinates.length,
        ...joinParts(feature.geometry.coordinates),
      )
      for (const polygon of feature.geometry.coordinates)
        for (const ring of polygon) vertices += ring.length
    }
    if (metrics) {
      metrics.partsTiles = (metrics.partsTiles ?? 0) + 1
      metrics.membershipMs = (metrics.membershipMs ?? 0) + performance.now() - started
    }
    return { tile, extent: cached.extent, features: [...features.values()], vertices }
  }
}
