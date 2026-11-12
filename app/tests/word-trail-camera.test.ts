import assert from 'node:assert/strict'
import { test } from 'node:test'
import { startOverlayCamera } from '../src/integrations/map/overlayCamera.ts'

const fixture = () => {
  const events = new Map<string, Set<() => void>>()
  const frames = new Map<number, () => void>()
  const fits: unknown[] = []
  let next = 0
  let current = true
  let loaded = false
  let stopped = 0
  const map = {
    isStyleLoaded: () => loaded,
    on: (event: string, callback: () => void) => {
      const listeners = events.get(event) ?? new Set()
      listeners.add(callback)
      events.set(event, listeners)
    },
    off: (event: string, callback: () => void) => {
      events.get(event)?.delete(callback)
    },
    resize: () => {},
    stop: () => {
      stopped++
    },
    getCanvas: () => ({ clientWidth: 800, clientHeight: 400 }),
    fitBounds: (...args: unknown[]) => {
      fits.push(args)
    },
  }
  return {
    map,
    fits,
    events,
    get stopped() {
      return stopped
    },
    loaded: () => {
      loaded = true
      for (const listener of events.get('style.load') ?? []) listener()
    },
    replace: () => {
      current = false
    },
    flush: () => {
      const callbacks = [...frames.values()]
      frames.clear()
      for (const callback of callbacks) callback()
    },
    start: (reducedMotion = false) =>
      startOverlayCamera({
        map,
        bounds: [170, 0, 190, 10],
        isCurrent: () => current,
        canStop: () => current,
        reducedMotion,
        frames: {
          request: (callback) => {
            const id = ++next
            frames.set(id, callback)
            return id
          },
          cancel: (id) => {
            frames.delete(id)
          },
        },
      }),
  }
}

test('trail focus waits for style and frame, fits once, and respects reduced motion', () => {
  const f = fixture()
  const stop = f.start(true)
  f.flush()
  assert.equal(f.fits.length, 0)
  f.loaded()
  f.flush()
  assert.deepEqual(f.fits, [
    [
      [
        [170, 0],
        [190, 10],
      ],
      { padding: 50, maxZoom: 3.2, duration: 0 },
    ],
  ])
  f.loaded()
  f.flush()
  assert.equal(f.fits.length, 1, 'style restoration is not another navigation action')
  stop()
  assert.equal(
    [...f.events.values()].reduce((sum, listeners) => sum + listeners.size, 0),
    0,
  )
})

test('newer intent and cleanup invalidate delayed style/frame camera callbacks', () => {
  for (const phase of ['style', 'frame', 'cleanup'] as const) {
    const f = fixture()
    const stop = f.start()
    if (phase !== 'style') f.loaded()
    if (phase === 'cleanup') stop()
    else f.replace()
    f.loaded()
    f.flush()
    assert.equal(f.fits.length, 0, phase)
    stop()
  }
})

test('completed focus cleanup leaves later user camera motion alone', () => {
  const f = fixture()
  const stop = f.start()
  f.loaded()
  f.flush()
  for (const listener of f.events.get('moveend') ?? []) listener()
  const stopped = f.stopped
  stop()
  assert.equal(f.stopped, stopped)
})
