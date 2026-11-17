import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  decodeBoundaryGeometry,
  indexBoundaries,
} from '../src/features/administrative/boundaryRepository.ts'

const asset = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`../public/administrative/boundaries/${name}`, import.meta.url), 'utf8'),
  ) as unknown

test('the pinned boundary crosswalk keeps labels and polygons independent of CLDR values', () => {
  const index = indexBoundaries(asset('feature-index.json'), asset('crosswalk.json'))
  assert.equal(index.features.length, 242)
  assert.equal(index.associations.size, 258)
  assert.equal(index.points.features.length, 242)
  assert.equal(index.labels.features.length, 242)
  assert.equal(
    index.features.find((feature) => feature.featureId === 'country-USA')?.labelName,
    'United States',
  )
  assert.deepEqual(
    index.labels.features.find((feature) => feature.properties?.featureId === 'country-SOL')
      ?.geometry,
    { type: 'Point', coordinates: [46.731595, 9.443889] },
  )
  assert.equal(index.associations.get('XK')?.status, 'ambiguous')
  assert.equal(index.associations.get('XK')?.featureIds.length, 1)
  assert.equal(
    index.points.features.some((feature) => feature.properties?.featureId === 'country-KOS'),
    true,
  )
  assert.equal(index.associations.get('PS')?.viewpointSensitive, true)

  const geometry = decodeBoundaryGeometry(asset('geometry.geojson'), index)
  assert.equal(geometry.features.length, 242)
  assert.equal(geometry.features.filter((feature) => feature.properties?.territoryCode).length, 237)
  assert.equal(
    geometry.features.find((feature) => feature.properties?.featureId === 'country-PSX')?.properties
      ?.territoryCode,
    'PS',
  )
  assert.equal(
    geometry.features.find((feature) => feature.properties?.featureId === 'country-PSX')?.properties
      ?.status,
    'sensitive',
  )
  assert.equal(
    geometry.features.find((feature) => feature.properties?.featureId === 'country-LBY')?.geometry
      .type,
    'Polygon',
  )
  assert.equal(
    geometry.features.find((feature) => feature.id === 'country-LBY')?.properties?.territoryCode,
    'LY',
  )
  assert.equal(
    geometry.features.find((feature) => feature.id === 'country-SOL')?.properties?.territoryCode,
    null,
  )
  assert.equal(
    geometry.features.find((feature) => feature.id === 'country-IOA')?.properties?.territoryCode,
    null,
  )
  assert.equal(
    geometry.features.every((feature) => !('metricValue' in (feature.properties ?? {}))),
    true,
  )
})

test('a geometry file from another boundary view is rejected', () => {
  const index = indexBoundaries(asset('feature-index.json'), asset('crosswalk.json'))
  const invalid = {
    type: 'FeatureCollection',
    features: [],
  }
  assert.throws(() => decodeBoundaryGeometry(invalid, index), /does not match/)
})

test('date-line countries are split before polygon and border rendering', () => {
  const index = indexBoundaries(asset('feature-index.json'), asset('crosswalk.json'))
  const geometry = decodeBoundaryGeometry(asset('geometry.geojson'), index)
  for (const [name, minimumParts] of [
    ['Russia', 101],
    ['Fiji', 21],
  ] as const) {
    const id = index.features.find((feature) => feature.sourceName === name)?.featureId
    const country = geometry.features.find((feature) => feature.id === id)
    assert.equal(country?.geometry.type, 'MultiPolygon')
    if (country?.geometry.type !== 'MultiPolygon') continue
    assert.equal(country.geometry.coordinates.length, minimumParts)
    for (const part of country.geometry.coordinates)
      for (const ring of part)
        for (let i = 1; i < ring.length; i++)
          assert.ok(
            Math.abs(ring[i][0] - ring[i - 1][0]) <= 180,
            `${name} has a border crossing the map`,
          )
  }
})
