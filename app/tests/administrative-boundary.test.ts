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

test('the pinned boundary crosswalk keeps markers and polygons independent of CLDR values', () => {
  const index = indexBoundaries(asset('feature-index.json'), asset('crosswalk.json'))
  assert.equal(index.features.length, 241)
  assert.equal(index.associations.size, 251)
  assert.equal(index.points.features.length, 231)
  assert.equal(index.associations.get('XK')?.status, 'ambiguous')
  assert.equal(index.associations.get('XK')?.featureIds.length, 1)
  assert.equal(
    index.points.features.some((feature) => feature.properties?.territoryCode === 'XK'),
    false,
  )
  assert.equal(index.associations.get('PS')?.viewpointSensitive, true)

  const geometry = decodeBoundaryGeometry(asset('geometry.topojson'), index)
  assert.equal(geometry.features.length, 241)
  assert.equal(geometry.features.filter((feature) => feature.properties?.territoryCode).length, 231)
  assert.equal(
    geometry.features.find((feature) => feature.properties?.featureId === 'country-139')?.properties
      ?.territoryCode,
    'PS',
  )
  assert.equal(
    geometry.features.find((feature) => feature.properties?.featureId === 'country-139')?.properties
      ?.status,
    'sensitive',
  )
  assert.equal(
    geometry.features.find((feature) => feature.properties?.featureId === 'country-000')?.geometry
      .type,
    'Polygon',
  )
  assert.equal(
    geometry.features.every((feature) => !('metricValue' in (feature.properties ?? {}))),
    true,
  )
})

test('a topology from another boundary view is rejected', () => {
  const index = indexBoundaries(asset('feature-index.json'), asset('crosswalk.json'))
  const invalid = {
    type: 'Topology',
    objects: { countries: { geometries: [] } },
    arcs: [],
    transform: { scale: [1, 1], translate: [0, 0] },
  }
  assert.throws(() => decodeBoundaryGeometry(invalid, index), /does not match/)
})

test('date-line countries are split before polygon and border rendering', () => {
  const index = indexBoundaries(asset('feature-index.json'), asset('crosswalk.json'))
  const geometry = decodeBoundaryGeometry(asset('geometry.topojson'), index)
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
