import type { MultiPolygon, Polygon, Position } from './geometry.ts'

const area = (ring: readonly Position[]) => {
  let sum = 0
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1],
      b = ring[i]
    if (a && b) sum += a[0] * b[1] - b[0] * a[1]
  }
  return sum
}
const pointKey = ([x, y]: Position) => `${x},${y}`
interface Edge {
  readonly a: Position
  readonly b: Position
  readonly end: string
}

/** Join an already disjoint integer coverage by cancelling identical shared edges.
 * No geometric intersections, general unions, snapping or invented coordinates.
 * Unmatched subdivisions can remain separate. Ambiguous/degenerate input keeps
 * its original pieces rather than asking the live overlay engine to repair it.
 */
export const joinParts = (polygons: MultiPolygon): MultiPolygon => {
  if (polygons.length < 2) return polygons
  const edges = new Map<string, Edge>()
  let cancelled = false
  for (const polygon of polygons)
    for (const ring of polygon)
      for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1],
          b = ring[i]
        if (!a || !b) continue
        const start = pointKey(a),
          end = pointKey(b)
        if (start === end) continue
        const forward = `${start}>${end}`,
          reverse = `${end}>${start}`
        if (edges.delete(reverse)) cancelled = true
        else if (edges.has(forward)) return polygons
        else edges.set(forward, { a, b, end })
      }
  if (!cancelled) return polygons
  const outgoing = new Map<string, Set<Edge>>()
  for (const edge of edges.values()) {
    const start = pointKey(edge.a)
    const next = outgoing.get(start)
    if (next) next.add(edge)
    else outgoing.set(start, new Set([edge]))
  }
  const shells: {
    polygon: Polygon
    area: number
    minX: number
    minY: number
    maxX: number
    maxY: number
  }[] = []
  const holes: Position[][] = []
  for (const initial of edges.values()) {
    if (!outgoing.get(pointKey(initial.a))?.has(initial)) continue
    let edge = initial
    const ring: Position[] = [edge.a]
    const start = pointKey(edge.a)
    for (;;) {
      const choices = outgoing.get(pointKey(edge.a))
      if (!choices?.delete(edge)) return polygons
      ring.push(edge.b)
      if (edge.end === start) break
      const next = outgoing.get(edge.end)
      if (!next?.size) return polygons
      // At point contacts follow the rightmost continuation so touching islands
      // remain separate rings. All input rings keep their covered side on the right.
      let best: Edge | undefined
      let angle = Number.NEGATIVE_INFINITY
      const dx = edge.b[0] - edge.a[0],
        dy = edge.b[1] - edge.a[1]
      for (const candidate of next) {
        const x = candidate.b[0] - candidate.a[0],
          y = candidate.b[1] - candidate.a[1]
        const turn = Math.atan2(dx * y - dy * x, dx * x + dy * y)
        if (turn > angle) {
          angle = turn
          best = candidate
        }
      }
      if (!best) return polygons
      edge = best
    }
    // Drop collinear vertices left by boundaries of now-unselected contributors.
    const simplified: Position[] = []
    for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[(i + ring.length - 2) % (ring.length - 1)],
        b = ring[i],
        c = ring[i + 1]
      if (!a || !b || !c) return polygons
      if ((b[0] - a[0]) * (c[1] - b[1]) !== (b[1] - a[1]) * (c[0] - b[0])) simplified.push(b)
    }
    const first = simplified[0]
    if (!first || simplified.length < 3) return polygons
    simplified.push(first)
    const signed = area(simplified)
    if (!signed) return polygons
    if (signed < 0) holes.push(simplified)
    else {
      let minX = Number.POSITIVE_INFINITY,
        minY = Number.POSITIVE_INFINITY
      let maxX = Number.NEGATIVE_INFINITY,
        maxY = Number.NEGATIVE_INFINITY
      for (const [x, y] of simplified) {
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
      shells.push({
        polygon: [simplified],
        area: signed,
        minX,
        maxX,
        minY,
        maxY,
      })
    }
  }
  shells.sort((a, b) => a.area - b.area)
  for (const hole of holes) {
    const point = hole[0]
    if (!point) return polygons
    const [x, y] = point
    const owner = shells.find((shell) => {
      if (x < shell.minX || x > shell.maxX || y < shell.minY || y > shell.maxY) return false
      const ring = shell.polygon[0]
      if (!ring) return false
      let hit = false
      for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1],
          b = ring[i]
        if (!a || !b) continue
        if (
          (x - a[0]) * (b[1] - a[1]) === (y - a[1]) * (b[0] - a[0]) &&
          x >= Math.min(a[0], b[0]) &&
          x <= Math.max(a[0], b[0]) &&
          y >= Math.min(a[1], b[1]) &&
          y <= Math.max(a[1], b[1])
        )
          return true
        if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0])
          hit = !hit
      }
      return hit
    })
    if (!owner) return polygons
    owner.polygon.push(hole)
  }
  return shells.map((shell) => shell.polygon)
}
