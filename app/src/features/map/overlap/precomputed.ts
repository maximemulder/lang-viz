import { classifyRings, VectorTile } from '@mapbox/vector-tile'
import { PbfReader } from 'pbf'
import type { AtlasManifest } from '../../../domain/atlas.ts'
import type { CoverageTile } from './compute.ts'
import { COVERAGE_LAYER } from './delivery.ts'
import type { OverlapMetrics, OverlapRequest, OverlapSelection, TileCoordinate } from './types.ts'

export type PrecomputedBranches = NonNullable<AtlasManifest['branchCoverage']>

/** Exact geometry policy, excluding colors, presentation, and browsing context. */
export const branchCoverageSignature = async (selection: OverlapSelection) => {
  if (!globalThis.crypto?.subtle) return null
  if (
    selection.variantIds.some((id) => {
      const owners = selection.variantGroups?.[id]
      return owners && (owners.length !== 1 || owners[0] !== id)
    })
  )
    return null
  const ids = [...new Set(selection.variantIds)].sort()
  const policy = ids.map((id) => [id, [...(selection.refinements?.[id] ?? [])].sort()])
  // Increment this format/policy version when prepared geometry semantics change.
  const bytes = new TextEncoder().encode(JSON.stringify(['branch-v1', policy]))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Resolve optional assets once per selection, before visiting individual tiles. */
export const prepareBranchCoverage = async (request: OverlapRequest) => {
  const config = request.precomputed
  if (!config) return null
  const signature = await branchCoverageSignature(request)
  if (!signature || !config.signatures.includes(signature)) return null
  const directory = new URL(`${signature}/`, new URL(config.directory, request.archiveUrl))
  return (tile: TileCoordinate) =>
    tile.z <= config.maxZoom ? `${directory}${tile.z}-${tile.x}-${tile.y}.pbf` : null
}

/** Missing optional assets fall back live; cancellation still stops the request. */
export const loadPrecomputedTile = async (
  url: string,
  tile: TileCoordinate,
  metrics?: OverlapMetrics,
  signal?: AbortSignal,
  fetcher: (url: string, options?: { signal?: AbortSignal }) => Promise<Response> = fetch,
): Promise<CoverageTile | null> => {
  const started = performance.now()
  try {
    const response = await fetcher(url, signal ? { signal } : {})
    if (!response.ok) throw new Error(`Prepared coverage HTTP ${response.status}`)
    const data = new Uint8Array(await response.arrayBuffer())
    if (metrics) metrics.fetchMs += performance.now() - started
    const decodeStart = performance.now()
    const decoded = decodePrecomputedTile(data, tile)
    if (metrics) metrics.decodeMs += performance.now() - decodeStart
    return decoded
  } catch {
    signal?.throwIfAborted()
    return null
  }
}

/** Prepared tiles use the same canonical MVT representation as live coverage. */
export const decodePrecomputedTile = (data: Uint8Array, tile: TileCoordinate): CoverageTile => {
  const layer = data.length ? new VectorTile(new PbfReader(data)).layers[COVERAGE_LAYER] : undefined
  let vertices = 0
  const features: CoverageTile['features'] = []
  for (let i = 0; i < (layer?.length ?? 0); i++) {
    const feature = layer?.feature(i)
    if (feature?.type !== 3) continue
    const ids: unknown =
      typeof feature.properties.variantId === 'string'
        ? [feature.properties.variantId]
        : JSON.parse(String(feature.properties.variantIds))
    if (!Array.isArray(ids) || !ids.length || !ids.every((id) => typeof id === 'string'))
      throw new Error('Invalid prepared branch memberships')
    features.push({
      type: 'Feature',
      properties: { pattern: String(feature.properties.pattern), variantIds: ids },
      geometry: {
        type: 'MultiPolygon',
        coordinates: classifyRings(feature.loadGeometry()).map((polygon) =>
          polygon.map((ring) =>
            ring.map(({ x, y }) => {
              vertices++
              return [x, y]
            }),
          ),
        ),
      },
    })
  }
  return { tile, extent: layer?.extent ?? 8192, features, vertices }
}
