import assert from 'node:assert/strict'
import test from 'node:test'
import { polygonCells } from '../scripts/lib/colorGrid.mjs'

test('offline color footprints preserve holes, tiny islands and boundary contacts', () => {
  const cells = polygonCells(
    [
      [
        [0.1, 0.1],
        [5.9, 0.1],
        [5.9, 5.9],
        [0.1, 5.9],
      ],
      [
        [1.1, 1.1],
        [4.9, 1.1],
        [4.9, 4.9],
        [1.1, 4.9],
      ],
    ],
    6,
    6,
  )
  assert.ok(cells.has(0))
  assert.ok(!cells.has(2 * 6 + 2), 'hole interiors must remain empty')
  assert.deepEqual(
    [
      ...polygonCells(
        [
          [
            [2.1, 2.1],
            [2.2, 2.1],
            [2.1, 2.2],
          ],
        ],
        6,
        6,
      ),
    ],
    [14],
  )
  const crossing = polygonCells(
    [
      [
        [0.1, 0.1],
        [4.9, 4.9],
        [4.8, 4.9],
      ],
    ],
    6,
    6,
  )
  assert.ok(crossing.has(14), 'thin polygon crossing cell without containing its center')
  assert.ok(!crossing.has(4), 'bounding rectangle is not the footprint')
  const boundary = polygonCells(
    [
      [
        [1, 1],
        [2, 1],
        [2, 2],
        [1, 2],
      ],
    ],
    4,
    4,
  )
  assert.ok(boundary.has(0) && boundary.has(10), 'both sides of touched grid boundary')
  assert.equal(
    polygonCells(
      [
        [
          [10, 10],
          [11, 10],
          [11, 11],
        ],
      ],
      6,
      6,
    ).size,
    0,
  )
})
