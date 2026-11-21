import type {
  AtlasData,
  GeometryVariant,
  Language,
  TemporalQuality,
  TemporalViewSelection,
} from './atlas'

export const variantMatchesTemporalView = (
  variant: GeometryVariant,
  selection: TemporalViewSelection,
) => selection === 'all' || variant.temporalCoverage.viewId === selection

export const temporalVariantsForLanguage = (
  data: AtlasData,
  language: Language,
  selection: TemporalViewSelection,
) =>
  language.geometryVariantIds.flatMap((id) => {
    const variant = data.variantById.get(id)
    return variant && variantMatchesTemporalView(variant, selection) ? [variant] : []
  })

export const temporalQualityLabel = (quality: TemporalQuality) => {
  switch (quality) {
    case 'direct':
      return 'historical area'
    case 'approximate':
      return 'approximate period'
    case 'proxy':
      return 'contemporary proxy'
    case 'mixed':
      return 'mixed periods'
  }
}
