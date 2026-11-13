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
  const observed = repository.index.bySource.get(sourceId)
  const shared = regionalWalsFeatures(repository).get(record.macroarea)
  const available = ['81A', shared, ...EXTRA_PRIORITY].filter((id): id is string =>
    Boolean(id && observed?.has(id)),
  )
  const cards = [...new Set(available)].slice(0, 3)
  // An explicit inspection replaces the final slot, never creates a fourth card.
  if (inspectedFeature && observed?.has(inspectedFeature) && !cards.includes(inspectedFeature)) {
    if (cards.length === 3) cards[2] = inspectedFeature
    else cards.push(inspectedFeature)
  }
  return cards
}

export const WALS_DEFINITIONS: Readonly<Record<string, string>> = {
  '81A':
    'The usual order of who does something, the action, and what is acted on. English commonly says “Sam eats rice”. Some languages allow several common orders.',
  '13A':
    'In some languages, saying the same syllable at a different pitch can change its word or grammatical meaning. This is different from sounding excited or asking a question.',
  '12A':
    'A syllable is a beat in a word. This feature describes how consonants and vowels can be grouped in one beat, not how difficult the language is to learn.',
  '30A':
    'Some languages place nouns into grammar groups and change nearby words to match. These groups are often called “gender”, but they do not necessarily describe male or female people.',
  '87A':
    'Whether words like “red” generally come before or after the thing they describe: “red house” or “house red”. These examples rearrange English words.',
  '37A':
    'How a language marks a particular person or thing that the listener can identify. English often uses “the”; other languages use different strategies.',
  '92A':
    'Some languages use a small extra word when asking a question answered by yes or no. This feature records where it goes, or that there is no dedicated question word of this kind.',
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

export const WALS_TITLES: Readonly<Record<string, string>> = {
  '81A': 'Sentence order',
  '13A': 'Voice pitch',
  '12A': 'Syllables',
  '30A': 'Noun groups',
  '87A': 'Describing words',
  '37A': 'Words like “the”',
  '92A': 'Yes/no questions',
}
export const readableWalsValue = (featureId: string, value: string) => {
  const labels: Readonly<Record<string, Readonly<Record<string, string>>>> = {
    '81A': { 'No dominant order': 'No single usual order' },
    '87A': {
      'Adjective-Noun': 'Describing word before the noun',
      'Noun-Adjective': 'Describing word after the noun',
    },
    '13A': {
      'No tones': 'Pitch does not distinguish words',
      'Simple tone system': 'Uses pitch to distinguish words',
      'Complex tone system': 'Uses several pitch patterns',
    },
    '12A': {
      Simple: 'Simple syllable shapes',
      'Moderately complex': 'Moderately complex syllable shapes',
      Complex: 'Complex syllable shapes',
    },
    '30A': {
      None: 'No grammatical noun groups',
      Two: 'Two grammatical noun groups',
      Three: 'Three grammatical noun groups',
      Four: 'Four grammatical noun groups',
      'Five or more': 'Five or more grammatical noun groups',
    },
    '37A': {
      'Definite word distinct from demonstrative': 'Uses a separate word like “the”',
      'Demonstrative word used as definite article': 'Uses a word like “this” or “that”',
      'Definite affix': 'Adds a marker to the word',
      'No definite, but indefinite article': 'Marks “a”, but not “the”',
      'No definite or indefinite article': 'No article markers like “a” or “the”',
    },
    '92A': {
      Initial: 'At the start of a question',
      Final: 'At the end of a question',
      'Second position': 'After the first word or phrase',
      'Other position': 'Elsewhere in the question',
      'In either of two positions': 'Two possible positions',
      'No question particle': 'No dedicated yes/no question word',
    },
  }
  return labels[featureId]?.[value] ?? value
}
