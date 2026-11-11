import type { EtymologyData, Lexeme } from '../../src/domain/etymology.ts'
import { indexEtymology } from '../../src/domain/etymology.ts'

/** Synthetic records, not claims about the real wine history. */
export const explorerRepository = () => {
  const word = (l: string, f: string): Lexeme => ({
    l,
    f,
    m: f,
    note: '',
    meaningNote: '',
    grammar: '',
    ipa: '',
    script: '',
    refs: [],
    stub: false,
  })
  const data: EtymologyData = {
    schemaVersion: 1,
    languages: {
      '41500': {
        name: 'English',
        iso: 'eng',
        glottocode: 'stan1293',
        lat: 0,
        lon: 0,
        status: 'Attested',
        time: {},
        path: ['Family', 'English'],
        family: 'Family',
      },
      '2': {
        name: 'Latin',
        iso: 'lat',
        glottocode: 'lati1261',
        lat: 10,
        lon: 10,
        status: 'Attested',
        time: {},
        path: ['Family', 'Latin'],
        family: 'Family',
      },
    },
    lexemes: {
      '69562': word('41500', 'wine'),
      '69421': word('2', 'vinum'),
      '38213': word('41500', 'water'),
      '69470': word('41500', 'other'),
    },
    edges: [
      { id: '1', p: '69421', c: '69562', t: 4, refs: [], note: '' },
      { id: '2', p: '69421', c: '69470', t: 1, refs: [], note: '' },
    ],
    concepts: {
      '3090': {
        id: '3090',
        name: 'wine',
        groups: [{ list: '3', category: 'Special' }],
        lexemes: ['69562'],
      },
      '1001': {
        id: '1001',
        name: 'all',
        groups: [{ list: '1', category: 'Swadesh' }],
        lexemes: ['38213'],
      },
    },
    lists: [
      { id: '1', name: 'Swadesh' },
      { id: '3', name: 'Special' },
    ],
    types: { '1': 'Inherited', '4': 'Certainly borrowed' },
    sources: {},
    meta: {},
    diagnostics: [],
    provenance: {
      adapterVersion: 1,
      snapshot: null,
      placeholderSourceId: 999,
      attribution: '',
      inputs: [],
    },
  }
  return { data, index: indexEtymology(data) }
}
