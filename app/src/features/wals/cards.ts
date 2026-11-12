import type { WalsRepository } from '../../domain/wals.ts'

// Editorial order, also used to break equal regional coverage counts.
export const WALS_SHORTLIST = ['81A', '13A', '12A', '30A', '87A', '37A', '92A'] as const
const EXTRA_PRIORITY = ['13A', '30A', '12A', '37A', '92A', '87A'] as const
const regionalCache = new WeakMap<WalsRepository, ReadonlyMap<string, string>>()

/** Count source varieties once each, including unmatched and unobserved records. */
export const regionalWalsFeatures = (repository: WalsRepository) => {
  const cached = regionalCache.get(repository)
  if (cached) return cached
  const coverage = new Map<string, Map<string, number>>()
  for (const [sourceId, record] of Object.entries(repository.data.records)) {
    let counts = coverage.get(record.macroarea)
    if (!counts) {
      counts = new Map()
      coverage.set(record.macroarea, counts)
    }
    for (const id of WALS_SHORTLIST.slice(1)) {
      if (repository.index.bySource.get(sourceId)?.has(id))
        counts.set(id, (counts.get(id) ?? 0) + 1)
    }
  }
  const result = new Map<string, string>()
  for (const [region, counts] of coverage) {
    const ranked = WALS_SHORTLIST.slice(1).filter((id) => repository.data.features[id])
    ranked.sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))
    // Even a zero-coverage region keeps an explicit comparison slot.
    if (ranked[0]) result.set(region, ranked[0])
  }
  regionalCache.set(repository, result)
  return result
}

export const walsCardFeatures = (
  repository: WalsRepository,
  sourceId: string,
  inspectedFeature: string | null = null,
) => {
  const record = repository.data.records[sourceId]
  if (!record) return []
  const shared = ['81A', regionalWalsFeatures(repository).get(record.macroarea)].filter(
    (id): id is string => Boolean(id && repository.data.features[id]),
  )
  const observed = repository.index.bySource.get(sourceId)
  const extra = EXTRA_PRIORITY.find((id) => !shared.includes(id) && observed?.has(id))
  const cards = [...shared, ...(extra ? [extra] : [])]
  if (inspectedFeature && observed?.has(inspectedFeature) && !cards.includes(inspectedFeature))
    cards.push(inspectedFeature)
  return cards
}

export const WALS_DEFINITIONS: Readonly<Record<string, string>> = {
  '81A':
    'The dominant order of subject (S), object (O) and verb (V) in clauses with a subject and an object. This is not a rule for every sentence.',
  '13A':
    'Whether pitch differences help distinguish words or grammatical forms. This differs from using intonation to express emotion or ask a question.',
  '12A':
    'How syllables are built, including the consonant clusters they allow. See the chapter for the criteria behind simple, moderately complex and complex structures.',
  '30A':
    'The number of grammatical gender classes, identified through agreement with nouns. These classes need not describe biological gender.',
  '87A':
    'The order of an attributive adjective and the noun it describes, as in the English words “red house”. Some languages allow both orders or have no dominant order.',
  '37A':
    'How a language marks an identifiable referent, including separate definite articles, affixes and other strategies. English “the” is one example.',
  '92A':
    'Where particles marking yes/no questions occur. The categories also distinguish other positions and languages without a polar question particle.',
}

/** Reordered English words only; no example for non-dominant/unknown categories. */
const WORD_ORDER_ILLUSTRATIONS: Readonly<Record<string, string>> = {
  SVO: 'Sam eats rice',
  SOV: 'Sam rice eats',
  VSO: 'Eats Sam rice',
  VOS: 'Eats rice Sam',
  OVS: 'Rice eats Sam',
  OSV: 'Rice Sam eats',
}
export const walsWordOrderIllustration = (category: string): string | null =>
  Object.hasOwn(WORD_ORDER_ILLUSTRATIONS, category)
    ? (WORD_ORDER_ILLUSTRATIONS[category] ?? null)
    : null
