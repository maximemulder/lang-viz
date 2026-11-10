import assert from 'node:assert/strict'
import test from 'node:test'
import type { AtlasData, GeometryVariant } from '../src/domain/atlas.ts'
import { DEFAULT_COLOR_CONFIGURATION as config } from '../src/domain/colors.ts'
import { type DatasetMetadata, decodeDatasetMetadata } from '../src/domain/datasetMetadata.ts'
import type { MapEntry } from '../src/domain/mapEntries.ts'
import {
  colorCatalogHash,
  PREPARED_COLOR_POLICY,
  selectGlobalColorProfile,
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
  const profile = (viewId: 'contemporary' | 'time-of-contact') => ({
    viewId,
    coverageSignature: 'signature',
    colors: ['#123456', '#abcdef'],
  })
  const metadata: DatasetMetadata = {
    colorPolicy: PREPARED_COLOR_POLICY,
    catalogHash: await colorCatalogHash(data.languages, variants),
    coverageDirectory: 'coverage/current/',
    datasets: ['a', 'b'].map((id) => ({
      id,
      name: id,
      shortName: id,
      citation: '',
      license: '',
      profiles:
        id === 'a'
          ? [profile('contemporary'), profile('time-of-contact')]
          : [profile('contemporary')],
    })),
  }
  return { data, metadata }
}
const entries = (...ids: string[]) =>
  ids.map(
    (id) =>
      ({
        variantIds: [id],
        context: { sources: ['unrelated-filter'], period: 'all' },
      }) as MapEntry,
  )

test('dataset metadata supplies every profile and catalog color before publication', async () => {
  const { data, metadata } = await fixture()
  const decoded = await decodeDatasetMetadata(metadata, data.languages, variants, data.manifest)
  assert.deepEqual(
    [...decoded.palettes.keys()],
    ['a/contemporary', 'a/time-of-contact', 'b/contemporary'],
  )
  const palette = decoded.palettes.get('a/contemporary')
  assert.ok(palette)
  assert.deepEqual(
    [...palette.colors],
    [
      ['root', '#123456'],
      ['leaf', '#abcdef'],
    ],
  )
  assert.deepEqual(
    decoded.datasets.map((d) => d.id),
    ['a', 'b'],
  )
  assert.ok(
    decoded.datasets.every((d) => !('profiles' in d)),
    'Runtime descriptions do not duplicate encoded palettes',
  )
})

test('incomplete, incompatible or corrupt metadata fails the entire catalog load', async () => {
  const { data, metadata } = await fixture()
  const invalid = [
    null,
    { ...metadata, colorPolicy: 'obsolete' },
    { ...metadata, catalogHash: 'stale' },
    { ...metadata, coverageDirectory: 'old/' },
    { ...metadata, datasets: [] },
    { ...metadata, datasets: [...metadata.datasets, metadata.datasets[0]] },
  ]
  for (const change of [
    { colors: ['#123456'] },
    { colors: ['red', '#abcdef'] },
    { coverageSignature: 'old' },
    { viewId: 'unknown' },
  ]) {
    const changed = structuredClone(metadata)
    const profile = changed.datasets[0]?.profiles[0]
    assert.ok(profile)
    Object.assign(profile, change)
    invalid.push(changed)
  }
  for (const duplicate of [false, true]) {
    const changed = structuredClone(metadata)
    const profiles = changed.datasets[0]?.profiles as unknown[]
    if (duplicate) profiles.push(profiles[0])
    else profiles.pop()
    invalid.push(changed)
  }
  for (const changed of invalid) {
    await assert.rejects(
      decodeDatasetMetadata(changed as DatasetMetadata, data.languages, variants, data.manifest),
      /Invalid dataset metadata/,
    )
  }
  // Positional encoding must reject even a catalog with the same IDs in a different order.
  await assert.rejects(
    decodeDatasetMetadata(metadata, [...data.languages].reverse(), variants, data.manifest),
    /catalog does not match/,
  )
})

test('palette selection is synchronous and follows pinned provenance, with explicit mixed/custom behavior', async () => {
  const { data, metadata } = await fixture()
  const catalog = {
    ...data,
    ...(await decodeDatasetMetadata(metadata, data.languages, variants, data.manifest)),
  }
  for (const list of [entries('a'), entries('a', 'a')]) {
    const profile = selectGlobalColorProfile(catalog, list, {
      ...config,
      overrides: { leaf: '#ff0000' },
    })
    assert.ok(profile)
    assert.equal(profile.id, 'a/contemporary')
    assert.equal(catalog.palettes.get(profile.id)?.colors.get('root'), '#123456')
  }
  for (const list of [[], entries('a', 'b'), entries('a', 'historic'), entries('unknown')])
    assert.equal(selectGlobalColorProfile(catalog, list, config), null)
  for (const configuration of [
    { ...config, strategy: 'categorical' as const },
    { ...config, rootIds: ['root'] },
    { ...config, anchors: { root: '#123456' } },
  ])
    assert.equal(selectGlobalColorProfile(catalog, entries('a'), configuration), null)
})
