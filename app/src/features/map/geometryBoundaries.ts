import type { Feature } from '@maplibre/vt-pbf'
import type { FilterSpecification } from 'maplibre-gl'

export const BOUNDARY_LAYER = 'language_boundaries'
export const FALLBACK_BOUNDARY_LAYER = 'language_fallback_boundaries'
export const BOUNDARY_ID = 'boundary_id'

type Point = [number, number]
type Segment = [Point, Point]
interface Event {
  readonly point: Point
  readonly side: 0 | 1
  readonly members: readonly string[]
  readonly delta: 1 | -1
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)
const membersOf = (feature: Feature): string[] => {
  const tags = feature.tags ?? {}
  if (typeof tags.variantId === 'string') return [tags.variantId]
  return typeof tags.variantIds === 'string' ? JSON.parse(tags.variantIds) : []
}

const joinLines = (segments: Segment[]): Point[][] => {
  const key = (point: Point) => `${point[0]},${point[1]}`
  const outgoing = new Map<string, Segment[]>(),
    incoming = new Map<string, number>()
  for (const line of segments) {
    const start = key(line[0]),
      end = key(line[1])
    const at = outgoing.get(start)
    if (at) at.push(line)
    else outgoing.set(start, [line])
    incoming.set(end, (incoming.get(end) ?? 0) + 1)
  }
  const remaining = new Set(segments),
    result: Point[][] = []
  const follow = (initial: Segment) => {
    if (!remaining.has(initial)) return
    const line = [initial[0]]
    let segment = initial
    for (;;) {
      remaining.delete(segment)
      const end = segment[1]
      line.push(end)
      const next = outgoing.get(key(end))
      const candidate = next?.[0]
      if (
        next?.length !== 1 ||
        !candidate ||
        incoming.get(key(end)) !== 1 ||
        !remaining.has(candidate)
      )
        break
      segment = candidate
    }
    result.push(line)
  }
  for (const line of segments) if (incoming.get(key(line[0])) !== 1) follow(line)
  for (const line of segments) follow(line)
  return result
}

/** Derive adjacency from the exact integer faces used for fills and picking.
 * Collinear subdivisions are split together, including edges simplified by a
 * previous join. A union highlight is a paint/filter operation on these edges.
 */
export const geometryBoundaries = (features: readonly Feature[], extent: number): Feature[] => {
  const lines = new Map<string, Map<number, Event[]>>()
  for (const feature of features) {
    if (feature.type !== 3) continue
    const members = membersOf(feature)
    for (const ring of feature.geometry)
      for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1] as Point
        const b = ring[i] as Point
        let dx = b[0] - a[0],
          dy = b[1] - a[1]
        if (!dx && !dy) continue
        // These edges are clipping cuts. Adjacent tiles own their continuation.
        if ((!dx && (a[0] === 0 || a[0] === extent)) || (!dy && (a[1] === 0 || a[1] === extent)))
          continue
        const divisor = gcd(Math.abs(dx), Math.abs(dy))
        dx /= divisor
        dy /= divisor
        const forward = dx > 0 || (!dx && dy > 0)
        if (!forward) {
          dx = -dx
          dy = -dy
        }
        const key = `${dx},${dy},${dx * a[1] - dy * a[0]}`
        let events = lines.get(key)
        if (!events) {
          events = new Map()
          lines.set(key, events)
        }
        for (const [point, delta] of [
          [a, forward ? 1 : -1],
          [b, forward ? -1 : 1],
        ] as const) {
          const t = dx ? point[0] : point[1]
          const event: Event = { point, side: forward ? 1 : 0, members, delta }
          const existing = events.get(t)
          if (existing) existing.push(event)
          else events.set(t, [event])
        }
      }
  }
  const output = new Map<string, Feature>()
  for (const events of lines.values()) {
    const sides = [new Map<string, number>(), new Map<string, number>()] as const
    let previous: Point | undefined
    for (const [, at] of [...events].sort(([a], [b]) => a - b)) {
      const point = at[0]?.point
      if (!point) continue
      let left = [...sides[0].keys()].sort(),
        right = [...sides[1].keys()].sort()
      if (previous && JSON.stringify(left) !== JSON.stringify(right)) {
        const reverse = JSON.stringify(left) > JSON.stringify(right)
        if (reverse) [left, right] = [right, left]
        const key = JSON.stringify([left, right])
        let feature = output.get(key)
        if (!feature) {
          feature = {
            type: 2,
            geometry: [],
            tags: Object.fromEntries([
              [BOUNDARY_ID, key],
              ...left.map((id) => [`l:${id}`, true]),
              ...right.map((id) => [`r:${id}`, true]),
            ]),
          }
          output.set(key, feature)
        }
        ;(feature.geometry as Point[][]).push(reverse ? [point, previous] : [previous, point])
      }
      for (const event of at) {
        const side = sides[event.side]
        for (const member of event.members) {
          const count = (side.get(member) ?? 0) + event.delta
          if (count) side.set(member, count)
          else side.delete(member)
        }
      }
      previous = point
    }
  }
  return [...output.values()].map((feature) => ({
    ...feature,
    type: 2,
    geometry: joinLines(feature.geometry as Segment[]),
  }))
}

/** Each group is a union; independent inspected entries retain their borders. */
export const boundaryFilter = (groups: readonly (readonly string[])[]): FilterSpecification => {
  const expressions = groups
    .filter((ids) => ids.length)
    .map((ids) => [
      '!=',
      ['any', ...ids.map((id) => ['has', `l:${id}`])],
      ['any', ...ids.map((id) => ['has', `r:${id}`])],
    ])
  return (
    expressions.length ? ['any', ...expressions] : ['==', ['literal', true], false]
  ) as FilterSpecification
}
