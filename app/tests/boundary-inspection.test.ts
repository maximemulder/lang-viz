import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createBoundaryInspection } from '../src/features/map/geometry/boundaryInspection.ts'
import {
  BOUNDARY_LAYER,
  boundaryFilter,
  FALLBACK_BOUNDARY_LAYER,
} from '../src/features/map/geometryBoundaries.ts'

const fixture = () => {
  let source: object | undefined = {}
  let groups: string[][] = [['a']]
  const features = new Map<string, (string | number)[]>([
    [BOUNDARY_LAYER, ['a-outside', 'a-b']],
    [FALLBACK_BOUNDARY_LAYER, ['fallback-a']],
  ])
  const states = new Map<string, boolean>()
  const writes: string[] = []
  const listeners = new Map<string, (event: object) => void>()
  const targetKey = ({ sourceLayer, id }: { sourceLayer: string; id: string | number }) =>
    `${sourceLayer}/${id}`
  const map = {
    getSource: () => source,
    querySourceFeatures: (_source: string, options: { sourceLayer: string; filter: unknown }) => {
      assert.deepEqual(options.filter, boundaryFilter(groups))
      return (features.get(options.sourceLayer) ?? []).map((id) => ({ id }))
    },
    setFeatureState: (target: Parameters<typeof targetKey>[0], state: { inspected: boolean }) => {
      states.set(targetKey(target), state.inspected)
      writes.push(`set:${targetKey(target)}`)
    },
    getFeatureState: (target: Parameters<typeof targetKey>[0]) => ({
      inspected: states.get(targetKey(target)),
    }),
    removeFeatureState: (target: Parameters<typeof targetKey>[0], key: string) => {
      assert.equal(key, 'inspected')
      states.delete(targetKey(target))
      writes.push(`remove:${targetKey(target)}`)
    },
    on: (event: string, callback: (event: object) => void) => listeners.set(event, callback),
    off: (event: string) => listeners.delete(event),
  }
  // Deliberately provide no setFilter, setPaintProperty or source-loading APIs.
  const controller = createBoundaryInspection(
    map as unknown as Parameters<typeof createBoundaryInspection>[0],
    'coverage',
  )
  return {
    controller,
    features,
    states,
    writes,
    listeners,
    set: (next: string[][]) => {
      groups = next
      controller.set(next)
    },
    replace: (next: object | undefined) => {
      source = next
      states.clear()
      listeners.get('styledata')?.({})
    },
    loaded: (sourceId = 'coverage') => listeners.get('sourcedata')?.({ sourceId }),
  }
}

test('hover paints only changed boundary IDs and clears native and fallback state without reloading', () => {
  const f = fixture()
  f.set([['a']])
  assert.equal(f.states.size, 3)
  f.set([['a']])
  assert.equal(f.writes.length, 3, 'unchanged membership must not write state again')
  f.features.set(BOUNDARY_LAYER, ['b-outside', 'a-b'])
  f.features.set(FALLBACK_BOUNDARY_LAYER, [])
  f.set([['b']])
  assert.deepEqual([...f.states.keys()].sort(), [
    `${BOUNDARY_LAYER}/a-b`,
    `${BOUNDARY_LAYER}/b-outside`,
  ])
  assert.equal(f.writes.length, 6, 'the shared edge stays painted across a hover change')
  f.set([])
  assert.equal(f.states.size, 0)
  f.controller.dispose()
  assert.equal(f.listeners.size, 0)
})

test('new tiles and style/source replacements restore the latest union and independent groups', () => {
  const f = fixture()
  f.set([['a', 'b'], ['comparison']])
  f.features.set(BOUNDARY_LAYER, ['new-union-edge'])
  f.loaded('unrelated-source')
  assert.equal(f.states.size, 3)
  f.loaded()
  assert.deepEqual([...f.states.keys()].sort(), [
    `${BOUNDARY_LAYER}/new-union-edge`,
    `${FALLBACK_BOUNDARY_LAYER}/fallback-a`,
  ])
  f.replace(undefined)
  assert.equal(f.states.size, 0)
  f.replace({})
  assert.equal(f.states.size, 2)
  f.states.clear()
  f.loaded()
  assert.equal(f.states.size, 2, 'state resets must recover even if the source object survives')
  f.controller.dispose()
  assert.equal(f.states.size, 0)
})
