// biome-ignore-all lint/style/noNonNullAssertion: Constructed indices and palette keys are constructed from normalized optimizer inputs.
/** Multiscale branch references with prominence-weighted chroma restraint. */
import { familyColorFrame, familyShade } from './colorHierarchy.ts'
import { type Group, spatialEdges } from './colorSpatial.ts'
import { type ColorSample, colorDistance, colorSample, gamutSample } from './familyColors.ts'

const candidateSwatches = [
  '#d15264',
  '#ce5d1e',
  '#af7600',
  '#8f8600',
  '#559724',
  '#009b70',
  '#009696',
  '#0091b7',
  '#3683e0',
  '#7c71de',
  '#a661c4',
  '#c35599',
  '#fb7887',
  '#f8834a',
  '#df9700',
  '#b7ac00',
  '#7abd4f',
  '#00c58f',
  '#00bfc0',
  '#00b9e9',
  '#67aaff',
  '#9f99ff',
  '#cd86ec',
  '#ec7abf',
].map(colorSample)
/** Soft restraint, not a beauty score. Small marks retain stronger accents. */
export const chromaRestraint = (color: ColorSample, prominence: number) => {
  const target = 0.18 - 0.08 * Math.sqrt(Math.max(0, Math.min(1, prominence)))
  return (Math.max(0, Math.hypot(color.a, color.b) - target) / 0.08) ** 2
}
const loss = (distance: number, target: number) => Math.max(0, 1 - distance / target) ** 2
const mean = (entries: readonly { color: ColorSample; weight: number }[]): ColorSample => {
  const mass = entries.reduce((sum, entry) => sum + entry.weight, 0) || 1
  return {
    hex: '',
    l: entries.reduce((s, e) => s + e.color.l * e.weight, 0) / mass,
    a: entries.reduce((s, e) => s + e.color.a * e.weight, 0) / mass,
    b: entries.reduce((s, e) => s + e.color.b * e.weight, 0) / mass,
  }
}
interface Branch {
  ids: string[]
  mass: number
  seed: ColorSample
  reference: ColorSample
  current: ColorSample
  peers?: { branch: Branch; floor: number }[]
}

/** Area cuts ignore unary wrappers; displayed ancestors retain their own slot.
 * Every leaf participates in one branch at each scale. No hard descendant boxes.
 */
export const branchCuts = (group: Group, colors: ReadonlyMap<string, ColorSample>) => {
  const automatic = new Set(
    group.vertices.filter((vertex) => !vertex.fixed).map((vertex) => vertex.languageId),
  )
  const ids = [...group.weights.keys()].filter((id) => automatic.has(id) && colors.has(id)).sort()
  const total = ids.reduce((sum, id) => sum + (group.weights.get(id) ?? 0), 0)
  return [0.5, 0.25, 0.125, 0.0625].map((scale) => {
    const pending = [{ ids, depth: 0 }]
    const result: Branch[] = []
    while (pending.length) {
      const node = pending.pop()!
      const mass = node.ids.reduce((sum, id) => sum + (group.weights.get(id) ?? 0), 0)
      const children = new Map<string, string[]>()
      for (const id of node.ids) {
        const path = group.positions.get(id)?.path ?? []
        const key = path[node.depth] === undefined ? `own:${id}` : String(path[node.depth])
        const list = children.get(key) ?? []
        list.push(id)
        children.set(key, list)
      }
      const canSplit = node.ids.some(
        (id) => (group.positions.get(id)?.path.length ?? 0) > node.depth,
      )
      if (mass > total * scale + 1e-9 && canSplit) {
        for (const child of children.values()) pending.push({ ids: child, depth: node.depth + 1 })
      } else {
        const seed = mean(
          node.ids.map((id) => ({ color: colors.get(id)!, weight: group.weights.get(id) ?? 0 })),
        )
        result.push({ ids: node.ids, mass, seed, reference: seed, current: seed })
      }
    }
    return result.sort((a, b) => b.mass - a.mass || a.ids[0]!.localeCompare(b.ids[0]!))
  })
}

export const branchRefinement = (
  groups: readonly Group[],
  colors: Map<string, ColorSample>,
  columns: number,
  rows: number,
  distanceField: (cells: readonly number[], columns: number, rows: number) => Float32Array,
) => {
  const chromaWeight = 0.1
  const started = performance.now()
  const graph = spatialEdges(groups, columns, rows, distanceField)
  const graphMs = performance.now() - started
  const incident = new Map<string, typeof graph>()
  for (const edge of graph)
    for (const vertex of [edge.a, edge.b]) {
      if (vertex.fixed) continue
      const edges = incident.get(vertex.languageId) ?? []
      edges.push(edge)
      incident.set(vertex.languageId, edges)
    }
  const largestArea = Math.max(1, ...groups.flatMap((group) => [...group.weights.values()]))
  const seeds = new Map(colors)
  const states = groups.map((group) => {
    const frame = familyColorFrame(group.anchor, group.radius, group.planes)
    const project = (sample: ColorSample, id?: string) => {
      if (!group.radius) return group.anchor
      const delta = [
        (sample.l - group.anchor.l) * 0.65,
        sample.a - group.anchor.a,
        sample.b - group.anchor.b,
      ]
      const axes = group.axes ?? frame.axes
      const coordinates = axes.map(
        (axis) => axis.reduce((s, v, i) => s + v * delta[i]!, 0) / group.radius,
      )
      return familyShade(
        group.anchor,
        coordinates,
        group.radius,
        id ? (group.localPlanes.get(id) ?? group.planes) : group.planes,
        axes,
      )
    }
    const pool: ColorSample[] = [group.anchor]
    for (const x of [-1, -0.5, 0, 0.5, 1])
      for (const y of [-1, 0, 1])
        for (const z of [-1, 0, 1]) {
          const coordinates = [x, y, z].map((v, i) => {
            const [low, high] = frame.box[i]!
            return low + ((v + 1) / 2) * (high - low)
          })
          pool.push(
            familyShade(
              group.anchor,
              coordinates,
              group.radius,
              group.planes,
              group.axes ?? frame.axes,
            ),
          )
        }
    pool.push(...candidateSwatches.map((color) => project(color)))
    if (chromaWeight) {
      for (const candidate of [...pool])
        for (const factor of [0.45, 0.65, 0.85])
          pool.push(project(gamutSample(candidate.l, candidate.a * factor, candidate.b * factor)))
    }
    const cuts = branchCuts(group, seeds)
    const total = [...group.weights.values()].reduce((s, w) => s + w, 0) || 1
    // Coordinate broad references jointly before assigning individual shades.
    // Only substantial clades compete globally within their family.
    for (const cut of cuts) {
      const major = cut.filter((branch) => branch.mass >= total * 0.025 - 1e-9)
      for (const branch of major)
        branch.peers = major
          .filter((other) => other !== branch)
          .map((other) => ({
            branch: other,
            floor: Math.min(0.025, colorDistance(branch.seed, other.seed)) * 0.98,
          }))
      for (let pass = 0; pass < 2; pass++)
        for (const branch of major) {
          const cost = (candidate: ColorSample) => {
            let separation = 0,
              mass = 0
            for (const other of major)
              if (branch !== other) {
                separation += other.mass * loss(colorDistance(candidate, other.reference), 0.045)
                mass += other.mass
              }
            return (
              separation / (mass || 1) +
              0.12 * (colorDistance(candidate, branch.seed) / 0.08) ** 2 +
              chromaWeight * chromaRestraint(candidate, branch.mass / largestArea)
            )
          }
          let best = project(branch.reference),
            bestCost = cost(best)
          for (const candidate of pool) {
            const value = cost(candidate)
            if (value < bestCost - 1e-10) {
              best = candidate
              bestCost = value
            }
          }
          branch.reference = best
        }
    }
    const memberships = new Map<string, Branch[]>()
    for (const cut of cuts)
      for (const branch of cut)
        for (const id of branch.ids) {
          const list = memberships.get(id) ?? []
          list.push(branch)
          memberships.set(id, list)
        }
    return { group, pool, project, cuts, memberships, total }
  })
  const variables = states
    .flatMap((state) =>
      [...state.group.weights.keys()].sort().flatMap((id) => {
        const group = state.group
        if (
          id === group.id ||
          group.radius < 0.025 ||
          !group.vertices.some((v) => v.languageId === id && !v.fixed)
        )
          return []
        const seed = seeds.get(id)!
        const branches = state.memberships.get(id) ?? []
        const branch = branches[2]
        const candidates = [...state.pool, seed, ...branches.map((b) => b.reference)]
        // Retain local perturbations around the hierarchy seed as well as full-region candidates.
        for (const dl of [-0.04, 0, 0.04])
          for (const da of [-0.035, 0, 0.035])
            for (const db of [-0.035, 0, 0.035])
              candidates.push(gamutSample(seed.l + dl, seed.a + da, seed.b + db))
        if (chromaWeight)
          for (const factor of [0.45, 0.65, 0.85])
            candidates.push(gamutSample(seed.l, seed.a * factor, seed.b * factor))
        const unique = new Map(
          candidates.map((c) => {
            const p = state.project(c, id)
            return [p.hex, p]
          }),
        )
        unique.set(seed.hex, seed)
        return [
          {
            id,
            state,
            seed,
            branches,
            branch,
            candidates: [...unique.values()],
            edges: incident.get(id) ?? [],
          },
        ]
      }),
    )
    .sort(
      (a, b) =>
        (b.state.group.weights.get(b.id) ?? 0) - (a.state.group.weights.get(a.id) ?? 0) ||
        a.id.localeCompare(b.id),
    )
  let accepted = 0
  for (let pass = 0; pass < 3; pass++)
    for (const variable of variables) {
      const { id, state, seed, branches, branch, candidates, edges } = variable
      const current = colors.get(id)!
      const mass = state.group.weights.get(id) ?? 0
      const cost = (candidate: ColorSample) => {
        let local = 0,
          weight = 0,
          worst = 0
        for (const edge of edges) {
          const a =
            edge.a.fixed ?? (edge.a.languageId === id ? candidate : colors.get(edge.a.languageId)!)
          const b =
            edge.b.fixed ?? (edge.b.languageId === id ? candidate : colors.get(edge.b.languageId)!)
          const penalty = loss(colorDistance(a, b), edge.ga === edge.gb ? 0.06 : 0.16)
          local += edge.weight * penalty
          weight += edge.weight
          worst = Math.max(worst, edge.weight * penalty)
        }
        let coherence = 0
        for (const b of branches) {
          const fraction = mass / (b.mass || 1)
          const next = {
            hex: '',
            l: b.current.l + (candidate.l - current.l) * fraction,
            a: b.current.a + (candidate.a - current.a) * fraction,
            b: b.current.b + (candidate.b - current.b) * fraction,
          }
          for (const peer of b.peers ?? []) {
            if (colorDistance(next, peer.branch.current) < peer.floor - 1e-10)
              return Number.POSITIVE_INFINITY
          }
          // Divide by the member's fraction: even small leaves feel the aggregate
          // branch objective, without making small clades dominate the map.
          coherence +=
            ((colorDistance(next, b.reference) / 0.06) ** 2 -
              (colorDistance(b.current, b.reference) / 0.06) ** 2) /
            Math.max(fraction, 1e-9)
        }
        return (
          local / (weight || 1) +
          0.25 * worst +
          (0.1 * coherence) / Math.max(1, branches.length) +
          0.04 * (colorDistance(candidate, branch?.reference ?? seed) / 0.1) ** 2 +
          chromaWeight * chromaRestraint(candidate, mass / largestArea) +
          0.015 * (colorDistance(candidate, seed) / Math.max(0.025, state.group.radius)) ** 2
        )
      }
      let best = current,
        bestCost = cost(current)
      for (const candidate of candidates) {
        const value = cost(candidate)
        if (value < bestCost - 1e-10) {
          best = candidate
          bestCost = value
        }
      }
      if (best.hex !== current.hex) {
        for (const b of branches) {
          const fraction = mass / (b.mass || 1)
          b.current = {
            hex: '',
            l: b.current.l + (best.l - current.l) * fraction,
            a: b.current.a + (best.a - current.a) * fraction,
            b: b.current.b + (best.b - current.b) * fraction,
          }
        }
        colors.set(id, best)
        accepted++
      }
    }
  return {
    graphMs,
    refineMs: performance.now() - started,
    edges: graph.length,
    crossEdges: graph.filter((e) => e.ga !== e.gb).length,
    accepted,
  }
}
