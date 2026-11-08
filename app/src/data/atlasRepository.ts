import type {
  AtlasData,
  AtlasManifest,
  GeographyDataset,
  GeometryVariant,
  Language,
} from '../domain/atlas'
import { buildLanguageSearchIndex } from '../domain/catalog'

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
  atlasDataPromise ??= Promise.all([
    fetchJson<AtlasManifest>('manifest.json'),
    fetchJson<readonly Language[]>('languages.json'),
    fetchJson<readonly GeometryVariant[]>('geometry-variants.json'),
    fetchJson<readonly GeographyDataset[]>('geography-datasets.json'),
  ]).then(([manifest, languages, variants, datasets]) => {
    if (manifest.schemaVersion !== 4) {
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

export const languageArchiveUrl = () => {
  const archiveUrl = new URL(dataUrl('language-areas.pmtiles'), window.location.href)
  return `pmtiles://${archiveUrl.href}`
}
