import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GeometryDisplay } from '../src/features/map/geometry/display.ts'
import { idleHatchingState } from '../src/features/map/overlap/controller.ts'

test('desired detail does not replace committed geometry; previews participate in the same transition', () => {
  const display = new GeometryDisplay()
  display.target([{ z: 3, x: 0, y: 0 }])
  const snapshot = { id: 1, url: 'a', maxzoom: 3, coverageTiles: [{ z: 3, x: 0, y: 0 }] }
  display.publish({ ...idleHatchingState(), activeBuffer: 0, snapshots: [snapshot, null] }, 'a')
  let ready = false
  const remove = display.previewBarrier(() => ready)
  display.target([{ z: 7, x: 0, y: 0 }])
  assert.equal(display.getSnapshot().zoom, 3)
  assert.equal(display.getSnapshot().snapshot, snapshot)
  assert.equal(display.canPublish(7), false)
  ready = true
  assert.equal(display.canPublish(7), true)
  const replacement = {
    ...snapshot,
    id: 2,
    url: 'b',
    maxzoom: 7,
    coverageTiles: [{ z: 7, x: 0, y: 0 }],
  }
  display.publish({ ...idleHatchingState(), activeBuffer: 1, snapshots: [null, replacement] }, 'a')
  assert.equal(display.getSnapshot().zoom, 7)
  assert.equal(display.getSnapshot().source, 'language-overlap-regions-1')
  remove()
  assert.equal(display.canPublish(8), true)
})
test('an empty-map preview keeps its committed LOD until the requested replacement is ready', () => {
  const display = new GeometryDisplay()
  display.target([{ z: 3, x: 0, y: 0 }])
  display.previewBarrier(() => false)
  display.target([{ z: 6, x: 0, y: 0 }])
  assert.equal(display.getSnapshot().zoom, 3)
  assert.deepEqual(display.getSnapshot().committedTiles, [{ z: 3, x: 0, y: 0 }])
  display.previewReady(5)
  assert.equal(display.getSnapshot().zoom, 3)
  display.previewReady(6)
  assert.equal(display.getSnapshot().zoom, 6)
  assert.deepEqual(display.getSnapshot().committedTiles, [{ z: 6, x: 0, y: 0 }])
})
