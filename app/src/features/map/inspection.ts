import type { Map as MapLibreMap, PointLike } from 'maplibre-gl'
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
export const visibleVariantIds = (
  map: Pick<MapLibreMap, 'getLayer' | 'getPaintProperty' | 'queryRenderedFeatures'> &
    Partial<Pick<MapLibreMap, 'getLayersOrder'>>,
  point: PointLike,
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
  const layers = coverage.length ? coverage : map.getLayer(original) ? [original] : []
  // An empty coverage hit must stay empty: original polygons can differ in detail
  // and must not refill holes or restore contributors absent from the displayed face.
  if (!layers.length) return []
  return [
    ...new Set(
      map
        .queryRenderedFeatures(point, { layers })
        .flatMap(({ properties }) => featureVariantIds(properties)),
    ),
  ].sort()
}
