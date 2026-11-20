import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { FeatureCollection, Polygon, Position } from 'geojson'
import { countryOutsideMask } from '../src/features/administrative/countryMask.ts'

const box = (west: number, south: number, east: number, north: number): Position[] => [
  [west, south],
  [east, south],
  [east, north],
  [west, north],
  [west, south],
]
const inRing = (x: number, y: number, ring: Position[]) => {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j]
    if (a && b && a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0])
      inside = !inside
  }
  return inside
}
const masked = (mask: FeatureCollection<Polygon>, x: number, y: number) =>
  mask.features.some(({ geometry }) => {
    const [outer, ...holes] = geometry.coordinates
    return outer && inRing(x, y, outer) && !holes.some((ring) => inRing(x, y, ring))
  })
test('country mask removes outside colour while preserving interior language areas and enclaves', async () => {
  const geometry: Polygon = {
    type: 'Polygon',
    coordinates: [box(10, 0, 20, 10), box(13, 3, 15, 5)],
  }
  const original = JSON.stringify(geometry)
  const mask = await countryOutsideMask([geometry])
  for (const feature of mask.features) {
    const longitudes = feature.geometry.coordinates.flat().map(([longitude]) => longitude)
    assert.ok(Math.max(...longitudes) - Math.min(...longitudes) <= 90)
  }
  assert.equal(masked(mask, 0, 0), true)
  assert.equal(masked(mask, 12, 2), false)
  assert.equal(masked(mask, 14, 4), true)
  assert.equal(JSON.stringify(geometry), original)
})
test('country mask handles islands and source shapes cut at the dateline', async () => {
  const mask = await countryOutsideMask([
    {
      type: 'MultiPolygon',
      coordinates: [[box(170, 0, 180, 10)], [box(-180, 0, -170, 10)], [box(20, 20, 21, 21)]],
    },
  ])
  assert.equal(masked(mask, 175, 5), false)
  assert.equal(masked(mask, -175, 5), false)
  assert.equal(masked(mask, 0, 5), true)
  assert.equal(masked(mask, 20.5, 20.5), false)
})
