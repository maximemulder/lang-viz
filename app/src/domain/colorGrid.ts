/** Conservative polygon/grid intersection: interiors and every touched boundary cell.
 * Grid-unit coordinates, even/odd fill for holes. Mirrors box capture semantics. */
type Point = readonly [number, number]
type Segment = readonly [Point, Point]

export const polygonCells = (
  rings: readonly (readonly Point[])[],
  columns: number,
  rows: number,
): Set<number> => {
  const cells = new Set<number>(),
    points = rings.flat()
  if (!points.length) return cells
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1])
  const segments: Segment[] = rings.flatMap((ring) =>
    ring.map((p, i) => [p, ring[(i + 1) % ring.length] ?? p] as const),
  )
  const intersects = ([a, b]: Segment, x: number, y: number) => {
    let low = 0,
      high = 1
    for (const axis of [0, 1] as const) {
      const start = a[axis],
        delta = b[axis] - start,
        edge = axis ? y : x
      if (!delta) {
        if (start < edge || start > edge + 1) return false
        continue
      }
      const t0 = (edge - start) / delta,
        t1 = (edge + 1 - start) / delta
      low = Math.max(low, Math.min(t0, t1))
      high = Math.min(high, Math.max(t0, t1))
      if (low > high) return false
    }
    return true
  }
  for (
    let y = Math.max(0, Math.ceil(Math.min(...ys)) - 1);
    y <= Math.min(rows - 1, Math.floor(Math.max(...ys)));
    y++
  )
    for (
      let x = Math.max(0, Math.ceil(Math.min(...xs)) - 1);
      x <= Math.min(columns - 1, Math.floor(Math.max(...xs)));
      x++
    ) {
      let inside = false
      for (const [a, b] of segments)
        if (
          a[1] > y + 0.5 !== b[1] > y + 0.5 &&
          x + 0.5 < a[0] + ((b[0] - a[0]) * (y + 0.5 - a[1])) / (b[1] - a[1])
        )
          inside = !inside
      if (inside || segments.some((segment) => intersects(segment, x, y)))
        cells.add(y * columns + x)
    }
  return cells
}
