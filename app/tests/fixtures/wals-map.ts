import type { WalsData } from '../../src/domain/wals.ts'
import { validateWalsData } from '../../src/domain/walsValidation.ts'
import { walsData } from './wals.ts'

/** Synthetic coordinates/categories, served only by the map browser test's proxy. */
export const mapWalsData = (): WalsData => {
  const base = walsData()
  const record = base.records.iri
  const observation = base.observations['12A-ird']
  const category = base.categories['12A-1']
  if (!record || !observation || !category) throw new Error('Missing fixture')
  const records = {
    ...base.records,
    eng: {
      ...record,
      name: 'English (coordinate fixture)',
      glottocode: 'stan1293',
      iso6393: 'eng',
      coordinates: [-0.1, 51.5] as const,
    },
    ird: { ...record, name: 'Irish (Donegal)', coordinates: [-8, 55] as const },
    colocated: { ...record, name: 'Colocated Irish variety', coordinates: [-8, 55] as const },
    broad: {
      ...record,
      name: 'Broader-scope fixture',
      glottocode: 'indo1319',
      coordinates: [20, 10] as const,
    },
    orphan: {
      ...record,
      name: 'Unmatched fixture',
      glottocode: 'gone1234',
      coordinates: [35, 20] as const,
    },
    unlocated: { ...record, name: 'Unlocated fixture', glottocode: 'iris1253', coordinates: null },
    east: {
      ...record,
      name: 'East dateline fixture',
      glottocode: 'stan1293',
      coordinates: [170, 10] as const,
    },
    west: {
      ...record,
      name: 'West dateline fixture',
      glottocode: 'west1234',
      coordinates: [-170, 20] as const,
    },
  }
  const observations = {
    ...base.observations,
    ...Object.fromEntries(
      ['eng', 'colocated', 'unlocated'].map((sourceId) => [
        `12A-${sourceId}`,
        { ...observation, sourceId, exampleIds: [] },
      ]),
    ),
    '37A-eng': {
      ...observation,
      sourceId: 'eng',
      featureId: '37A',
      categoryId: '37A-2',
      exampleIds: [],
    },
    ...Object.fromEntries(
      ['east', 'west'].map((sourceId) => [
        `12A-${sourceId}`,
        { ...observation, sourceId, categoryId: '12A-2', exampleIds: [] },
      ]),
    ),
    '81A-unlocated': {
      ...observation,
      sourceId: 'unlocated',
      featureId: '81A',
      categoryId: '81A-1',
      exampleIds: [],
    },
  }
  const data: WalsData = {
    ...base,
    records,
    observations,
    categories: {
      ...base.categories,
      '12A-2': { ...category, number: 2, name: 'Dateline fixture' },
      '37A-2': { featureId: '37A', number: 2, name: 'Only origin fixture', description: '' },
    },
    diagnostics: {
      ...base.diagnostics,
      missingCoordinates: [{ sourceId: 'unlocated', reason: 'missing' }],
    },
  }
  validateWalsData(data)
  return data
}
