import type {
  AtlasData,
  AtlasManifest,
  GeographyDataset,
  GeometryVariant,
  Language,
} from '../domain/atlas'
import { buildLanguageSearchIndex } from '../domain/catalog'
import type { GeographicBounds } from '../domain/languageFocus'
import { geometryArchiveUrl } from './geometryArchives'

const dataUrl = (fileName: string) => `${import.meta.env.BASE_URL}data/${fileName}`

const fetchJson = async <T>(fileName: string): Promise<T> => {
  const response = await fetch(dataUrl(fileName))
  if (!response.ok) {
    throw new Error(`Could not load ${fileName}: ${response.status} ${response.statusText}`)
  }
  return response.json() as Promise<T>
}

let atlasDataPromise: Promise<AtlasData> | undefined

export const loadAtlasData = (): Promise<AtlasData> => {
  atlasDataPromise ??= fetchJson<AtlasManifest>('manifest.json').then(async (manifest) => {
    const [languages, variants, datasets] = await Promise.all([
      fetchJson<readonly Language[]>('languages.json'),
      fetchJson<readonly GeometryVariant[]>(manifest.geometryIndex ?? 'geometry-variants.json'),
      fetchJson<readonly GeographyDataset[]>('geography-datasets.json'),
    ])
    if (manifest.schemaVersion !== 5) {
      throw new Error(`Unsupported atlas schema version: ${manifest.schemaVersion}`)
    }
    if (languages.length !== manifest.languoidCount) {
      throw new Error('Languoid catalog does not match its manifest')
    }
    if (variants.length !== manifest.geometryVariantCount) {
      throw new Error('Geometry catalog does not match its manifest')
    }

    return {
      manifest,
      languages,
      variants,
      datasets,
      languageById: new Map(languages.map((language) => [language.id, language])),
      variantById: new Map(variants.map((variant) => [variant.id, variant])),
      languageSearchIndex: buildLanguageSearchIndex(languages),
    }
  })

  return atlasDataPromise
}

export interface GeometryProvenance {
  readonly sourceFile: string
  readonly sourceFeatureIds: readonly string[]
}

let boundsPromise: Promise<Readonly<Record<string, GeographicBounds>>> | undefined
/** Camera metadata is loaded on the first explicit profile action, never on hover. */
export const loadGeometryBounds = (manifest: AtlasManifest) => {
  if (!manifest.geometryBounds)
    return Promise.resolve({} as Readonly<Record<string, GeographicBounds>>)
  boundsPromise ??= fetchJson<Readonly<Record<string, GeographicBounds>>>(
    manifest.geometryBounds,
  ).catch((error) => {
    boundsPromise = undefined
    throw error
  })
  return boundsPromise
}
const provenance = new Map<string, Promise<Record<string, GeometryProvenance>>>()

export const loadGeometryProvenance = async (manifest: AtlasManifest, variant: GeometryVariant) => {
  if (variant.sourceFile && variant.sourceFeatureIds)
    return { sourceFile: variant.sourceFile, sourceFeatureIds: variant.sourceFeatureIds }
  if (!manifest.geometryProvenance) throw new Error('Source records are unavailable')
  const file = `${manifest.geometryProvenance}${variant.datasetId}/${variant.temporalCoverage.viewId}.json`
  let pending = provenance.get(file)
  if (!pending) {
    pending = fetchJson<Record<string, GeometryProvenance>>(file).catch((error) => {
      provenance.delete(file)
      throw error
    })
    provenance.set(file, pending)
  }
  const record = (await pending)[variant.id]
  if (!record) throw new Error('Source records are unavailable')
  return record
}

export const languageArchiveUrl = (archives?: readonly string[]) => {
  const archiveUrl = new URL(dataUrl('language-areas.pmtiles'), window.location.href)
  return `pmtiles://${geometryArchiveUrl(archiveUrl.href, archives)}`
}
