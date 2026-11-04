import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { Language } from '../src/domain/atlas.ts'
import {
  buildWordTrail,
  type EtymologyData,
  type EtymologyRepository,
  indexEtymology,
  matchAtlasLanguage,
  searchLexemes,
  type WordRelationship,
  type WordTrail,
} from '../src/domain/etymology.ts'
import {
  splitFocalLink,
  trailLineFeatures,
  trailLocations,
} from '../src/features/etymology/trailGeography.ts'
import { layoutTrail } from '../src/features/etymology/trailLayout.ts'

const data = JSON.parse(
  readFileSync(new URL('../public/etymology/word-trails.json', import.meta.url), 'utf8'),
) as EtymologyData
const repository = { data, index: indexEtymology(data) }
const options = { depth: 4, branches: false, placeholders: false, expanded: new Set<string>() }
const atlasLanguage = (id: string, iso6393: string | null): Language => ({
  id,
  iso6393,
  name: id,
  familyId: null,
  familyName: null,
  macroarea: null,
  countries: [],
  latitude: null,
  longitude: null,
  geometryVariantIds: [],
})

test('the real export preserves the wine chain and its borrowing evidence', () => {
  assert.equal(Object.keys(data.lexemes).length, 74635)
  assert.equal(data.edges.length, 46351)
  const trail = buildWordTrail(repository, '69562', options)
  const languages = trail.ids.map((id) => data.languages[data.lexemes[id]?.l ?? '']?.name)
  assert.deepEqual(languages, [
    'English',
    'Middle English',
    'Old English',
    'Proto-Germanic',
    'Latin',
  ])
  const borrowing = trail.edges.find((edge) => edge.p === '69421' && edge.c === '69470')
  assert.ok(borrowing)
  assert.equal(borrowing.t, 4)
  assert.ok(borrowing.refs.length > 0)
  assert.notDeepEqual(borrowing.refs, data.lexemes['69562']?.refs)
  assert.ok(trail.edges.every((edge) => edge.refs.every((ref) => data.sources[ref.FkSourceId])))
})

test('Glottocode takes precedence; ISO fallbacks must be unambiguous', () => {
  const english = data.languages['41500']
  assert.ok(english)
  const atlas = [atlasLanguage('stan1293', 'eng'), atlasLanguage('other123', 'eng')]
  assert.equal(matchAtlasLanguage('41500', data.languages, atlas)?.id, 'stan1293')
  // An explicit historical Glottocode never falls back to a different stage.
  assert.equal(matchAtlasLanguage('41500', data.languages, [atlas[1] as Language]), undefined)
  const withoutGlottocode = { ...english, glottocode: '' }
  const lexical = { english: withoutGlottocode }
  assert.equal(matchAtlasLanguage('english', lexical, atlas), undefined)
  assert.equal(matchAtlasLanguage('english', lexical, [atlas[0] as Language])?.id, 'stan1293')
  assert.equal(
    matchAtlasLanguage('english', { ...lexical, historical: withoutGlottocode }, [
      atlas[0] as Language,
    ]),
    undefined,
  )
  assert.equal(matchAtlasLanguage('39900', data.languages, atlas), undefined)
})

const fixture = (
  edges: readonly WordRelationship[],
  stubIds: readonly string[] = [],
): EtymologyRepository => {
  const ids = new Set(edges.flatMap((edge) => [edge.p, edge.c]))
  const sample = data.lexemes['69562']
  assert.ok(sample)
  const fixtureData = {
    ...data,
    edges,
    concepts: {},
    lexemes: Object.fromEntries(
      [...ids].map((id) => [id, { ...sample, stub: stubIds.includes(id) }]),
    ),
  }
  return { data: fixtureData, index: indexEtymology(fixtureData) }
}
const edge = (p: string, c: string): WordRelationship => ({
  id: `${p}-${c}`,
  p,
  c,
  t: 1,
  refs: [],
  note: '',
})

test('hiding a placeholder interrupts ancestry without inventing shortcut edges', () => {
  const repo = fixture([edge('a', 'stub'), edge('stub', 'root')], ['stub'])
  const hidden = buildWordTrail(repo, 'root', options)
  assert.deepEqual(hidden.ids, ['root'])
  assert.equal(hidden.hiddenPlaceholders, 1)
  assert.equal(hidden.edges.length, 0)
  assert.deepEqual(buildWordTrail(repo, 'root', { ...options, placeholders: true }).ids, [
    'root',
    'stub',
    'a',
  ])
})

test('cycles terminate, multi-parent records survive, and expansion obeys the 60-form cap', () => {
  const cyclic = fixture([edge('a', 'b'), edge('b', 'a'), edge('a', 'root'), edge('b', 'root')])
  const trail = buildWordTrail(cyclic, 'root', { ...options, depth: 100 })
  assert.equal(trail.ids.length, 3)
  assert.equal(trail.edges.length, 4)
  const layout = layoutTrail(trail)
  assert.equal(layout.cyclic, true)
  assert.equal(layout.points.size, 3)
  assert.ok(Number.isFinite(layout.width) && Number.isFinite(layout.height))
  const large = fixture(Array.from({ length: 90 }, (_, i) => edge('root', String(i))))
  const capped = buildWordTrail(large, 'root', { ...options, expanded: new Set(['root']) })
  assert.equal(capped.ids.length, 60)
  assert.ok(capped.omitted > 0)
})

test('search handles accents and keeps a language scope independent of name matching', () => {
  assert.deepEqual(
    searchLexemes(repository, 'VĪNUM', false),
    searchLexemes(repository, 'vinum', false),
  )
  assert.ok(searchLexemes(repository, 'vinum', false).some(({ id }) => id === '69421'))
  const english = searchLexemes(repository, '', false, '41500')
  assert.ok(english.length > 0)
  assert.ok(english.every(({ id }) => data.lexemes[id]?.l === '41500'))
  assert.equal(searchLexemes(repository, 'nonexistentwordzzzz', false).length, 0)
})

test('focal links split safely at the antimeridian in both directions', () => {
  assert.deepEqual(splitFocalLink([170, 10], [-170, 30]), [
    [
      [170, 10],
      [180, 20],
    ],
    [
      [-180, 20],
      [-170, 30],
    ],
  ])
  assert.deepEqual(splitFocalLink([-170, 30], [170, 10]), [
    [
      [-170, 30],
      [-180, 20],
    ],
    [
      [180, 20],
      [170, 10],
    ],
  ])
  assert.deepEqual(splitFocalLink([0, 0], [10, 10]), [
    [
      [0, 0],
      [10, 10],
    ],
  ])
})

test('map geometry retains the word trail and omits absent coordinates, including zero as valid', () => {
  const trail: WordTrail = buildWordTrail(repository, '69562', options)
  const locations = trailLocations(data, trail)
  assert.equal(locations.length, 5)
  assert.equal(trailLineFeatures(data, trail).features.length, 4)
  const changed = {
    ...data,
    languages: {
      ...data.languages,
      '41500': {
        ...(data.languages['41500'] as NonNullable<(typeof data.languages)[string]>),
        lat: 0,
        lon: 0,
      },
    },
  }
  assert.ok(trailLocations(changed, trail).some((point) => point.languageId === '41500'))
  const missing = {
    ...changed,
    languages: { ...changed.languages, '41500': { ...changed.languages['41500'], lat: null } },
  }
  assert.equal(trailLocations(missing, trail).length, 4)
  assert.equal(trailLineFeatures(missing, trail).features.length, 3)
  assert.equal(trail.ids.length, 5)
})
