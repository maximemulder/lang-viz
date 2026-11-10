import type { AtlasData, GeometryVariant, Language } from './atlas.ts'
import type { ColorConfiguration } from './colors.ts'
import type { GlobalColorProfile } from './globalColors.ts'
import type { MapEntry } from './mapEntries.ts'

/** Bump when the prepared palette recipe or interpretation changes. */
export const PREPARED_COLOR_POLICY = 'geometry64-v1'
export interface PreparedPalette {
  readonly profile: string
  readonly colors: ReadonlyMap<string, string>
}

export const sha256 = async (text: string) => {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
export const colorCatalogHash = (
  languages: readonly Language[],
  variants: readonly GeometryVariant[],
) => sha256(JSON.stringify([languages, variants]))

/** Pinned provenance selects the full dataset, independently of asset availability. */
export const selectGlobalColorProfile = (
  data: AtlasData,
  entries: readonly MapEntry[],
  config: ColorConfiguration,
): GlobalColorProfile | null => {
  if (config.strategy !== 'semantic' || config.rootIds.length || Object.keys(config.anchors).length)
    return null
  let profile: GlobalColorProfile | null = null
  for (const entry of entries)
    for (const id of entry.variantIds) {
      const variant = data.variantById.get(id)
      if (!variant) return null
      const next = `${variant.datasetId}/${variant.temporalCoverage.viewId}`
      if (profile && next !== profile.id) return null
      profile = { id: next, datasetId: variant.datasetId, viewId: variant.temporalCoverage.viewId }
    }
  return profile
}
