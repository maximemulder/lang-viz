import { clampChroma, converter, displayable, formatHex, type Oklch } from 'culori'
import type { AtlasData, LanguageId } from './atlas.ts'
import type { LanguageHierarchy } from './hierarchy.ts'

export interface ColorConfiguration {
  readonly strategy: 'categorical' | 'semantic'
  /** Additional comparison roots. Nested roots start independent palettes. */
  readonly rootIds: readonly LanguageId[]
  /** Subtree seeds; each key also establishes a comparison root. */
  readonly anchors: Readonly<Record<LanguageId, string>>
  /** Exact, non-inherited colors, applied after the automatic strategy. */
  readonly overrides: Readonly<Record<LanguageId, string>>
}

export const DEFAULT_COLOR_CONFIGURATION: ColorConfiguration = {
  strategy: 'semantic',
  rootIds: [],
  anchors: {},
  overrides: {},
}

const oklch = converter('oklch')
const oklab = converter('oklab')

/** Opaque sRGB hex is the common contract for CSS, MapLibre and stripe textures. */
export const normalizeColor = (input: string): string => {
  const color = oklch(input)
  if (
    !color ||
    (color.alpha !== undefined && color.alpha !== 1) ||
    ![color.l, color.c, color.h ?? 0].every(Number.isFinite)
  ) {
    throw new Error(`Expected an opaque color, received: ${input}`)
  }
  // Preserve already-displayable RGB exactly. An OKLCH round trip can put a
  // boundary color such as pure blue microscopically outside the gamut, causing
  // unnecessary chroma reduction and violating the exact-override contract.
  const supplied = displayable(input) ? formatHex(input) : undefined
  return supplied ?? formatHex(clampChroma(color, 'oklch'))
}

export const validateColorConfiguration = (config: ColorConfiguration): ColorConfiguration => {
  if (config.strategy !== 'categorical' && config.strategy !== 'semantic') {
    throw new Error(`Unknown coloring strategy: ${config.strategy}`)
  }
  return {
    ...config,
    rootIds: [...new Set(config.rootIds)],
    anchors: Object.fromEntries(
      Object.entries(config.anchors).map(([id, color]) => [id, normalizeColor(color)]),
    ),
    overrides: Object.fromEntries(
      Object.entries(config.overrides).map(([id, color]) => [id, normalizeColor(color)]),
    ),
  }
}

const hashId = (id: string) => {
  let hash = 0
  for (const character of id) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) | 0
  return hash >>> 0
}

/** Legacy fallback, including entries without directly supplied polygons. */
export const aggregateColor = (languageId: string) => {
  const hue = (hashId(languageId) % 360) / 60
  const chroma = 0.5
  const x = chroma * (1 - Math.abs((hue % 2) - 1))
  const channels =
    hue < 1
      ? [chroma, x, 0]
      : hue < 2
        ? [x, chroma, 0]
        : hue < 3
          ? [0, chroma, x]
          : hue < 4
            ? [0, x, chroma]
            : hue < 5
              ? [x, 0, chroma]
              : [chroma, 0, x]
  return `#${channels
    .map((channel) =>
      Math.round((channel + 0.22) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`
}

export interface ColorTopology {
  readonly order: readonly string[]
  readonly roots: readonly string[]
  readonly parentById: ReadonlyMap<string, string>
  readonly childrenById: ReadonlyMap<string, readonly string[]>
  readonly mappedLeafCount: ReadonlyMap<string, number>
}

/** Iterative, deterministic forest; orphaned/cyclic inputs still receive finite colors. */
export const buildColorTopology = (hierarchy: LanguageHierarchy): ColorTopology => {
  const order: string[] = []
  const roots: string[] = []
  const parentById = new Map<string, string>()
  const childrenById = new Map<string, string[]>()
  const visited = new Set<string>()
  const sorted = (ids: readonly string[]) => [...ids].sort()
  for (const rootId of [
    ...sorted(hierarchy.roots.map(({ id }) => id)),
    ...sorted([...hierarchy.languageById.keys()]),
  ]) {
    if (visited.has(rootId)) continue
    roots.push(rootId)
    const stack: { id: string; parent?: string }[] = [{ id: rootId }]
    while (stack.length) {
      const node = stack.pop()
      if (!node || visited.has(node.id)) continue
      visited.add(node.id)
      order.push(node.id)
      if (node.parent) {
        parentById.set(node.id, node.parent)
        const siblings = childrenById.get(node.parent) ?? []
        siblings.push(node.id)
        childrenById.set(node.parent, siblings)
      }
      const children = sorted((hierarchy.childrenById.get(node.id) ?? []).map(({ id }) => id))
      for (const id of children.reverse()) stack.push({ id, parent: node.id })
    }
  }
  const mappedLeafCount = new Map<string, number>()
  const branchKey = new Map<string, string>()
  for (const id of [...order].reverse()) {
    const children = childrenById.get(id) ?? []
    branchKey.set(id, children.length === 1 ? (branchKey.get(children[0] ?? '') ?? id) : id)
    children.sort((a, b) => (branchKey.get(a) ?? a).localeCompare(branchKey.get(b) ?? b))
    const count = children.reduce((sum, child) => sum + (mappedLeafCount.get(child) ?? 0), 0)
    mappedLeafCount.set(
      id,
      count || (hierarchy.languageById.get(id)?.geometryVariantIds.length ? 1 : 0),
    )
  }
  return { order, roots, parentById, childrenById, mappedLeafCount }
}

/** Bulk search matches may include both an ancestor and all of its descendants. */
export const topmostColorRoots = (ids: readonly string[], topology: ColorTopology): string[] => {
  const wanted = new Set(ids)
  const covered = new Set<string>()
  const roots: string[] = []
  for (const id of topology.order) {
    const parent = topology.parentById.get(id)
    if (parent && covered.has(parent)) covered.add(id)
    else if (wanted.has(id)) {
      roots.push(id)
      covered.add(id)
    }
  }
  return roots
}

const ownersForRoots = (topology: ColorTopology, roots: ReadonlySet<string>) => {
  const owners = new Map<string, string>()
  for (const id of topology.order) {
    const parent = topology.parentById.get(id)
    const owner = roots.has(id) ? id : parent ? owners.get(parent) : undefined
    if (owner) owners.set(id, owner)
  }
  return owners
}

export type ColorNeighborhoods = ReadonlyMap<string, ReadonlySet<string>>
/** Supply polygon occupancy or another proximity model without changing palettes. */
export type ColorNeighborhoodProvider = (owners: ReadonlyMap<string, string>) => ColorNeighborhoods

/** Coarse 10-degree occupied cells, including neighboring cells and longitude wrap.
 * Uses all mapped catalog coordinates, never the viewport or active source filters.
 * This approximates proximity; it does not claim polygon adjacency or km distances.
 */
export const buildColorNeighborhoods = (
  hierarchy: LanguageHierarchy,
  owners: ReadonlyMap<string, string>,
): ColorNeighborhoods => {
  const cells = new Map<string, Set<string>>()
  for (const language of hierarchy.languageById.values()) {
    const { latitude, longitude } = language
    const owner = owners.get(language.id)
    if (
      !owner ||
      !language.geometryVariantIds.length ||
      latitude === null ||
      longitude === null ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90
    )
      continue
    const x = ((Math.floor((longitude + 180) / 10) % 36) + 36) % 36
    const y = Math.min(17, Math.floor((latitude + 90) / 10))
    const key = `${x},${y}`
    const cell = cells.get(key) ?? new Set<string>()
    cell.add(owner)
    cells.set(key, cell)
  }
  const neighbors = new Map<string, Set<string>>()
  for (const [key, ownersHere] of cells) {
    const [x = 0, y = 0] = key.split(',').map(Number)
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const nearby = cells.get(`${(x + dx + 36) % 36},${y + dy}`)
        if (!nearby) continue
        for (const a of ownersHere)
          for (const b of nearby) {
            if (a === b) continue
            const set = neighbors.get(a) ?? new Set<string>()
            set.add(b)
            neighbors.set(a, set)
          }
      }
  }
  return neighbors
}

const palette = Array.from({ length: 24 }, (_, i) =>
  normalizeColor(`oklch(${i < 12 ? 0.61 : 0.73} 0.16 ${(i % 12) * 30 + 15})`),
)
const paletteLab = palette.map((color) => oklab(color))
const distance = (a: ReturnType<typeof oklab>, b: ReturnType<typeof oklab>) =>
  a && b ? Math.hypot(a.l - b.l, a.a - b.a, a.b - b.b) : 0

const assignAnchors = (
  ids: readonly string[],
  neighborhoods: ColorNeighborhoods,
  anchors: Map<string, string>,
) => {
  const ordered = [...ids].sort(
    (a, b) =>
      (neighborhoods.get(b)?.size ?? 0) - (neighborhoods.get(a)?.size ?? 0) || a.localeCompare(b),
  )
  for (const id of ordered) {
    if (anchors.has(id)) continue
    const nearby = [...(neighborhoods.get(id) ?? [])].flatMap((other) => {
      const color = anchors.get(other)
      return color ? [oklab(color)] : []
    })
    const offset = hashId(id) % palette.length
    let best = offset
    let score = -1
    for (let i = 0; i < palette.length; i++) {
      const index = (i + offset) % palette.length
      const minimum = nearby.length
        ? Math.min(...nearby.map((color) => distance(paletteLab[index], color)))
        : 0
      if (minimum > score) {
        best = index
        score = minimum
      }
    }
    anchors.set(id, palette[best] ?? '#777777')
  }
}

export interface SemanticPalette {
  readonly colors: ReadonlyMap<string, string>
  readonly rootById: ReadonlyMap<string, string>
  readonly anchors: ReadonlyMap<string, string>
}

/** Cached independently of filters, selections, custom exact colors, and camera. */
export const buildSemanticPalette = (
  hierarchy: LanguageHierarchy,
  topology: ColorTopology,
  rootIds: readonly string[] = [],
  customAnchors: Readonly<Record<string, string>> = {},
  neighborhoods: ColorNeighborhoodProvider = (owners) => buildColorNeighborhoods(hierarchy, owners),
): SemanticPalette => {
  const globalRoots = new Set(topology.roots)
  const roots = new Set(
    [...globalRoots, ...rootIds, ...Object.keys(customAnchors)].filter((id) =>
      hierarchy.languageById.has(id),
    ),
  )
  const anchors = new Map(
    Object.entries(customAnchors)
      .filter(([id]) => roots.has(id))
      .map(([id, color]) => [id, normalizeColor(color)]),
  )
  // Global anchors are assigned before comparison roots, preserving world palettes
  // when a new subgroup is brought into a comparison.
  assignAnchors(topology.roots, neighborhoods(ownersForRoots(topology, globalRoots)), anchors)
  const rootById = ownersForRoots(topology, roots)
  const comparisonNeighbors = new Map(
    [...neighborhoods(rootById)].map(([id, values]) => [id, new Set(values)]),
  )
  for (const id of roots) {
    const parent = topology.parentById.get(id)
    const parentOwner = parent ? rootById.get(parent) : undefined
    if (parentOwner && parentOwner !== id) {
      const neighbors = comparisonNeighbors.get(id) ?? new Set<string>()
      neighbors.add(parentOwner)
      comparisonNeighbors.set(id, neighbors)
      const parentNeighbors = comparisonNeighbors.get(parentOwner) ?? new Set<string>()
      parentNeighbors.add(id)
      comparisonNeighbors.set(parentOwner, parentNeighbors)
    }
  }
  assignAnchors(
    [...roots].filter((id) => !globalRoots.has(id)),
    comparisonNeighbors,
    anchors,
  )
  const colors = new Map<string, string>()
  // Subdivide all three perceptual dimensions rather than hue alone. Otherwise
  // a wide first split exhausts the hue range before deeper groups are reached.
  type Box = readonly [
    readonly [number, number],
    readonly [number, number],
    readonly [number, number],
  ]
  const boxes = new Map<string, Box>()
  for (const id of topology.order) {
    const root = rootById.get(id)
    const anchor = root ? anchors.get(root) : undefined
    if (!anchor) continue
    const base = oklch(anchor)
    if (!base) continue
    const box: Box = roots.has(id)
      ? [
          [-32, 32],
          [-0.055, 0.055],
          [-base.c * 0.3, base.c * 0.3],
        ]
      : (boxes.get(id) ?? [
          [0, 0],
          [0, 0],
          [0, 0],
        ])
    const midpoints = box.map(([low, high]) => (low + high) / 2)
    const color: Oklch = {
      mode: 'oklch',
      l: Math.max(0, Math.min(1, base.l + (midpoints[1] ?? 0))),
      c: Math.max(0, base.c + (midpoints[2] ?? 0)),
      h: (base.h ?? 0) + (midpoints[0] ?? 0),
    }
    colors.set(id, roots.has(id) ? anchor : formatHex(clampChroma(color, 'oklch')))
    // Reserve slots even for branches that start independent palettes, so a
    // comparison root does not shift the colors of its unaffected siblings.
    const children = topology.childrenById.get(id) ?? []
    const weights = children.map((child) =>
      Math.sqrt(Math.max(1, topology.mappedLeafCount.get(child) ?? 0)),
    )
    const total = weights.reduce((sum, value) => sum + value, 0)
    const scores = box.map(([low, high], axis) => (high - low) / ([64, 0.2, 0.13][axis] ?? 1))
    const axis = scores.indexOf(Math.max(...scores))
    const [low, high] = box[axis] ?? [0, 0]
    let cursor = low
    children.forEach((child, i) => {
      const width = ((high - low) * (weights[i] ?? 1)) / total
      const gap = children.length > 1 ? width * 0.12 : 0
      const next = [...box] as [
        readonly [number, number],
        readonly [number, number],
        readonly [number, number],
      ]
      next[axis] = [cursor + gap, cursor + width - gap]
      boxes.set(child, next)
      cursor += width
    })
  }
  return { colors, rootById, anchors }
}

export const resolveLanguageColors = (
  data: AtlasData,
  config: ColorConfiguration,
  semantic: SemanticPalette,
): ReadonlyMap<string, string> => {
  const result = new Map<string, string>()
  for (const language of data.languages) {
    const supplied = language.geometryVariantIds
      .map((id) => data.variantById.get(id)?.color)
      .find(Boolean)
    const automatic = config.strategy === 'semantic' ? semantic.colors.get(language.id) : supplied
    result.set(
      language.id,
      config.overrides[language.id] !== undefined
        ? normalizeColor(config.overrides[language.id] as string)
        : (automatic ?? aggregateColor(language.id)),
    )
  }
  return result
}
