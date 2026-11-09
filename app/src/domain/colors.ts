import { clampChroma, converter, displayable, formatHex } from 'culori'
import type { AtlasData, LanguageId } from './atlas.ts'
import { buildFamilyPalette } from './colorHierarchy.ts'
import {
  assignFamilyAnchors,
  buildFamilyLinks,
  type ColorFamily,
  colorHash,
  colorSample,
  type FamilyColorSpace,
  familyCandidates,
  familyColorSpaces,
} from './familyColors.ts'
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

/** Legacy fallback, including entries without directly supplied polygons. */
export const aggregateColor = (languageId: string) => {
  const hue = (colorHash(languageId) % 360) / 60
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
  const globalOwners = ownersForRoots(topology, globalRoots)
  const rootById = ownersForRoots(topology, roots)
  const anchors = new Map<string, string>()
  const spaces = new Map<string, FamilyColorSpace>()
  const assign = (ids: readonly string[], owners: ReadonlyMap<string, string>, global: boolean) => {
    const graph = neighborhoods(owners)
    const occupied = new Map<string, Set<string>>()
    for (const language of hierarchy.languageById.values()) {
      const owner = owners.get(language.id)
      const { latitude, longitude } = language
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
      const cells = occupied.get(owner) ?? new Set<string>()
      cells.add(
        `${((Math.floor((longitude + 180) / 10) % 36) + 36) % 36},${Math.min(17, Math.floor((latitude + 90) / 10))}`,
      )
      occupied.set(owner, cells)
    }
    const maximumArea = Math.max(1, ...[...occupied.values()].map(({ size }) => size))
    const families: ColorFamily[] = [...ids].sort().map((id) => ({
      id,
      reference: colorSample(
        customAnchors[id]
          ? normalizeColor(customAnchors[id])
          : (anchors.get(id) ??
              familyCandidates[colorHash(id) % familyCandidates.length]?.hex ??
              '#777777'),
      ),
      locked: !!customAnchors[id] || (!global && globalRoots.has(id)),
      automatic: 1,
      fixed: [],
      prominence: Math.sqrt((occupied.get(id)?.size ?? 1) / maximumArea),
      prominent: (occupied.get(id)?.size ?? 1) >= Math.max(1.5, 36 * 18 * 0.01, maximumArea * 0.04),
      coverage: (occupied.get(id)?.size ?? 0) / (36 * 18),
      demand: Math.sqrt(Math.min(16, Math.max(0, (topology.mappedLeafCount.get(id) ?? 0) - 1))),
    }))
    const related = new Set<string>()
    for (const family of families) {
      const parent = topology.parentById.get(family.id)
      const parentOwner = parent ? owners.get(parent) : undefined
      if (parentOwner) related.add(JSON.stringify([family.id, parentOwner].sort()))
    }
    const links = buildFamilyLinks(families, (a, b) => {
      const first = families[a]?.id ?? ''
      const second = families[b]?.id ?? ''
      return graph.get(first)?.has(second) ||
        graph.get(second)?.has(first) ||
        related.has(JSON.stringify([first, second].sort()))
        ? 1
        : 0
    })
    const assigned = assignFamilyAnchors(families, links)
    const regions = familyColorSpaces(families, links, assigned)
    families.forEach(({ id }, i) => {
      if (!global && globalRoots.has(id)) return
      anchors.set(id, assigned[i]?.hex ?? '#777777')
      spaces.set(id, regions[i] ?? { radius: 0, planes: [] })
    })
  }
  // Fix global palettes before introducing explicit comparison groups. Their
  // original subdivisions remain reserved, preserving unaffected sibling colors.
  assign(topology.roots, globalOwners, true)
  if (roots.size > globalRoots.size) assign([...roots], rootById, false)
  const colors = new Map<string, string>()
  const orderedRoots = topology.order.filter((id) => roots.has(id))
  for (const root of orderedRoots) {
    const anchor = colorSample(anchors.get(root) ?? '#777777')
    const owners = globalRoots.has(root) ? globalOwners : rootById
    const palette = buildFamilyPalette(
      topology,
      owners,
      root,
      anchor,
      spaces.get(root) ?? { radius: 0, planes: [] },
    )
    for (const [id, color] of palette.colors) {
      if (rootById.get(id) !== root) continue
      colors.set(id, color.hex)
    }
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
