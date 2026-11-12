import type { WalsData } from '../../src/domain/wals.ts'
import { catalogLanguage, walsCatalog, walsData } from './wals.ts'

/** Synthetic UI cases, never a substitute for the separate published-data check. */
export const profileWalsData = (): WalsData => {
  const original = walsData()
  const feature = original.features['12A']
  const observation = original.observations['12A-ird']
  const svo = original.categories['81A-1']
  const empty = original.records.empty
  const grammar = original.references.Grammar
  if (!feature || !observation || !svo || !empty || !grammar) throw new Error('Missing fixture')
  return {
    ...original,
    features: {
      ...original.features,
      ...Object.fromEntries(
        ['13A', '30A', '87A', '92A'].map((id) => [
          id,
          {
            ...feature,
            name: id,
            chapterId: id.slice(0, -1),
          },
        ]),
      ),
    },
    categories: {
      ...original.categories,
      '81A-1': { ...svo, name: 'SVO' },
      ...Object.fromEntries(
        ['13A', '30A', '87A', '92A'].map((id) => [
          `${id}-1`,
          {
            featureId: id,
            number: 1,
            name: `Recorded ${id}`,
            description: '',
          },
        ]),
      ),
    },
    observations: {
      ...original.observations,
      '12A-ird': { ...observation, references: [] },
      ...Object.fromEntries(
        ['13A', '30A', '37A', '87A', '92A'].map((id) => [
          `${id}-iri`,
          {
            ...observation,
            sourceId: 'iri',
            featureId: id,
            categoryId: `${id}-1`,
            exampleIds: [],
          },
        ]),
      ),
    },
    records: {
      ...original.records,
      empty: { ...empty, glottocode: 'empt1234' },
    },
    references: {
      ...original.references,
      Grammar: {
        ...grammar,
        fields: { author: 'Test author', title: '<img src=x onerror="window.walsUnsafe=true">' },
      },
    },
  }
}

export const profileWalsCatalog = () => [
  ...walsCatalog(),
  catalogLanguage('empt1234'),
  catalogLanguage('no-record'),
]
