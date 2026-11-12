import type { Language } from '../../src/domain/atlas.ts'
import { indexWals, type WalsData, type WalsRecord } from '../../src/domain/wals.ts'
import { validateWalsData } from '../../src/domain/walsValidation.ts'

/** Small synthetic evidence; names identify the navigation regressions, not linguistic claims. */
export const walsData = (): WalsData => {
  const record = (name: string, glottocode: string | null, iso6393: string | null): WalsRecord => ({
    name,
    glottocode,
    iso6393,
    isoCodes: iso6393 ? [iso6393] : [],
    coordinates: [0, 0],
    macroarea: 'Test',
    family: 'Test family',
    subfamily: '',
    genus: 'Test genus',
    references: [{ sourceId: 'Grammar', pages: '4–9' }],
    url: 'https://wals.info/languoid/lect/test',
  })
  const features = Object.fromEntries(
    ['12A', '37A', '81A'].map((id) => [
      id,
      {
        name: id,
        description: '',
        chapterId: id.slice(0, -1),
        chapterTitle: id,
        chapterCitation: 'Test citation',
        contributors: 'Test author',
        area: 'Test',
        references: [],
        url: `https://wals.info/feature/${id}`,
        chapterUrl: `https://wals.info/chapter/${id.slice(0, -1)}`,
      },
    ]),
  )
  const categories = Object.fromEntries(
    Object.keys(features).map((id) => [
      `${id}-1`,
      { featureId: id, number: 1, name: 'Test value', description: '' },
    ]),
  )
  const observations = Object.fromEntries(
    [
      ['iri', '81A'],
      ['ird', '12A'],
      ['nuu', '81A'],
      ['kyq', '37A'],
      ['ale', '81A'],
      ['aea', '12A'],
      ['broad', '12A'],
      ['orphan', '12A'],
    ].map(([sourceId, featureId]) => [
      `${featureId}-${sourceId}`,
      {
        sourceId: String(sourceId),
        featureId: String(featureId),
        categoryId: `${featureId}-1`,
        references: [{ sourceId: 'Grammar', pages: '4–9' }],
        comment: 'Qualification',
        exampleIds: ['ex'],
        url: `https://wals.info/valuesets/${featureId}-${sourceId}`,
      },
    ]),
  )
  return {
    schemaVersion: 1,
    adapterVersion: 1,
    provenance: {
      snapshot: null,
      commit: null,
      sourceUrl: null,
      citation: 'Synthetic',
      license: 'https://creativecommons.org/licenses/by/4.0/',
      files: { 'test.csv': { bytes: 0, sha256: '0'.repeat(64) } },
    },
    sourceNotices: {
      notice: 'Fixture',
      errata: 'Keep qualifications',
      errataPolicy: 'Retain published values',
    },
    records: {
      iri: record('Irish', 'iris1253', 'gle'),
      ird: record('Irish (Donegal)', 'iris1253', 'gle'),
      nuu: record('Nuuchahnulth', 'nuuc1236', 'nuk'),
      kyq: record('Kyuquot', 'nuuc1236', 'nuk'),
      ale: record('Aleut', 'aleu1260', 'ale'),
      aea: record('Eastern Aleut', 'aleu1260', 'ale'),
      broad: record('Recorded variety', 'broa1234', null),
      orphan: { ...record('Unmatched', 'gone1234', 'xxx'), coordinates: null },
      empty: record('Without observations', null, null),
    },
    features,
    categories,
    observations,
    references: {
      Grammar: {
        type: 'book',
        fields: { author: 'Test author', title: 'Test grammar' },
        url: 'https://wals.info/refdb/record/Grammar',
      },
    },
    examples: {
      ex: {
        sourceId: 'ird',
        text: 'Example',
        analyzed: '',
        gloss: '',
        translation: 'Example',
        comment: '',
        url: 'https://wals.info/example/ex',
      },
    },
    diagnostics: {
      counts: {},
      observationsByFeature: {},
      missingCoordinates: [{ sourceId: 'orphan', reason: 'missing' }],
      referencesWithoutTitle: [],
      checks: [],
    },
  }
}
export const walsRepository = () => {
  const data = walsData()
  validateWalsData(data)
  return indexWals(data)
}
export const catalogLanguage = (id: string, patch: Partial<Language> = {}): Language => ({
  id,
  classification: { kind: 'glottolog', glottocode: id },
  name: id,
  level: 'language',
  parentId: null,
  parentLanguageId: null,
  alternativeNames: [],
  iso6393: null,
  familyId: null,
  familyName: null,
  macroarea: null,
  countries: [],
  latitude: null,
  longitude: null,
  geometryVariantIds: [],
  ...patch,
})
export const walsCatalog = (): Language[] => [
  catalogLanguage('atlas:irish', {
    classification: { kind: 'glottolog', glottocode: 'iris1253' },
    iso6393: 'gle',
  }),
  catalogLanguage('nuuc1236', { iso6393: 'nuk' }),
  catalogLanguage('aleu1260', { iso6393: 'ale' }),
  catalogLanguage('broa1234', { level: 'family' }),
  catalogLanguage('child', { parentId: 'broa1234' }),
  // An ID resembling a Glottocode is still an opaque ID, not classification evidence.
  catalogLanguage('gone1234', {
    classification: { kind: 'source', datasetId: 'test', label: 'Source', note: '' },
    iso6393: 'xxx',
  }),
]
