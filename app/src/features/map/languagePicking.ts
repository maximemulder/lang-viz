import type { PointLike } from 'maplibre-gl'
import type { AtlasData } from '../../domain/atlas.ts'
import type { Refinements } from '../../domain/refinement.ts'
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
    readonly isolatedId: string | null
  },
): string[] => {
  const { data, areas, refinements, memberships, matching, isolatedId } = context
  const languageId = (id: string) =>
    areas.find((area) => area.id === id)?.languageId ?? data.variantById.get(id)?.languageId
  const permitted = (id: string) => !isolatedId || languageId(id) === isolatedId
  if (matching && map.getLayer('wals-language-areas')) {
    const hits = map
      .queryRenderedFeatures(point, { layers: ['wals-language-areas'] })
      .flatMap((feature) =>
        typeof feature.properties.variant_id === 'string' ? [feature.properties.variant_id] : [],
      )
      .filter(permitted)
    if (hits.length) return [...new Set(hits)]
  }
  const visible = visibleVariantIds(map, point, refinements, memberships).filter(permitted)
  if (visible.length) return visible
  if (!map.getLayer('language-area-hit-targets')) return []
  const seen = new Set<string>()
  return map
    .queryRenderedFeatures(point, { layers: ['language-area-hit-targets'] })
    .flatMap((feature) => {
      const id = feature.properties.variant_id
      if (typeof id !== 'string' || !permitted(id)) return []
      const language = data.languageById.get(languageId(id) ?? '')
      if (!language || !['language', 'dialect'].includes(language.level) || seen.has(language.id))
        return []
      seen.add(language.id)
      return [id]
    })
    .slice(0, 6)
}
