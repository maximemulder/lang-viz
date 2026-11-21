import type {
  AtlasManifest,
  GeographyDataset,
  GeometryVariant,
  Language,
  TemporalViewId,
} from './atlas.ts'
import type { GeographicBounds } from './languageFocus.ts'
import { colorCatalogHash, PREPARED_COLOR_POLICY, type PreparedPalette } from './preparedColors.ts'

/** Initial dataset metadata. Colors use the order of languages.json, bound by catalogHash. */
export interface DatasetMetadata {
  readonly colorPolicy: string
  readonly catalogHash: string
  readonly coverageDirectory: string
  readonly datasets: readonly (GeographyDataset & {
    readonly profiles: readonly {
      readonly viewId: TemporalViewId
      readonly coverageSignature: string
      readonly colors: readonly string[]
      readonly bounds?: GeographicBounds
    }[]
  })[]
}

/** A dataset is usable only with complete, compatible default colors. No partial publication. */
export const decodeDatasetMetadata = async (
  metadata: DatasetMetadata,
  languages: readonly Language[],
  variants: readonly GeometryVariant[],
  manifest: AtlasManifest,
): Promise<{
  datasets: readonly GeographyDataset[]
  datasetViewBounds: ReadonlyMap<string, GeographicBounds>
  palettes: ReadonlyMap<string, PreparedPalette>
}> => {
  const validate = (condition: unknown, message: string) => {
    if (!condition) throw new Error(`Invalid dataset metadata: ${message}`)
  }
  validate(metadata?.colorPolicy === PREPARED_COLOR_POLICY, 'color policy does not match')
  validate(
    metadata.coverageDirectory === manifest.branchCoverage?.directory,
    'geometry does not match',
  )
  validate(
    metadata.catalogHash === (await colorCatalogHash(languages, variants)),
    'catalog does not match',
  )
  validate(Array.isArray(metadata.datasets), 'missing datasets')
  const expected = new Set(variants.map((v) => `${v.datasetId}/${v.temporalCoverage.viewId}`))
  const datasets: GeographyDataset[] = []
  const datasetViewBounds = new Map<string, GeographicBounds>()
  const datasetIds = new Set<string>()
  const palettes = new Map<string, PreparedPalette>()
  for (const dataset of metadata.datasets) {
    validate(
      dataset &&
        ['id', 'name', 'shortName', 'citation', 'license'].every(
          (key) => typeof dataset[key as keyof GeographyDataset] === 'string',
        ),
      'invalid dataset description',
    )
    validate(!datasetIds.has(dataset.id), `duplicate dataset ${dataset.id}`)
    datasetIds.add(dataset.id)
    const { profiles, ...description } = dataset
    datasets.push(description)
    validate(Array.isArray(profiles), `missing profiles for ${dataset.id}`)
    for (const profile of profiles) {
      const id = `${dataset.id}/${profile?.viewId}`
      validate(expected.has(id) && !palettes.has(id), `unexpected or duplicate profile ${id}`)
      validate(
        manifest.branchCoverage?.signatures.includes(profile.coverageSignature),
        `geometry signature for ${id}`,
      )
      validate(
        Array.isArray(profile.colors) &&
          profile.colors.length === languages.length &&
          profile.colors.every(
            (color) => typeof color === 'string' && /^#[0-9a-f]{6}$/.test(color),
          ),
        `incomplete or invalid colors for ${id}`,
      )
      const { bounds } = profile
      if (bounds !== undefined) {
        validate(
          Array.isArray(bounds) &&
            bounds.length === 4 &&
            bounds.every(Number.isFinite) &&
            bounds[0] >= -180 &&
            bounds[0] <= 180 &&
            bounds[2] >= bounds[0] &&
            bounds[2] <= bounds[0] + 360 &&
            bounds[1] >= -90 &&
            bounds[3] >= bounds[1] &&
            bounds[3] <= 90,
          `invalid bounds for ${id}`,
        )
        datasetViewBounds.set(id, bounds)
      }
      palettes.set(id, {
        profile: id,
        colors: new Map(languages.map((language, i) => [language.id, profile.colors[i] as string])),
      })
    }
  }
  validate(palettes.size === expected.size, 'missing dataset palettes')
  return { datasets, datasetViewBounds, palettes }
}
