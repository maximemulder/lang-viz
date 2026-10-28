import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import initGeos from 'geos-wasm'
import { geojsonToGeosGeom } from 'geos-wasm/helpers'
import {
  type CoverageInput,
  type CoverageRegion,
  loadCoveragePartition,
  type MultiPolygon,
  OverlapBudgetError,
  OverlapGeometryError,
} from '../src/features/map/overlap/geometry.ts'

const partition = await loadCoveragePartition()
const geos = await initGeos()
const box: MultiPolygon = [
  [
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ],
  ],
]

// Check topology and every contributor's reconstructed area, rather than an
// engine-specific polygon count/coordinate ordering.
const verifyPartition = (
  inputs: readonly CoverageInput[],
  regions: CoverageRegion[],
  extent: number,
) => {
  const pointers = new Set<number>()
  const own = (pointer: number) => {
    assert.ok(pointer)
    pointers.add(pointer)
    return pointer
  }
  const read = (coordinates: MultiPolygon) =>
    own(geojsonToGeosGeom({ type: 'MultiPolygon', coordinates }, geos))
  const areaPointer = geos.Module._malloc(8)
  const area = (pointer: number) => {
    assert.equal(geos.GEOSArea(pointer, areaPointer), 1)
    return geos.Module.getValue(areaPointer, 'double')
  }
  const union = (parts: number[]) => parts.reduce((a, b) => own(geos.GEOSUnion(a, b)), read([]))
  const differenceArea = (a: number, b: number) => area(own(geos.GEOSSymDifference(a, b)))
  try {
    const boundary = read([
      [
        [
          [0, 0],
          [extent, 0],
          [extent, extent],
          [0, extent],
          [0, 0],
        ],
      ],
    ])
    const expected = new Map<string, number[]>()
    for (const input of inputs) {
      const fragments = expected.get(input.id) ?? []
      fragments.push(read(input.geometry))
      expected.set(input.id, fragments)
    }
    const actual = regions.map((region) => {
      assert.deepEqual(region.members, [...new Set(region.members)].sort())
      assert.ok(region.members.length > 0)
      assert.ok(region.members.every((id) => expected.has(id)))
      assert.ok(region.minX >= -1e-7 && region.minY >= -1e-7)
      assert.ok(region.maxX <= extent + 1e-7 && region.maxY <= extent + 1e-7)
      const pointer = read(region.geometry)
      assert.equal(geos.GEOSisValid(pointer), 1)
      assert.ok(area(pointer) > 0)
      return pointer
    })
    const clipped = new Map(
      [...expected].map(([id, parts]) => [id, own(geos.GEOSIntersection(union(parts), boundary))]),
    )
    for (const [id, reference] of clipped) {
      const parts = actual.filter((_, i) => regions[i]?.members.includes(id))
      assert.ok(differenceArea(reference, union(parts)) < 1e-7, `Coverage for ${id}`)
    }
    assert.ok(differenceArea(union([...clipped.values()]), union(actual)) < 1e-7)
    let overlapArea = 0
    for (let i = 0; i < actual.length; i++) {
      for (let j = i + 1; j < actual.length; j++) {
        overlapArea += area(own(geos.GEOSIntersection(actual[i] as number, actual[j] as number)))
      }
    }
    assert.ok(overlapArea < 1e-7, `Interior overlap area ${overlapArea}`)
  } finally {
    for (const pointer of pointers) geos.GEOSGeom_destroy(pointer)
    geos.Module._free(areaPointer)
  }
}

for (const name of ['chad', 'east-africa']) {
  test(`GEOS regression: ${name} preserves valid, disjoint coverage and complete memberships`, async () => {
    const fixture: { inputs: CoverageInput[]; extent: number } = JSON.parse(
      await readFile(new URL(`./fixtures/overlap/${name}.json`, import.meta.url), 'utf8'),
    )
    const regions = partition(fixture.inputs, fixture.extent, { includeSingles: true })
    verifyPartition(fixture.inputs, regions, fixture.extent)
    assert.deepEqual(
      partition([...fixture.inputs].reverse(), fixture.extent, { includeSingles: true }),
      regions,
    )
  })
}

test('mixed area/edge/point intersections keep only polygonal coverage', () => {
  const a: MultiPolygon = [
    ...box,
    [
      [
        [20, 0],
        [30, 0],
        [30, 10],
        [20, 10],
        [20, 0],
      ],
    ],
    [
      [
        [40, 0],
        [50, 0],
        [50, 10],
        [40, 10],
        [40, 0],
      ],
    ],
  ]
  const b: MultiPolygon = [
    [
      [
        [5, 0],
        [10, 0],
        [10, 10],
        [5, 10],
        [5, 0],
      ],
    ],
    [
      [
        [30, 0],
        [35, 0],
        [35, 10],
        [30, 10],
        [30, 0],
      ],
    ],
    [
      [
        [50, 10],
        [55, 10],
        [55, 15],
        [50, 15],
        [50, 10],
      ],
    ],
  ]
  const inputs = [
    { id: 'A', geometry: a },
    { id: 'B', geometry: b },
  ]
  verifyPartition(inputs, partition(inputs, 64, { includeSingles: true }), 64)
  const shared = partition(inputs, 64)
  assert.equal(shared.length, 1)
  assert.deepEqual(shared[0]?.members, ['A', 'B'])
})

test('invalid inputs fail explicitly; empty and clipped-away inputs are harmless', () => {
  const invalid: MultiPolygon[] = [
    [
      [
        [
          [0, 0],
          [10, 10],
          [0, 10],
          [10, 0],
          [0, 0],
        ],
      ],
    ],
    [
      [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
        ],
      ],
    ],
    [
      [
        [
          [0, 0],
          [Number.NaN, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
      ],
    ],
    [
      [
        [
          [0, 0],
          [Number.POSITIVE_INFINITY, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
      ],
    ],
  ]
  for (const geometry of invalid) {
    assert.throws(() => partition([{ id: 'invalid', geometry }], 16), OverlapGeometryError)
  }
  assert.deepEqual(partition([{ id: 'empty', geometry: [] }], 16, { includeSingles: true }), [])
  assert.deepEqual(
    partition(
      [
        {
          id: 'outside',
          geometry: [
            [
              [
                [20, 0],
                [30, 0],
                [30, 10],
                [20, 10],
                [20, 0],
              ],
            ],
          ],
        },
      ],
      16,
      { includeSingles: true },
    ),
    [],
  )
  verifyPartition(
    [{ id: 'valid', geometry: box }],
    partition([{ id: 'valid', geometry: box }], 16, { includeSingles: true }),
    16,
  )
})

test('GEOS ownership is released after success, budget rejection, invalid input, and native failures', (t) => {
  const geometries = new Set<number>()
  const buffers = new Set<number>()
  const readers = new Set<number>()
  const writers = new Set<number>()
  const strings = new Set<number>()
  const track = (object: object, key: string, live: Set<number>) => {
    const fn = (object as Record<string, (...args: number[]) => number>)[key]
    assert.ok(fn)
    t.mock.method(object, key, (...args: number[]) => {
      const pointer = fn(...args)
      if (pointer) {
        assert.ok(!live.has(pointer), `Already owned ${key}`)
        live.add(pointer)
      }
      return pointer
    })
  }
  const release = (object: object, key: string, live: Set<number>) => {
    const fn = (object as Record<string, (pointer: number) => unknown>)[key]
    assert.ok(fn)
    t.mock.method(object, key, (pointer: number) => {
      assert.ok(live.delete(pointer), `Unowned release ${key}`)
      return fn(pointer)
    })
  }
  for (const key of [
    'GEOSGeoJSONReader_readGeometry',
    'GEOSGeom_clone',
    'GEOSIntersection',
    'GEOSDifference',
    'GEOSUnion',
  ])
    track(geos, key, geometries)
  const createCollection = geos.GEOSGeom_createCollection.bind(geos)
  t.mock.method(geos, 'GEOSGeom_createCollection', (type: number, array: number, count: number) => {
    const children = [...geos.Module.HEAPU32.subarray(array / 4, array / 4 + count)]
    const result = createCollection(type, array, count)
    if (result) {
      for (const child of children) assert.ok(geometries.delete(child))
      geometries.add(result)
    }
    return result
  })
  release(geos, 'GEOSGeom_destroy', geometries)
  track(geos.Module, '_malloc', buffers)
  release(geos.Module, '_free', buffers)
  track(geos, 'GEOSGeoJSONReader_create', readers)
  release(geos, 'GEOSGeoJSONReader_destroy', readers)
  track(geos, 'GEOSGeoJSONWriter_create', writers)
  release(geos, 'GEOSGeoJSONWriter_destroy', writers)
  track(geos, 'GEOSGeoJSONWriter_writeGeometry', strings)
  release(geos, 'GEOSFree', strings)
  const inputs = [
    { id: 'A', geometry: box },
    { id: 'A', geometry: box },
    { id: 'B', geometry: box },
  ]
  const clean = () => {
    for (const live of [geometries, buffers, readers, writers, strings]) assert.equal(live.size, 0)
  }
  for (let i = 0; i < 10; i++) {
    partition(inputs, 16, { includeSingles: true })
    clean()
    assert.throws(() => partition(inputs, 16, { maxRegions: 0 }), OverlapBudgetError)
    clean()
    assert.throws(
      () => partition(inputs, 16, { deadline: performance.now() - 1 }),
      OverlapBudgetError,
    )
    clean()
    assert.throws(
      () =>
        partition(
          [
            ...inputs,
            {
              id: 'C',
              geometry: [
                [
                  [
                    [0, 0],
                    [10, 10],
                    [0, 10],
                    [10, 0],
                    [0, 0],
                  ],
                ],
              ],
            },
          ],
          16,
        ),
      OverlapGeometryError,
    )
    clean()
  }
  // One intersection contains both a polygon and a line. Exercise cloning the
  // polygon from that collection and transferring its ownership to a new parent.
  partition(
    [
      {
        id: 'A',
        geometry: [
          ...box,
          [
            [
              [20, 0],
              [30, 0],
              [30, 10],
              [20, 10],
              [20, 0],
            ],
          ],
        ],
      },
      {
        id: 'B',
        geometry: [
          [
            [
              [5, 0],
              [10, 0],
              [10, 10],
              [5, 10],
              [5, 0],
            ],
          ],
          [
            [
              [30, 0],
              [35, 0],
              [35, 10],
              [30, 10],
              [30, 0],
            ],
          ],
        ],
      },
    ],
    64,
    { includeSingles: true },
  )
  clean()
  // A NULL native result must unwind through JS cleanup without returning a
  // partial partition. Restore each injected failure before the next attempt.
  for (const key of [
    'GEOSIntersection',
    'GEOSDifference',
    'GEOSUnion',
    'GEOSGeoJSONReader_readGeometry',
    'GEOSGeoJSONWriter_writeGeometry',
  ] as const) {
    const original = geos[key]
    geos[key] = (() => 0) as typeof original
    try {
      assert.throws(() => partition(inputs, 16, { includeSingles: true }), OverlapGeometryError)
      clean()
    } finally {
      geos[key] = original
    }
  }
  partition(inputs, 16)
  clean()
})
