// biome-ignore-all lint/style/noNonNullAssertion: Geometry and index arrays are constructed together from validated optimizer inputs.
/** Experimental local graph. Not imported by the application's picker. */
import {
  type ColorAxes,
  type ColorPosition,
  familyColorFrame,
  familyShade,
} from '../../src/domain/colorHierarchy.ts'
import {
  type ColorSample,
  colorDistance,
  type FamilyColorPlane,
  type FamilyLink,
} from '../../src/domain/familyColors.ts'

interface Vertex {
  readonly id: string
  readonly languageId: string
  readonly cells: readonly number[]
  readonly fixed?: ColorSample
}
export interface Group {
  readonly id: string
  readonly vertices: readonly Vertex[]
  readonly weights: ReadonlyMap<string, number>
  readonly positions: ReadonlyMap<string, ColorPosition>
  readonly anchor: ColorSample
  readonly radius: number
  readonly planes: readonly FamilyColorPlane[]
  readonly axes?: ColorAxes
  readonly localPlanes: ReadonlyMap<string, readonly FamilyColorPlane[]>
}
interface InternalEdge {
  readonly a: Vertex
  readonly b: Vertex
  readonly weight: number
}
type DistanceField = (cells: readonly number[], columns: number, rows: number) => Float32Array
const shortfall = (distance: number, target: number) => Math.max(0, 1 - distance / target) ** 2
interface SpatialEdge extends InternalEdge {
  ga: number
  gb: number
  ia: number
  ib: number
  tie: number
}

// Geometry is computed once. Keep the strongest 12 intra-family and 12
// inter-family relationships per representation, taking their union so a
// tiny enclave's choice survives even when its large neighbor has many edges.
export const spatialEdges = (
  groups: readonly Group[],
  columns: number,
  rows: number,
  distanceField: DistanceField,
) => {
  const vertices = groups.flatMap((group, index) =>
    group.vertices.map((vertex) => ({ vertex, group: index })),
  )
  const fields = vertices.map(({ vertex }) => distanceField(vertex.cells, columns, rows))
  const bounds = vertices.map(({ vertex }) => {
    const xs = vertex.cells.map((cell) => cell % columns)
    const ys = vertex.cells.map((cell) => Math.floor(cell / columns))
    return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  })
  const nearest: SpatialEdge[][][] = vertices.map(() => [[], []])
  const retain = (index: number, type: number, edge: SpatialEdge) => {
    const list = nearest[index]![type]!
    const last = list[11]
    if (
      last &&
      (last.weight > edge.weight || (last.weight === edge.weight && last.tie <= edge.tie))
    )
      return
    list.push(edge)
    list.sort((a, b) => b.weight - a.weight || a.tie - b.tie || a.ia - b.ia || a.ib - b.ib)
    if (list.length > 12) list.pop()
  }
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i]!
    const ab = bounds[i]!
    for (let j = i + 1; j < vertices.length; j++) {
      const b = vertices[j]!
      if (a.vertex.languageId === b.vertex.languageId) continue
      const bb = bounds[j]!
      const scale =
        0.75 + 0.15 * (Math.sqrt(a.vertex.cells.length) + Math.sqrt(b.vertex.cells.length))
      const gap = Math.max(0, ab[0]! - bb[1]!, bb[0]! - ab[1]!, ab[2]! - bb[3]!, bb[2]! - ab[3]!)
      if (gap > 1 + scale * 1.921) continue
      const contact = (cells: readonly number[], field: Float32Array) => {
        let sum = 0
        for (const cell of cells) sum += Math.exp(-((Math.max(0, field[cell]! - 1) / scale) ** 2))
        return sum / cells.length
      }
      const weight = Math.max(
        contact(a.vertex.cells, fields[j]!),
        contact(b.vertex.cells, fields[i]!),
      )
      if (weight < 0.025) continue
      let tie = Math.imul(i + 1, 73856093) ^ Math.imul(j + 1, 19349663)
      tie = Math.imul(tie ^ (tie >>> 16), 0x45d9f3b)
      tie = (Math.imul(tie ^ (tie >>> 16), 0x45d9f3b) ^ (tie >>> 16)) >>> 0
      const edge = { a: a.vertex, b: b.vertex, ga: a.group, gb: b.group, ia: i, ib: j, weight, tie }
      const type = a.group === b.group ? 0 : 1
      retain(i, type, edge)
      retain(j, type, edge)
    }
  }
  const edges = new Map<number, SpatialEdge>()
  for (const kinds of nearest)
    for (const list of kinds)
      for (const edge of list) edges.set(edge.ia * vertices.length + edge.ib, edge)
  return [...edges.values()].sort((a, b) => a.ia - b.ia || a.ib - b.ib)
}

const refineSpatialShades = (
  groups: readonly Group[],
  edges: readonly SpatialEdge[],
  colors: Map<string, ColorSample>,
  links: readonly FamilyLink[],
) => {
  const masses = groups.map((group) => {
    const result = new Map<string, number>()
    for (const [id, mass] of group.weights) {
      const path = group.positions.get(id)?.path ?? []
      for (let depth = 0; depth <= path.length; depth++) {
        const key = path.slice(0, depth).join(',')
        result.set(key, (result.get(key) ?? 0) + mass)
      }
    }
    return result
  })
  const targets = new Map<SpatialEdge, number>()
  const linkTargets = new Map(links.map((link) => [`${link.a},${link.b}`, link.target]))
  const incident = new Map<string, { group: Group; edges: SpatialEdge[] }>()
  for (const edge of edges) {
    const group = groups[edge.ga]!
    if (edge.ga !== edge.gb) {
      targets.set(
        edge,
        linkTargets.get(`${Math.min(edge.ga, edge.gb)},${Math.max(edge.ga, edge.gb)}`) ?? 0.2,
      )
    } else {
      const pa = group.positions.get(edge.a.languageId)?.path ?? []
      const pb = group.positions.get(edge.b.languageId)?.path ?? []
      let shared = 0
      while (pa[shared] !== undefined && pa[shared] === pb[shared]) shared++
      const mass = masses[edge.ga]!
      const share = (mass.get(pa.slice(0, shared).join(',')) ?? 0) / (mass.get('') || 1)
      targets.set(
        edge,
        Math.max(group.radius * (0.35 + 0.85 / (shared + 1)), 0.035 + 0.045 * Math.sqrt(share)),
      )
    }
    for (const [vertex, index] of [
      [edge.a, edge.ga],
      [edge.b, edge.gb],
    ] as const) {
      const owner = groups[index]!
      if (vertex.fixed || vertex.languageId === owner.id || owner.radius < 0.025) continue
      const entry = incident.get(vertex.languageId) ?? { group: owner, edges: [] }
      entry.edges.push(edge)
      incident.set(vertex.languageId, entry)
    }
  }
  const frames = new Map(
    groups.map((group) => [group.id, familyColorFrame(group.anchor, group.radius, group.planes)]),
  )
  const ordered = [...incident].sort(
    (a, b) => b[1].edges.length - a[1].edges.length || a[0].localeCompare(b[0]),
  )
  const seeds = new Map(ordered.map(([id]) => [id, colors.get(id)!]))
  for (let pass = 0; pass < 2; pass++) {
    for (const [id, { group, edges }] of ordered) {
      const position = group.positions.get(id)!
      const seed = seeds.get(id)!
      const cost = (candidate: ColorSample) => {
        let value = 0,
          weight = 0
        for (const edge of edges) {
          const a =
            edge.a.fixed ??
            (edge.a.languageId === id ? candidate : colors.get(edge.a.languageId)) ??
            seed
          const b =
            edge.b.fixed ??
            (edge.b.languageId === id ? candidate : colors.get(edge.b.languageId)) ??
            seed
          value += edge.weight * shortfall(colorDistance(a, b), targets.get(edge)!)
          weight += edge.weight
        }
        return value / (weight || 1) + 0.04 * (colorDistance(seed, candidate) / group.radius) ** 2
      }
      let best = colors.get(id)!
      let bestCost = cost(best)
      for (const dh of [-0.3, 0, 0.3])
        for (const dl of [-0.3, 0, 0.3])
          for (const dc of [-0.3, 0, 0.3]) {
            const coordinates = position.coordinates.map((coordinate, axis) => {
              const [low, high] = frames.get(group.id)!.box[axis]!
              return Math.max(low, Math.min(high, coordinate + (high - low) * [dh, dl, dc][axis]!))
            })
            const candidate = familyShade(
              group.anchor,
              coordinates,
              group.radius,
              group.localPlanes.get(id) ?? group.planes,
              group.axes,
            )
            const value = cost(candidate)
            if (value < bestCost - 1e-10) {
              best = candidate
              bestCost = value
            }
          }
      colors.set(id, best)
    }
  }
}

export const spatialRefinement = (
  groups: readonly Group[],
  colors: Map<string, ColorSample>,
  links: readonly FamilyLink[],
  columns: number,
  rows: number,
  distanceField: DistanceField,
) => {
  const start = performance.now()
  const graph = spatialEdges(groups, columns, rows, distanceField)
  const graphMs = performance.now() - start
  refineSpatialShades(groups, graph, colors, links)
  return {
    graphMs,
    refineMs: performance.now() - start,
    edges: graph.length,
    crossEdges: graph.filter((edge) => edge.ga !== edge.gb).length,
  }
}
