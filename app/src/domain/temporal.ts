import type {
  AtlasData,
  GeometryVariant,
  Language,
  TemporalQuality,
  TemporalViewSelection,
} from './atlas'

export const TEMPORAL_VIEWS = [
  {
    id: 'all',
    label: 'All source periods',
    shortLabel: 'All periods',
    description: 'Choose among every available source and period for each language.',
  },
  {
    id: 'contemporary',
    label: 'Contemporary · Asher',
    shortLabel: 'Contemporary',
    description: 'Approximate contemporary speaker areas in the 2007 atlas.',
  },
  {
    id: 'time-of-contact',
    label: 'Time of contact · Asher',
    shortLabel: 'Time of contact',
    description:
      'Historical areas where available; contemporary proxies elsewhere, especially outside the Americas and Australia.',
  },
  {
    id: 'year-1750',
    label: 'Approximately 1750 · DiACL',
    shortLabel: 'Approximately 1750',
    description: 'A focal-year snapshot: every source polygon has a timeframe containing 1750.',
  },
  {
    id: 'mixed-periods',
    label: 'Modern + ancient · Bouckaert',
    shortLabel: 'Modern + ancient',
    description:
      'A source view mixing modern and ancient Indo-European areas; it is not one historical year.',
  },
] as const satisfies readonly {
  readonly id: TemporalViewSelection
  readonly label: string
  readonly shortLabel: string
  readonly description: string
}[]

export const isTemporalViewSelection = (value: string): value is TemporalViewSelection =>
  TEMPORAL_VIEWS.some((view) => view.id === value)

export const temporalView = (selection: TemporalViewSelection) =>
  TEMPORAL_VIEWS.find((view) => view.id === selection) ?? TEMPORAL_VIEWS[0]

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
