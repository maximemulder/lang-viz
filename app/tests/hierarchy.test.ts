import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Language } from '../src/domain/atlas.ts'
import {
  buildLanguageHierarchy,
  flattenLanguageHierarchy,
  languageAncestors,
} from '../src/domain/hierarchy.ts'

const entry = (id: string, parentId: string | null, level: Language['level']): Language => ({
  id,
  classification: { kind: 'glottolog', glottocode: id },
  parentId,
  level,
  name: id,
  parentLanguageId: null,
  familyId: null,
  familyName: null,
  alternativeNames: [],
  iso6393: null,
  macroarea: null,
  countries: [],
  latitude: null,
  longitude: null,
  geometryVariantIds: [],
})
const family = entry('family', null, 'family')
const group = entry('group', 'family', 'family')
const language = entry('language', 'group', 'language')
const dialect = entry('dialect', 'language', 'dialect')
const variety = entry('variety', 'dialect', 'dialect')
const isolate = entry('isolate', null, 'language')
const entries = [family, group, language, dialect, variety, isolate]
const hierarchy = buildLanguageHierarchy(entries)

test('browse roots include families and isolates; immediate children retain intermediate groups', () => {
  assert.deepEqual(
    hierarchy.roots.map(({ id }) => id),
    ['family', 'isolate'],
  )
  assert.deepEqual(hierarchy.childrenById.get('family'), [group])
  assert.deepEqual(hierarchy.childrenById.get('dialect'), [variety])
  assert.deepEqual(languageAncestors(hierarchy, variety), [family, group, language, dialect])
})

test('only unfolded branches appear; unmapped entries can expose their children', () => {
  const expanded = new Set(['family', 'family/group', 'family/group/language'])
  const rows = flattenLanguageHierarchy(hierarchy, hierarchy.roots, expanded)
  assert.deepEqual(
    rows.map(({ language, depth }) => [language.id, depth]),
    [
      ['family', 0],
      ['group', 1],
      ['language', 2],
      ['dialect', 3],
      ['isolate', 0],
    ],
  )
  assert.equal(rows[3]?.parentKey, 'family/group/language')
  expanded.delete('family')
  assert.deepEqual(
    flattenLanguageHierarchy(hierarchy, hierarchy.roots, expanded).map(
      ({ language }) => language.id,
    ),
    ['family', 'isolate'],
  )
})

test('any level can start a search subtree and expansion includes nonmatching descendants', () => {
  const rows = flattenLanguageHierarchy(hierarchy, [dialect], new Set(['dialect']))
  assert.deepEqual(
    rows.map(({ language, depth }) => [language.id, depth]),
    [
      ['dialect', 0],
      ['variety', 1],
    ],
  )
  assert.equal(rows[0]?.childCount, 1)
})

test('matching descendants remain discoverable independently of matching ancestors', () => {
  const rows = flattenLanguageHierarchy(hierarchy, [language, dialect], new Set(['language']))
  assert.deepEqual(
    rows.map(({ key }) => key),
    ['language', 'language/dialect', 'dialect'],
  )
  assert.equal(new Set(rows.map(({ key }) => key)).size, rows.length)
  assert.equal(rows[2]?.position, 2)
  assert.equal(rows[2]?.siblingCount, 2)
})

test('ancestry and expansion defensively terminate if given malformed cyclic data', () => {
  const first = entry('a', 'b', 'family')
  const cyclic = [first, entry('b', 'a', 'family')]
  const invalid = buildLanguageHierarchy(cyclic)
  assert.equal(languageAncestors(invalid, first).length, 1)
  assert.equal(flattenLanguageHierarchy(invalid, [first], new Set(['a', 'a/b', 'a/b/a'])).length, 2)
})
