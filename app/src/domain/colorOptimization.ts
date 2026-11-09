import { branchRefinement } from './colorBranches.ts'
import {
  buildFamilyPalette,
  type ColorAxes,
  type ColorPosition,
  familyShade,
} from './colorHierarchy.ts'
import type { ColorConfiguration, ColorTopology, SemanticPalette } from './colors.ts'
import {
  assignFamilyAnchors,
  buildFamilyLinks,
  type ColorFamily,
  type ColorSample,
  colorDistance,
  colorSample,
  type FamilyColorPlane,
  type FamilyLink,
  familyColorSpaces,
} from './familyColors.ts'

/** Entry identity preserves independently colored source/period comparisons. */
export interface ColorFootprint {
  readonly id: string
  readonly languageId: string
  readonly cells: readonly number[]
  readonly fixedColor?: string
}
export interface ColorView {
  readonly columns: number
  readonly rows: number
  readonly footprints: readonly ColorFootprint[]
}
export interface ColorOptimizationInput {
  readonly topology: ColorTopology
  readonly reference: SemanticPalette
  readonly configuration: ColorConfiguration
  readonly view: ColorView
}
export interface PaletteQuality {
  /** Normalized shortages between actual displayed family palettes. */
  readonly localFamilyConflict: number
  readonly prominentFamilyConflict: number
  readonly worstFamilyConflict: number
  /** Perceptual distance from the family anchor, excluding exact overrides. */
  readonly familySpread: number
  readonly maxFamilySpread: number
  /** Mean distance between sampled neighboring relatives; larger is clearer. */
  readonly internalContrast: number
}
export interface FamilyColorRegion {
  readonly anchor: string
  readonly radius: number
  readonly visibleCount: number
}
export interface OptimizedColors {
  /** Entire affected families, including offscreen relatives. */
  readonly colors: ReadonlyMap<string, string>
  readonly regions: ReadonlyMap<string, FamilyColorRegion>
  readonly languageCount: number
  readonly rootCount: number
  readonly before: PaletteQuality
  readonly after: PaletteQuality
}

interface Group {
  readonly id: string
  readonly cells: readonly number[]
  readonly weights: ReadonlyMap<string, number>
  readonly vertices: readonly Vertex[]
  readonly family: ColorFamily
  positions: ReadonlyMap<string, ColorPosition>
  anchor: ColorSample
  radius: number
  planes: readonly FamilyColorPlane[]
  axes?: ColorAxes
  localPlanes: ReadonlyMap<string, readonly FamilyColorPlane[]>
}
interface Vertex {
  readonly id: string
  readonly languageId: string
  readonly cells: readonly number[]
  readonly fixed?: ColorSample
}
interface InternalEdge {
  readonly a: Vertex
  readonly b: Vertex
  readonly weight: number
}

// Multi-source chessboard distance. A pair's distance is relative to the sizes
// of its actual footprints: large nearby territories compete without overlap.
const distanceField = (cells: readonly number[], columns: number, rows: number) => {
  const field = new Float32Array(columns * rows).fill(columns + rows)
  for (const cell of cells) field[cell] = 0
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < columns; x++) {
      const i = y * columns + x
      field[i] = Math.min(
        field[i] ?? 0,
        x ? (field[i - 1] ?? 0) + 1 : columns + rows,
        y ? (field[i - columns] ?? 0) + 1 : columns + rows,
        x && y ? (field[i - columns - 1] ?? 0) + 1 : columns + rows,
        y && x + 1 < columns ? (field[i - columns + 1] ?? 0) + 1 : columns + rows,
      )
    }
  for (let y = rows - 1; y >= 0; y--)
    for (let x = columns - 1; x >= 0; x--) {
      const i = y * columns + x
      field[i] = Math.min(
        field[i] ?? 0,
        x + 1 < columns ? (field[i + 1] ?? 0) + 1 : columns + rows,
        y + 1 < rows ? (field[i + columns] ?? 0) + 1 : columns + rows,
        x && y + 1 < rows ? (field[i + columns - 1] ?? 0) + 1 : columns + rows,
        x + 1 < columns && y + 1 < rows ? (field[i + columns + 1] ?? 0) + 1 : columns + rows,
      )
    }
  return field
}

/** Bounded local graph for internal shade refinement. Dense cells retain tree
 * neighbors and evenly spaced representatives. Family assignment uses its own
 * graph and is independent of this sampling and the number of descendants.
 */
const internalEdges = (group: Group, columns: number, rows: number): readonly InternalEdge[] => {
  const order = new Map([...group.positions.keys()].map((id, i) => [id, i]))
  const vertices = [...group.vertices].sort(
    (a, b) =>
      (order.get(a.languageId) ?? 0) - (order.get(b.languageId) ?? 0) || a.id.localeCompare(b.id),
  )
  const cells = new Map<number, number[]>()
  vertices.forEach((vertex, i) => {
    for (const cell of vertex.cells) {
      const occupants = cells.get(cell) ?? []
      occupants.push(i)
      cells.set(cell, occupants)
    }
  })
  const pairs = new Map<number, InternalEdge>()
  for (const [cell, here] of cells) {
    const x = cell % columns
    const y = Math.floor(cell / columns)
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (x + dx < 0 || x + dx >= columns || y + dy < 0 || y + dy >= rows) continue
        const otherCell = cell + dy * columns + dx
        if (otherCell < cell) continue
        const there = cells.get(otherCell) ?? []
        for (let index = 0; index < here.length; index++) {
          const ai = here[index]
          const a = vertices[ai ?? -1]
          if (!a || ai === undefined) continue
          const candidates =
            there.length <= 24
              ? there
              : [
                  ...new Set([
                    ...Array.from({ length: 8 }, (_, j) => there[(index + j) % there.length]),
                    ...Array.from(
                      { length: 8 },
                      (_, j) => there[Math.floor((j * there.length) / 8)],
                    ),
                  ]),
                ]
          for (const bi of candidates) {
            if (bi === undefined || ai === bi || (otherCell === cell && ai > bi)) continue
            const b = vertices[bi]
            if (!b || a.languageId === b.languageId) continue
            const key = Math.min(ai, bi) * vertices.length + Math.max(ai, bi)
            const previous = pairs.get(key)
            pairs.set(key, {
              a,
              b,
              weight:
                (previous?.weight ?? 0) +
                (otherCell === cell ? 2 : 0.5) / Math.sqrt(a.cells.length * b.cells.length),
            })
          }
        }
      }
  }
  const degrees = new Map<Vertex, number>()
  return [...pairs.values()]
    .sort((a, b) => b.weight - a.weight)
    .filter(({ a, b }) => {
      const da = degrees.get(a) ?? 0
      const db = degrees.get(b) ?? 0
      if (da >= 12 && db >= 12) return false
      degrees.set(a, da + 1)
      degrees.set(b, db + 1)
      return true
    })
}

const shortfall = (distance: number, target: number) => Math.max(0, 1 - distance / target) ** 2
const sampleOf = (vertex: Vertex, colors: ReadonlyMap<string, ColorSample>) =>
  vertex.fixed ?? colors.get(vertex.languageId) ?? colorSample('#777777')

/** Keep coherence, important ambiguity, and internal contrast separate. Measure
 * actual displayed shades. Farthest-point representatives retain extremes while
 * bounding diagnostics independently of classification size.
 */
const quality = (
  groups: readonly Group[],
  links: readonly FamilyLink[],
  colors: ReadonlyMap<string, ColorSample>,
  anchors: readonly ColorSample[],
  internal: readonly (readonly InternalEdge[])[],
): PaletteQuality => {
  let spread = 0
  let maxSpread = 0
  let area = 0
  const representatives = groups.map((group, i) => {
    const unique = new Map(
      group.vertices.map((vertex) => {
        const sample = sampleOf(vertex, colors)
        return [sample.hex, sample] as const
      }),
    )
    const available = [...unique.values()]
    const chosen = available.length ? [available[0] as ColorSample] : []
    const distances = available.map(() => Number.POSITIVE_INFINITY)
    while (chosen.length < Math.min(16, available.length)) {
      const previous = chosen.at(-1)
      if (!previous) break
      available.forEach((sample, j) => {
        distances[j] = Math.min(distances[j] ?? 0, colorDistance(previous, sample))
      })
      const next = distances.indexOf(Math.max(...distances))
      const sample = available[next]
      if (!sample) break
      chosen.push(sample)
    }
    let radius = 0
    const anchor = anchors[i]
    for (const vertex of group.vertices) {
      if (vertex.fixed || !anchor) continue
      radius = Math.max(radius, colorDistance(anchor, sampleOf(vertex, colors)))
    }
    spread += group.cells.length * radius
    area += group.cells.length
    maxSpread = Math.max(maxSpread, radius)
    return chosen
  })
  let local = 0
  let localWeight = 0
  let prominent = 0
  let prominentWeight = 0
  let worst = 0
  for (const link of links) {
    let minimum = Number.POSITIVE_INFINITY
    for (const a of representatives[link.a] ?? [])
      for (const b of representatives[link.b] ?? [])
        minimum = Math.min(minimum, colorDistance(a, b))
    const conflict = shortfall(minimum, link.target)
    local += link.local * conflict
    localWeight += link.local
    const a = groups[link.a]?.family.prominence ?? 0
    const b = groups[link.b]?.family.prominence ?? 0
    const weight = groups[link.a]?.family.prominent && groups[link.b]?.family.prominent ? a * b : 0
    prominent += weight * conflict
    prominentWeight += weight
    worst = Math.max(worst, link.priority * conflict)
  }
  let contrast = 0
  let contrastWeight = 0
  for (const [i, edges] of internal.entries()) {
    let familyContrast = 0
    let familyWeight = 0
    for (const edge of edges) {
      familyContrast +=
        edge.weight * colorDistance(sampleOf(edge.a, colors), sampleOf(edge.b, colors))
      familyWeight += edge.weight
    }
    if (!familyWeight) continue
    const area = groups[i]?.cells.length ?? 0
    contrast += (area * familyContrast) / familyWeight
    contrastWeight += area
  }
  return {
    localFamilyConflict: local / (localWeight || 1),
    prominentFamilyConflict: prominent / (prominentWeight || 1),
    worstFamilyConflict: worst,
    familySpread: spread / (area || 1),
    maxFamilySpread: maxSpread,
    internalContrast: contrast / (contrastWeight || 1),
  }
}

const refineShades = (
  group: Group,
  edges: readonly InternalEdge[],
  colors: Map<string, ColorSample>,
) => {
  if (group.radius < 0.025) return
  const massByPath = new Map<string, number>()
  for (const [id, mass] of group.weights) {
    const path = group.positions.get(id)?.path ?? []
    for (let depth = 0; depth <= path.length; depth++) {
      const key = path.slice(0, depth).join(',')
      massByPath.set(key, (massByPath.get(key) ?? 0) + mass)
    }
  }
  const targets = new Map<InternalEdge, number>()
  for (const edge of edges) {
    const pa = group.positions.get(edge.a.languageId)?.path ?? []
    const pb = group.positions.get(edge.b.languageId)?.path ?? []
    let shared = 0
    while (pa[shared] !== undefined && pa[shared] === pb[shared]) shared++
    const share = (massByPath.get(pa.slice(0, shared).join(',')) ?? 0) / (massByPath.get('') || 1)
    // A broad visible clade still deserves contrast through deep classification
    // wrappers. Feasibility bounds remain hard; these targets can be unmet.
    targets.set(
      edge,
      Math.max(group.radius * (0.35 + 0.85 / (shared + 1)), 0.035 + 0.045 * Math.sqrt(share)),
    )
  }
  const incident = new Map<string, InternalEdge[]>()
  for (const edge of edges)
    for (const vertex of [edge.a, edge.b]) {
      if (vertex.fixed || vertex.languageId === group.id) continue
      const list = incident.get(vertex.languageId) ?? []
      list.push(edge)
      incident.set(vertex.languageId, list)
    }
  const ordered = [...incident].sort(
    (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
  )
  const seeds = new Map(ordered.map(([id]) => [id, colors.get(id)]))
  const candidatesById = new Map<string, ColorSample[]>()
  for (let pass = 0; pass < 2; pass++)
    for (const [id, edges] of ordered) {
      const position = group.positions.get(id)
      const seed = seeds.get(id)
      if (!position || !seed) continue
      const cost = (candidate: ColorSample) => {
        let value = 0
        let weight = 0
        for (const edge of edges) {
          const a =
            edge.a.fixed ??
            (edge.a.languageId === id ? candidate : colors.get(edge.a.languageId)) ??
            seed
          const b =
            edge.b.fixed ??
            (edge.b.languageId === id ? candidate : colors.get(edge.b.languageId)) ??
            seed
          value += edge.weight * shortfall(colorDistance(a, b), targets.get(edge) ?? 0.035)
          weight += edge.weight
        }
        return value / (weight || 1) + 0.04 * (colorDistance(seed, candidate) / group.radius) ** 2
      }
      let best = colors.get(id) ?? seed
      let bestCost = cost(best)
      let candidates = candidatesById.get(id)
      if (!candidates) {
        candidates = []
        for (const dh of [-0.3, 0, 0.3])
          for (const dl of [-0.3, 0, 0.3])
            for (const dc of [-0.3, 0, 0.3]) {
              const coordinates = position.coordinates.map((coordinate, axis) => {
                const [low, high] = position.box[axis] ?? [0, 0]
                return Math.max(
                  low,
                  Math.min(high, coordinate + (high - low) * ([dh, dl, dc][axis] ?? 0)),
                )
              })
              const candidate = familyShade(
                group.anchor,
                coordinates,
                group.radius,
                group.localPlanes.get(id) ?? group.planes,
                group.axes,
              )
              candidates.push(candidate)
            }
        candidatesById.set(id, candidates)
      }
      for (const candidate of candidates) {
        const value = cost(candidate)
        if (value < bestCost - 1e-10) {
          best = candidate
          bestCost = value
        }
      }
      colors.set(id, best)
    }
}

/** Optimize coherent family regions first, then bounded genealogical detail.
 * Reference colors are stable defaults, preventing refresh drift. Geometry is
 * sampled by the caller; this function never requests or partitions it.
 */
export const optimizeColors = ({
  topology,
  reference,
  configuration,
  view,
}: ColorOptimizationInput): OptimizedColors => {
  if (
    !Number.isInteger(view.columns) ||
    !Number.isInteger(view.rows) ||
    view.columns < 1 ||
    view.rows < 1 ||
    view.columns * view.rows > 4096
  )
    throw new Error('Invalid color-view grid')
  const byRoot = new Map<string, Vertex[]>()
  for (const footprint of [...view.footprints].sort((a, b) => a.id.localeCompare(b.id))) {
    const root = reference.rootById.get(footprint.languageId)
    if (!root) continue
    const cells = [...new Set(footprint.cells)]
      .filter((cell) => Number.isInteger(cell) && cell >= 0 && cell < view.columns * view.rows)
      .sort((a, b) => a - b)
    if (!cells.length) continue
    const fixed = footprint.fixedColor ?? configuration.overrides[footprint.languageId]
    const vertices = byRoot.get(root) ?? []
    vertices.push({
      id: footprint.id,
      languageId: footprint.languageId,
      cells,
      ...(fixed ? { fixed: colorSample(fixed) } : {}),
    })
    byRoot.set(root, vertices)
  }
  const occupied = new Map(
    [...byRoot].map(([root, vertices]) => [
      root,
      [...new Set(vertices.flatMap(({ cells }) => cells))].sort((a, b) => a - b),
    ]),
  )
  const maximumArea = Math.max(1, ...[...occupied.values()].map(({ length }) => length))
  const groups: Group[] = [...byRoot]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, vertices]) => {
      const cells = occupied.get(id) ?? []
      const population = new Map<number, number>()
      for (const vertex of vertices)
        for (const cell of vertex.cells) population.set(cell, (population.get(cell) ?? 0) + 1)
      const weights = new Map<string, number>()
      const fixed = new Map<string, { color: ColorSample; weight: number }>()
      let automatic = 0
      for (const vertex of vertices) {
        const mass = vertex.cells.reduce((sum, cell) => sum + 1 / (population.get(cell) || 1), 0)
        weights.set(vertex.languageId, (weights.get(vertex.languageId) ?? 0) + mass)
        if (vertex.fixed) {
          const previous = fixed.get(vertex.fixed.hex)
          fixed.set(vertex.fixed.hex, {
            color: vertex.fixed,
            weight: (previous?.weight ?? 0) + mass / cells.length,
          })
        } else automatic += mass / cells.length
      }
      const complexity = [...weights.values()].reduce(
        (sum, mass) => sum + Math.min(1, mass / 0.75),
        0,
      )
      const anchor = colorSample(reference.anchors.get(id) ?? '#777777')
      return {
        id,
        cells,
        vertices,
        weights,
        family: {
          id,
          reference: anchor,
          locked: !!configuration.anchors[id],
          automatic,
          fixed: [...fixed.values()],
          prominence: Math.sqrt(cells.length / maximumArea),
          prominent:
            cells.length >= Math.max(1.5, view.columns * view.rows * 0.01, maximumArea * 0.04),
          coverage: cells.length / (view.columns * view.rows),
          demand: weights.size > 1 ? Math.sqrt(Math.max(0.1, Math.min(16, complexity - 1))) : 0,
        },
        positions: new Map<string, ColorPosition>(),
        anchor,
        radius: 0,
        planes: [],
        localPlanes: new Map<string, readonly FamilyColorPlane[]>(),
      }
    })
  const families = groups.map(({ family }) => family)
  const fields = groups.map(({ cells }) => distanceField(cells, view.columns, view.rows))
  const links = buildFamilyLinks(families, (a, b) => {
    const first = groups[a]
    const second = groups[b]
    const fieldA = fields[a]
    const fieldB = fields[b]
    if (!first || !second || !fieldA || !fieldB) return 0
    const scale = 0.75 + 0.15 * (Math.sqrt(first.cells.length) + Math.sqrt(second.cells.length))
    const contact = (cells: readonly number[], field: Float32Array) =>
      cells.reduce(
        (sum, cell) => sum + Math.exp(-((Math.max(0, (field[cell] ?? 0) - 1) / scale) ** 2)),
        0,
      ) / cells.length
    // Protect a small territory beside a large one, while a single remote
    // outpost must not make two otherwise distant families strong neighbors.
    return Math.max(contact(first.cells, fieldB), contact(second.cells, fieldA))
  })
  const anchors = assignFamilyAnchors(families, links, true, true)
  const spaces = familyColorSpaces(families, links, anchors)
  const colors = new Map<string, ColorSample>()
  groups.forEach((group, i) => {
    group.anchor = anchors[i] ?? group.anchor
    group.radius = spaces[i]?.radius ?? 0
    const planes = spaces[i]?.planes ?? []
    group.planes = planes.filter((plane) => plane.family === undefined || plane.global)
    const neighbors = new Map<number, FamilyColorPlane[]>()
    for (const plane of planes) {
      if (plane.family === undefined || plane.global) continue
      const list = neighbors.get(plane.family) ?? []
      list.push(plane)
      neighbors.set(plane.family, list)
    }
    const localPlanes = new Map<string, readonly FamilyColorPlane[]>()
    for (const vertex of group.vertices) {
      if (vertex.fixed) continue
      const nearby: FamilyColorPlane[] = []
      for (const [j, bounds] of neighbors) {
        const field = fields[j]
        const other = groups[j]
        if (!field || !other) continue
        const reach = 1 + 0.15 * (Math.sqrt(vertex.cells.length) + Math.sqrt(other.cells.length))
        if (vertex.cells.some((cell) => (field[cell] ?? 0) <= reach)) nearby.push(...bounds)
      }
      const previous = localPlanes.get(vertex.languageId) ?? group.planes
      localPlanes.set(vertex.languageId, [...new Set([...previous, ...nearby])])
    }
    group.localPlanes = localPlanes
    const palette = buildFamilyPalette(
      topology,
      reference.rootById,
      group.id,
      group.anchor,
      { radius: group.radius, planes: group.planes },
      group.weights,
      group.localPlanes,
    )
    group.axes = palette.axes
    group.positions = palette.positions
    for (const [id, color] of palette.colors) colors.set(id, color)
  })
  const beforeColors = new Map([...reference.colors].map(([id, color]) => [id, colorSample(color)]))
  const internal = groups.map((group) => internalEdges(group, view.columns, view.rows))
  const before = quality(
    groups,
    links,
    beforeColors,
    groups.map(({ family }) => family.reference),
    internal,
  )
  groups.forEach((group, i) => {
    refineShades(group, internal[i] ?? [], colors)
  })
  branchRefinement(groups, colors, view.columns, view.rows, distanceField)
  const after = quality(groups, links, colors, anchors, internal)
  return {
    colors: new Map([...colors].map(([id, sample]) => [id, sample.hex])),
    regions: new Map(
      groups.map((group) => [
        group.id,
        { anchor: group.anchor.hex, radius: group.radius, visibleCount: group.weights.size },
      ]),
    ),
    languageCount: groups.reduce((sum, group) => sum + group.weights.size, 0),
    rootCount: groups.length,
    before,
    after,
  }
}
