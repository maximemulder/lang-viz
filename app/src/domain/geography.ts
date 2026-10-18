import type {
  AtlasData,
  GeographyDatasetSelection,
  GeometryVariant,
  Language,
  TemporalViewSelection,
} from './atlas'
import { variantMatchesTemporalView } from './temporal'

export const variantMatchesGeographySelection = (
  variant: GeometryVariant,
  selection: GeographyDatasetSelection,
) => selection === 'all' || selection.includes(variant.datasetId)

export const geographyVariantsForLanguage = (
  data: AtlasData,
  language: Language,
  temporalSelection: TemporalViewSelection,
  datasetSelection: GeographyDatasetSelection,
) =>
  language.geometryVariantIds.flatMap((id) => {
    const variant = data.variantById.get(id)
    return variant &&
      variantMatchesTemporalView(variant, temporalSelection) &&
      variantMatchesGeographySelection(variant, datasetSelection)
      ? [variant]
      : []
  })
