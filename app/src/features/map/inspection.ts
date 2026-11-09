import type { Map as MapLibreMap, PointLike } from 'maplibre-gl'
import { type Refinements, refinedMemberships } from '../../domain/refinement.ts'
import {
  BUFFERS,
  blendLayerPrefix,
  fallbackLayerId,
  solidLayerId,
  stripeLayerId,
} from './overlap/layerIds.ts'

/** Coverage memberships are explicit MVT metadata, independent of stripe image names. */
export const featureVariantIds = (properties: Record<string, unknown>): string[] => {
  if (typeof properties.variant_id === 'string') return [properties.variant_id]
  if (typeof properties.variantId === 'string') return [properties.variantId]
  if (typeof properties.variantIds !== 'string') return []
  try {
    const ids: unknown = JSON.parse(properties.variantIds)
    return Array.isArray(ids) && ids.every((id) => typeof id === 'string') ? ids : []
  } catch {
    return []
  }
}

/** Pick the same geometry that contributes color, including retained detail and clipped fallback. */
export const visibleColorLayers = (
  map: Pick<MapLibreMap, 'getLayer' | 'getPaintProperty' | 'queryRenderedFeatures'> &
    Partial<Pick<MapLibreMap, 'getLayersOrder'>>,
): string[] => {
  const coverage = BUFFERS.flatMap((buffer) =>
    [
      solidLayerId(buffer),
      stripeLayerId(buffer),
      fallbackLayerId(buffer),
      ...(map.getLayersOrder?.() ?? []).filter((id) => id.startsWith(blendLayerPrefix(buffer))),
    ].filter(
      (id) => map.getLayer(id) && Number(map.getPaintProperty(id, 'fill-layer-opacity')) > 0,
    ),
  )
  const original = 'selected-language-areas'
  return coverage.length ? coverage : map.getLayer(original) ? [original] : []
}

export const visibleVariantIds = (
  map: Parameters<typeof visibleColorLayers>[0],
  point: PointLike,
  refinements?: Refinements,
  memberships?: Readonly<Record<string, readonly string[]>>,
): string[] => {
  const layers = visibleColorLayers(map)
  // An empty coverage hit must stay empty: original polygons can differ in detail
  // and must not refill holes or restore contributors absent from the displayed face.
  if (!layers.length) return []
  return refinedMemberships(
    [
      ...new Set(
        map.queryRenderedFeatures(point, { layers }).flatMap(({ properties }) => {
          const ids = featureVariantIds(properties)
          // Original/fallback source IDs need expansion. Coverage already contains
          // exact group memberships, including any ancestor refinement.
          return typeof properties.variant_id === 'string'
            ? ids.flatMap((id) => memberships?.[id] ?? [id])
            : ids
        }),
      ),
    ],
    refinements,
  )
}
