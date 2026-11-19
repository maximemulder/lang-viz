import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createStore } from 'jotai/vanilla'
import {
  familyLabels,
  labelMinimumZoom,
  visibleLanguageLabels,
} from '../src/features/map/languageLabels.ts'
import {
  inspectLanguageFromSidebarAtom,
  languageMapNavigationAtom,
  languagePanelAtom,
} from '../src/state/languageControls.ts'
import { mapCameraIntentAtom } from '../src/state/mapCameraIntent.ts'
import { mapIsolationAtom } from '../src/state/mapInteraction.ts'

test('single-click sidebar inspection opens details without a zoom or isolation request', () => {
  const store = createStore()
  store.set(inspectLanguageFromSidebarAtom, { languageId: 'even1259' })
  assert.equal(store.get(languagePanelAtom).detailId, 'even1259')
  assert.equal(store.get(languageMapNavigationAtom), null)
  assert.equal(store.get(mapCameraIntentAtom), null)
  assert.equal(store.get(mapIsolationAtom), null)
})

test('smaller mapped areas reveal their labels later without removing their geometry', () => {
  assert.ok(labelMinimumZoom(2000) < labelMinimumZoom(20))
  assert.ok(labelMinimumZoom(20) < labelMinimumZoom(0.2))
  const labels = [
    { id: 'large', name: 'Large area', longitude: 200, latitude: 150, area: 2000 },
    { id: 'small', name: 'Small area', longitude: 400, latitude: 150, area: 0.2 },
  ]
  const project = (label: (typeof labels)[number]) => ({ x: label.longitude, y: label.latitude })
  assert.deepEqual(
    visibleLanguageLabels(labels, 2, 800, 600, project).map((l) => l.id),
    ['large'],
  )
  assert.deepEqual(
    visibleLanguageLabels(labels, 8, 800, 600, project).map((l) => l.id),
    ['large', 'small'],
  )
  assert.equal(labels.length, 2)
})

test('a dense region shows a few spaced names, preferring larger mapped areas', () => {
  const labels = Array.from({ length: 200 }, (_, i) => ({
    id: String(i),
    name: `Language ${i}`,
    area: i + 1,
    longitude: 100 + (i % 20) * 5,
    latitude: 100 + Math.floor(i / 20) * 5,
  }))
  const visible = visibleLanguageLabels(labels, 9, 800, 600, (l) => ({
    x: l.longitude,
    y: l.latitude,
  }))
  assert.equal(visible.length, 1)
  assert.equal(visible[0]?.id, '199')
})

test('regional views of small languages still reveal a few locally prominent names', () => {
  const labels = Array.from({ length: 10 }, (_, i) => ({
    id: String(i),
    name: `Language ${i}`,
    area: 0.001,
    longitude: 100 + (i % 4) * 180,
    latitude: 100 + Math.floor(i / 4) * 100,
  }))
  const visible = visibleLanguageLabels(labels, 4, 800, 600, (l) => ({
    x: l.longitude,
    y: l.latitude,
  }))
  assert.ok(visible.length > 4 && visible.length < labels.length)
})

test('family labels retain catalog names and use a real member anchor, including across the dateline', () => {
  const members = [
    {
      id: 'a',
      name: 'A',
      familyId: 'family',
      familyName: 'Catalog family',
      area: 3,
      longitude: 179,
      latitude: 0,
    },
    {
      id: 'b',
      name: 'B',
      familyId: 'family',
      familyName: 'Catalog family',
      area: 2,
      longitude: -178,
      latitude: 2,
    },
  ]
  const [family] = familyLabels(members)
  assert.equal(family?.name, 'Catalog family')
  assert.equal(family?.kind, 'family')
  assert.ok(
    members.some((m) => m.longitude === family?.longitude && m.latitude === family?.latitude),
  )
  assert.ok(Math.abs(family?.longitude ?? 0) > 170)
  assert.equal(members.length, 2)
})
test('unlinked records and catalog filing categories do not become invented families', () => {
  const member = { id: 'a', name: 'A', area: 1, longitude: 0, latitude: 0 }
  assert.deepEqual(familyLabels([member]), [])
  assert.deepEqual(
    familyLabels([
      { ...member, familyId: 'x', familyName: 'Bookkeeping' },
      { ...member, id: 'b', familyId: 'x', familyName: 'Bookkeeping' },
    ]),
    [],
  )
  assert.deepEqual(familyLabels([{ ...member, familyId: 'x', familyName: 'One member' }]), [])
})

test('alternative family anchors improve placement without duplicating a family label', () => {
  const labels = [
    {
      id: 'a',
      name: 'Family A',
      kind: 'family' as const,
      area: 100,
      longitude: 100,
      latitude: 100,
    },
    { id: 'b', name: 'Family B', kind: 'family' as const, area: 50, longitude: 105, latitude: 100 },
    { id: 'b', name: 'Family B', kind: 'family' as const, area: 50, longitude: 350, latitude: 100 },
  ]
  const visible = visibleLanguageLabels(labels, 1, 800, 600, (l) => ({
    x: l.longitude,
    y: l.latitude,
  }))
  assert.deepEqual(
    visible.map((l) => l.id),
    ['a', 'b'],
  )
  assert.equal(visible.find((l) => l.id === 'b')?.longitude, 350)
})
