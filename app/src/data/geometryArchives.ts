import { VectorTile, type VectorTileLayer } from '@mapbox/vector-tile'
import { fromVectorTileJs, type VectorTileLayerLike } from '@maplibre/vt-pbf'
import { PbfReader } from 'pbf'
import { PMTiles } from 'pmtiles'
import type {
  AtlasManifest,
  GeographyDatasetSelection,
  GeometryVariant,
  TemporalViewSelection,
} from '../domain/atlas.ts'

const ARCHIVES_PARAM = 'atlasArchives'
const archiveReaders = new Map<string, PMTiles>()
const sharedArchive = (url: string) => {
  let reader = archiveReaders.get(url)
  if (reader) archiveReaders.delete(url)
  else reader = new PMTiles(url)
  archiveReaders.set(url, reader)
  if (archiveReaders.size > 16) {
    const oldest = archiveReaders.keys().next().value
    if (oldest !== undefined) archiveReaders.delete(oldest)
  }
  return reader
}

/** Browsing filters and pinned entries can legitimately require different profiles. */
export const selectGeometryArchives = (
  manifest: AtlasManifest,
  variants: readonly GeometryVariant[],
  datasets: GeographyDatasetSelection,
  period: TemporalViewSelection,
  pinnedIds: readonly string[],
) => {
  if (!manifest.geometryProfiles) return undefined
  const pinned = new Set(pinnedIds)
  const required = new Set(
    variants
      .filter((v) => pinned.has(v.id))
      .map((v) => JSON.stringify([v.datasetId, v.temporalCoverage.viewId])),
  )
  return manifest.geometryProfiles
    .filter(
      (p) =>
        ((datasets === 'all' || datasets.includes(p.datasetId)) &&
          (period === 'all' || period === p.viewId)) ||
        required.has(JSON.stringify([p.datasetId, p.viewId])),
    )
    .map((p) => p.archive)
    .sort()
}

/** Keep an HTTP base for relative prepared-asset URLs; the query identifies source shards. */
export const geometryArchiveUrl = (baseUrl: string, archives?: readonly string[]) => {
  const url = new URL(baseUrl)
  if (archives) url.searchParams.set(ARCHIVES_PARAM, JSON.stringify([...new Set(archives)].sort()))
  return url.href
}

/** Merge source layers only; cross-dataset overlaps still go through the real partitioner. */
export const mergeGeometryTiles = (buffers: readonly Uint8Array[]) => {
  if (buffers.length === 1) return buffers[0] ?? new Uint8Array()
  const byName = new Map<string, VectorTileLayer[]>()
  for (const bytes of buffers) {
    if (!bytes.length) continue
    for (const [name, layer] of Object.entries(new VectorTile(new PbfReader(bytes)).layers)) {
      const layers = byName.get(name)
      if (layers) layers.push(layer)
      else byName.set(name, [layer])
    }
  }
  const layers: Record<string, VectorTileLayerLike> = {}
  for (const [name, sources] of byName) {
    const first = sources[0]
    if (!first) continue
    if (sources.some((s) => s.extent !== first.extent || s.version !== first.version))
      throw new Error('Incompatible geometry profile tiles')
    const features = sources.flatMap((s) =>
      Array.from({ length: s.length }, (_, i) => s.feature(i)),
    )
    layers[name] = {
      name,
      version: first.version,
      extent: first.extent,
      length: features.length,
      feature: (i) => {
        const feature = features[i]
        if (!feature) throw new Error('Invalid geometry feature index')
        return feature
      },
    }
  }
  return byName.size ? fromVectorTileJs({ layers }) : new Uint8Array()
}

/** Used in both geometry workers; each underlying archive retains its range index. */
export const openGeometryArchive = (
  archiveUrl: string,
  open: (url: string) => Pick<PMTiles, 'getZxy'> = sharedArchive,
): Pick<PMTiles, 'getZxy'> => {
  const url = new URL(archiveUrl)
  const encoded = url.searchParams.get(ARCHIVES_PARAM)
  if (encoded === null) return open(archiveUrl)
  const archives: unknown = JSON.parse(encoded)
  if (!Array.isArray(archives) || !archives.every((name) => typeof name === 'string'))
    throw new Error('Invalid geometry archives')
  const sources = [...new Set(archives)].map((name) => open(new URL(name, url).href))
  return {
    getZxy: async (z, x, y, signal) => {
      signal?.throwIfAborted()
      const responses = await Promise.all(sources.map((source) => source.getZxy(z, x, y, signal)))
      signal?.throwIfAborted()
      const data = mergeGeometryTiles(responses.flatMap((r) => (r ? [new Uint8Array(r.data)] : [])))
      return data.byteLength ? { data: data.slice().buffer } : undefined
    },
  }
}
