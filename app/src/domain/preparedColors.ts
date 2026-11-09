import type { AtlasData, GeometryVariant, Language } from './atlas.ts'
import type { ColorConfiguration } from './colors.ts'
import type { MapEntry } from './mapEntries.ts'

/** Bump when the prepared palette recipe or interpretation changes. */
export const PREPARED_COLOR_POLICY = 'geometry64-v1'
export interface PreparedColorProfile {
  readonly id: string
  readonly file: string
  readonly coverageSignature: string
  readonly sha256: string
}
export interface PreparedColorsManifest {
  readonly policy: string
  readonly catalogHash: string
  readonly coverageDirectory: string
  readonly profiles: readonly PreparedColorProfile[]
}
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

/** Actual pinned geometry determines the palette, never finder filters or camera. */
export const selectPreparedColorProfile = (
  data: AtlasData,
  entries: readonly MapEntry[],
  config: ColorConfiguration,
): PreparedColorProfile | null => {
  const manifest = data.manifest.preparedColors
  if (
    !manifest ||
    manifest.policy !== PREPARED_COLOR_POLICY ||
    manifest.coverageDirectory !== data.manifest.branchCoverage?.directory ||
    config.strategy !== 'semantic' ||
    config.rootIds.length ||
    Object.keys(config.anchors).length
  )
    return null
  let profile: string | undefined
  for (const entry of entries)
    for (const id of entry.variantIds) {
      const variant = data.variantById.get(id)
      if (!variant) return null
      const next = `${variant.datasetId}/${variant.temporalCoverage.viewId}`
      if (profile && next !== profile) return null
      profile = next
    }
  return (
    manifest.profiles.find(
      (candidate) =>
        candidate.id === profile &&
        data.manifest.branchCoverage?.signatures.includes(candidate.coverageSignature),
    ) ?? null
  )
}

const catalogHashes = new WeakMap<AtlasData, Promise<string>>()
/** Validate optional assets completely before allowing them into presentation state. */
export const decodePreparedPalette = async (
  text: string,
  data: AtlasData,
  profile: PreparedColorProfile,
): Promise<PreparedPalette | null> => {
  try {
    const manifest = data.manifest.preparedColors
    if (
      !manifest ||
      manifest.policy !== PREPARED_COLOR_POLICY ||
      manifest.coverageDirectory !== data.manifest.branchCoverage?.directory ||
      !data.manifest.branchCoverage?.signatures.includes(profile.coverageSignature) ||
      (await sha256(text)) !== profile.sha256
    )
      return null
    let hash = catalogHashes.get(data)
    if (!hash) {
      hash = colorCatalogHash(data.languages, data.variants)
      catalogHashes.set(data, hash)
    }
    if ((await hash) !== manifest.catalogHash) return null
    const asset = JSON.parse(text)
    if (
      asset.policy !== PREPARED_COLOR_POLICY ||
      asset.profile !== profile.id ||
      asset.catalogHash !== manifest.catalogHash ||
      !asset.colors ||
      Array.isArray(asset.colors) ||
      typeof asset.colors !== 'object' ||
      Object.keys(asset.colors).length !== data.languages.length
    )
      return null
    const colors = new Map<string, string>()
    for (const { id } of data.languages) {
      const color: unknown = asset.colors[id]
      if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/.test(color)) return null
      colors.set(id, color)
    }
    return { profile: profile.id, colors }
  } catch {
    return null
  }
}
