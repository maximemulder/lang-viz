// biome-ignore-all lint/style/noNonNullAssertion: Geometry and index arrays are constructed together from validated optimizer inputs.
/** Local representation graph for explicit view color optimization. */
import type { ColorAxes, ColorPosition } from './colorHierarchy.ts'
import type { ColorSample, FamilyColorPlane } from './familyColors.ts'

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
  const sizes = vertices.map(({ vertex }) => Math.sqrt(vertex.cells.length))
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
      const scale = 0.75 + 0.15 * (sizes[i]! + sizes[j]!)
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
