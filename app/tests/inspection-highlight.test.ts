import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createInspectionHighlight } from '../src/features/map/inspectionHighlight.ts'

const fixture = () => {
  let source: object | undefined = {}
  const listeners = new Set<() => void>()
  const states = new Map<string, Record<string, unknown>>()
  const changes: string[] = []
  const map = {
    getSource: () => source,
    setFeatureState: (
      target: { source: string; sourceLayer: string; id: string },
      state: object,
    ) => {
      assert.equal(target.source, 'areas')
      assert.equal(target.sourceLayer, 'polygons')
      states.set(target.id, { ...states.get(target.id), ...state })
      changes.push(`set:${target.id}`)
    },
    removeFeatureState: (target: { id: string }, key: string) => {
      const state = states.get(target.id)
      if (state) delete state[key]
      changes.push(`remove:${target.id}`)
    },
    on: (_event: string, listener: () => void) => listeners.add(listener),
    off: (_event: string, listener: () => void) => listeners.delete(listener),
  } as unknown as Parameters<typeof createInspectionHighlight>[0]
  return {
    highlight: createInspectionHighlight(map, 'areas', 'polygons'),
    states,
    changes,
    listeners,
    styleData: () => {
      for (const listener of listeners) listener()
    },
    replaceSource: (next: object | undefined) => {
      source = next
      states.clear()
    },
  }
}

test('hover changes update only entering/leaving IDs, preserving shared contributors and other state', () => {
  const f = fixture()
  f.states.set('a', { other: 123 })
  f.highlight.set(['a', 'b', 'b'])
  f.highlight.set(['b', 'a'])
  f.styleData()
  assert.deepEqual(f.changes, ['set:a', 'set:b'])
  f.highlight.set(['b', 'c'])
  assert.deepEqual(f.changes, ['set:a', 'set:b', 'remove:a', 'set:c'])
  assert.deepEqual(f.states.get('a'), { other: 123 })
  assert.equal(f.states.get('b')?.inspected, true)
  assert.equal(f.states.get('c')?.inspected, true)
  f.highlight.set([])
  assert.ok([...f.states.values()].every((state) => !state.inspected))
  f.highlight.dispose()
})

test('source/style replacement restores current highlights, including when mounted before the source', () => {
  const f = fixture()
  f.replaceSource(undefined)
  f.highlight.set(['a', 'b'])
  assert.deepEqual(f.changes, [])
  f.replaceSource({})
  f.styleData()
  assert.deepEqual(f.changes, ['set:a', 'set:b'])
  f.styleData()
  assert.equal(f.changes.length, 2, 'ordinary style events do not repaint unchanged state')
  f.replaceSource({})
  f.styleData()
  assert.deepEqual(f.changes, ['set:a', 'set:b', 'set:a', 'set:b'])
  assert.equal(f.states.get('a')?.inspected, true)
  f.highlight.dispose()
  assert.equal(f.listeners.size, 0)
  assert.ok([...f.states.values()].every((state) => !state.inspected))
})

test('clearing while the source is absent prevents stale outlines when it returns', () => {
  const f = fixture()
  f.highlight.set(['a'])
  f.replaceSource(undefined)
  f.highlight.set([])
  f.replaceSource({})
  f.styleData()
  assert.deepEqual(f.changes, ['set:a'])
  f.replaceSource(undefined)
  f.highlight.dispose()
  assert.equal(f.listeners.size, 0)
})
