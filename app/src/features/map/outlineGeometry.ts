import { classifyRings, VectorTile } from '@mapbox/vector-tile'
import { type Feature, fromVectorTileJs, GeoJSONWrapper } from '@maplibre/vt-pbf'
import { PbfReader } from 'pbf'
import { OUTLINE_LAYER } from './outlineSelection.ts'
import { type MultiPolygon, OverlapInitializationError } from './overlap/geometry.ts'
import { lazyResource } from './overlap/lazyResource.ts'
import { quantizeTilePolygon } from './overlap/tileGeometry.ts'

const loadUnion = lazyResource(() =>
  import('./overlap/geos.ts')
    .then(({ createOutlineUnion }) => createOutlineUnion())
    .catch((error: unknown) => {
      throw new OverlapInitializationError(error)
    }),
)

/** Union buffered source polygons before drawing their boundaries. Tile cuts stay
 * outside the visible tile; no clipping, snapping, or inferred coverage is added.
 * Independent inspected representations remain separate outline groups.
 */
export const dissolveOutlineTile = async (
  bytes: Uint8Array,
  sourceLayer: string,
  groups: readonly (readonly string[])[],
  signal?: AbortSignal,
): Promise<Uint8Array> => {
  signal?.throwIfAborted()
  if (!bytes.length || !groups.length) return new Uint8Array()
  const layer = new VectorTile(new PbfReader(bytes)).layers[sourceLayer]
  if (!layer) return new Uint8Array()
  const wanted = new Set(groups.flat())
  const geometries = new Map<string, MultiPolygon>()
  for (let i = 0; i < layer.length; i++) {
    const feature = layer.feature(i)
    const id = feature.properties.variant_id
    if (feature.type !== 3 || typeof id !== 'string' || !wanted.has(id)) continue
    const polygons = classifyRings(feature.loadGeometry()).map((polygon) =>
      polygon.map((ring) => ring.map(({ x, y }): [number, number] => [x, y])),
    )
    const existing = geometries.get(id)
    if (existing) existing.push(...polygons)
    else geometries.set(id, polygons)
  }
  const features: Feature[] = []
  for (const ids of groups) {
    signal?.throwIfAborted()
    const present = [...new Set(ids)].filter((id) => geometries.has(id))
    const polygons = present.flatMap((id) => geometries.get(id) ?? [])
    if (!polygons.length) continue
    const union = polygons.length > 1 ? await loadUnion() : undefined
    signal?.throwIfAborted()
    const merged = union ? union(polygons) : polygons
    const geometry = merged.flatMap((polygon) => quantizeTilePolygon(polygon, (point) => point))
    if (geometry.length)
      features.push({
        type: 3,
        geometry,
        tags: { variant_ids: JSON.stringify(present.sort()) },
      })
  }
  signal?.throwIfAborted()
  if (!features.length) return new Uint8Array()
  const output = new GeoJSONWrapper(features, { extent: layer.extent, version: 2 })
  output.name = OUTLINE_LAYER
  return fromVectorTileJs({ layers: { [OUTLINE_LAYER]: output } })
}
