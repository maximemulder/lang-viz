import assert from 'node:assert/strict'
import test from 'node:test'
import type { AtlasData, GeometryVariant } from '../src/domain/atlas.ts'
import { DEFAULT_COLOR_CONFIGURATION as config } from '../src/domain/colors.ts'
import type { MapEntry } from '../src/domain/mapEntries.ts'
import {
  colorCatalogHash,
  decodePreparedPalette,
  PREPARED_COLOR_POLICY,
  selectPreparedColorProfile,
  sha256,
} from '../src/domain/preparedColors.ts'

const variant = (id: string, datasetId = 'a', viewId = 'contemporary') =>
  ({ id, datasetId, temporalCoverage: { viewId } }) as GeometryVariant
const variants = [variant('a'), variant('b', 'b'), variant('historic', 'a', 'time-of-contact')]
const fixture = async () => {
  const data = {
    languages: [{ id: 'root' }, { id: 'leaf' }],
    variants,
    variantById: new Map(variants.map((v) => [v.id, v])),
    manifest: { branchCoverage: { directory: 'coverage/current/', signatures: ['signature'] } },
  } as unknown as AtlasData
  const hash = await colorCatalogHash(data.languages, data.variants)
  const asset = {
    policy: PREPARED_COLOR_POLICY,
    profile: 'a/contemporary',
    catalogHash: hash,
    colors: { root: '#123456', leaf: '#abcdef' },
  }
  const text = JSON.stringify(asset)
  const profile = {
    id: asset.profile,
    file: 'colors.json',
    sha256: await sha256(text),
    coverageSignature: 'signature',
  }
  const complete = {
    ...data,
    manifest: {
      ...data.manifest,
      preparedColors: {
        policy: PREPARED_COLOR_POLICY,
        catalogHash: hash,
        coverageDirectory: 'coverage/current/',
        profiles: [profile],
      },
    },
  }
  return { data: complete, profile, asset, text }
}
const entries = (...ids: string[]) =>
  ids.map(
    (id) =>
      ({ variantIds: [id], context: { sources: ['unrelated-filter'], period: 'all' } }) as MapEntry,
  )

test('prepared palettes follow pinned provenance and reject incompatible comparisons', async () => {
  const { data, profile } = await fixture()
  assert.equal(selectPreparedColorProfile(data, entries('a'), config), profile)
  assert.equal(
    selectPreparedColorProfile(data, entries('a', 'a'), {
      ...config,
      overrides: { leaf: '#ff0000' },
    }),
    profile,
  )
  for (const list of [[], entries('a', 'b'), entries('a', 'historic'), entries('unknown')])
    assert.equal(selectPreparedColorProfile(data, list, config), null)
  for (const configuration of [
    { ...config, strategy: 'categorical' as const },
    { ...config, rootIds: ['root'] },
    { ...config, anchors: { root: '#123456' } },
  ])
    assert.equal(selectPreparedColorProfile(data, entries('a'), configuration), null)
  const changed = {
    ...data,
    manifest: {
      ...data.manifest,
      branchCoverage: { directory: 'coverage/new/', maxZoom: 3, signatures: ['signature'] },
    },
  }
  assert.equal(selectPreparedColorProfile(changed, entries('a'), config), null)
})

test('prepared loader rejects stale catalogs, policy, membership and corrupt/incomplete colors', async () => {
  const { data, profile, asset, text } = await fixture()
  const decoded = await decodePreparedPalette(text, data, profile)
  assert.ok(decoded)
  assert.ok(data.languages[1])
  assert.ok(data.manifest.preparedColors)
  assert.deepEqual(
    [...decoded.colors],
    [
      ['root', '#123456'],
      ['leaf', '#abcdef'],
    ],
  )
  assert.equal(await decodePreparedPalette(`${text} `, data, profile), null, 'integrity mismatch')
  for (const changed of [
    { ...asset, profile: 'b/contemporary' },
    { ...asset, policy: 'obsolete' },
    { ...asset, colors: { root: '#123456' } },
    { ...asset, colors: { root: '#123456', leaf: 'red' } },
    { ...asset, colors: { root: '#123456', unknown: '#abcdef' } },
    null,
  ]) {
    const bytes = JSON.stringify(changed)
    assert.equal(
      await decodePreparedPalette(bytes, data, { ...profile, sha256: await sha256(bytes) }),
      null,
    )
  }
  const stale = {
    ...data,
    languages: [...data.languages, { ...data.languages[1], name: 'changed' }],
  }
  assert.equal(await decodePreparedPalette(text, stale, profile), null)
  const changedPolicy = {
    ...data,
    manifest: {
      ...data.manifest,
      preparedColors: { ...data.manifest.preparedColors, policy: 'future' },
    },
  }
  assert.equal(await decodePreparedPalette(text, changedPolicy, profile), null)
  assert.equal(
    await decodePreparedPalette(text, data, { ...profile, coverageSignature: 'obsolete' }),
    null,
  )
})
