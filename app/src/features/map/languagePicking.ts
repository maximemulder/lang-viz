import type { PointLike } from 'maplibre-gl'
import type { AtlasData } from '../../domain/atlas.ts'
import type { Refinements } from '../../domain/refinement.ts'
import type { MapIsolation } from '../../state/mapInteraction.ts'
import { visibleVariantIds } from './inspection.ts'

export const pickLanguageVariants = (
  map: Parameters<typeof visibleVariantIds>[0],
  point: PointLike,
  context: {
    readonly data: Pick<AtlasData, 'languageById' | 'variantById'>
    readonly areas: readonly { readonly id: string; readonly languageId: string }[]
    readonly refinements: Refinements
    readonly memberships: Readonly<Record<string, readonly string[]>>
    readonly matching: boolean
    readonly isolation?: MapIsolation | null
  },
): string[] => {
  const { data, areas, refinements, memberships, matching } = context
  const languageId = (id: string) =>
    areas.find((area) => area.id === id)?.languageId ?? data.variantById.get(id)?.languageId
  if (context.isolation?.kind === 'language') {
    if (!map.getLayer('isolated-language-fill')) return []
    return [
      ...new Set(
        map
          .queryRenderedFeatures(point, { layers: ['isolated-language-fill'] })
          .flatMap((feature) =>
            typeof feature.properties.variant_id === 'string'
              ? [feature.properties.variant_id]
              : [],
          ),
      ),
    ]
  }
  if (matching && map.getLayer('wals-language-areas')) {
    const hits = map
      .queryRenderedFeatures(point, { layers: ['wals-language-areas'] })
      .flatMap((feature) =>
        typeof feature.properties.variant_id === 'string' ? [feature.properties.variant_id] : [],
      )
    if (hits.length) return [...new Set(hits)]
  }
  const visible = visibleVariantIds(map, point, refinements, memberships)
  if (visible.length) return visible
  if (!map.getLayer('language-area-hit-targets')) return []
  const seen = new Set<string>()
  return map
    .queryRenderedFeatures(point, { layers: ['language-area-hit-targets'] })
    .flatMap((feature) => {
      const id = feature.properties.variant_id
      if (typeof id !== 'string') return []
      const language = data.languageById.get(languageId(id) ?? '')
      if (!language || !['language', 'dialect'].includes(language.level) || seen.has(language.id))
        return []
      seen.add(language.id)
      return [id]
    })
    .slice(0, 6)
}

/** Prefer the specific language at the pointer over a broader family face.
 * Stable ordering keeps the first hover entry and the click target consistent. */
export function orderLanguageHits(
  ids: readonly string[],
  data: Pick<AtlasData, 'languageById' | 'variantById'>,
  areas: readonly { id: string; languageId: string }[],
) {
  const rank = (id: string) => {
    const languageId =
      areas.find((area) => area.id === id)?.languageId ?? data.variantById.get(id)?.languageId
    const level = data.languageById.get(languageId ?? '')?.level
    return level === 'dialect' ? 0 : level === 'language' ? 1 : 2
  }
  return [...ids].sort((a, b) => rank(a) - rank(b))
}
