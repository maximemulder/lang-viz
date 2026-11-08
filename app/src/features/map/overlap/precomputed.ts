import { classifyRings, VectorTile } from '@mapbox/vector-tile'
import { PbfReader } from 'pbf'
import type { CoverageTile } from './compute.ts'
import { COVERAGE_LAYER } from './delivery.ts'
import type { OverlapSelection, TileCoordinate } from './types.ts'

export interface PrecomputedBranches {
  readonly directory: string
  readonly maxZoom: number
  readonly signatures: readonly string[]
}

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
