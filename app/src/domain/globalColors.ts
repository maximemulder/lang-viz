import {
  branchCoverageSignature,
  decodePrecomputedTile,
} from '../features/map/overlap/precomputed.ts'
import { parseOverlapSelection, type TileCoordinate } from '../features/map/overlap/types.ts'
import { buildGeographyAvailability, mapAreaSelectionKey } from './aggregation.ts'
import type { AtlasData, TemporalViewId } from './atlas.ts'
import { buildBranchMapEntries } from './branches.ts'
import { polygonCells } from './colorGrid.ts'
import {
  type ColorOptimizationInput,
  type OptimizedColors,
  optimizeColors,
} from './colorOptimization.ts'
import { buildColorTopology, buildSemanticPalette, DEFAULT_COLOR_CONFIGURATION } from './colors.ts'
import { buildLanguageHierarchy } from './hierarchy.ts'
import { resolveMapEntries } from './mapEntries.ts'

export interface GlobalColorProfile {
  readonly id: string
  readonly datasetId: string
  readonly viewId: TemporalViewId
}

export const buildGlobalColorModel = (data: AtlasData) => {
  const hierarchy = buildLanguageHierarchy(data.languages)
  const topology = buildColorTopology(hierarchy)
  return { hierarchy, topology, reference: buildSemanticPalette(hierarchy, topology) }
}

/** The canonical recipe for both offline defaults and explicit full-dataset solves.
 * The loader is the only environment-specific part. Tile order, sampling, geometry
 * selection, configuration and reference colors never depend on a camera or pins.
 */
export const buildGlobalColorInput = async (
  data: AtlasData,
  profile: GlobalColorProfile,
  readTile: (path: string, tile: TileCoordinate) => Promise<Uint8Array>,
  model = buildGlobalColorModel(data),
): Promise<{ input: ColorOptimizationInput; coverageSignature: string }> => {
  const coverage = data.manifest.branchCoverage
  if (!coverage || coverage.maxZoom < 3) throw new Error('Full-dataset geometry is unavailable.')
  const { hierarchy, topology, reference } = model
  const context = { sources: [profile.datasetId], period: profile.viewId }
  const availability = buildGeographyAvailability(
    data,
    hierarchy,
    context.period,
    context.sources,
    {},
  )
  const { entries } = buildBranchMapEntries(
    hierarchy.roots.map(({ id }) => id),
    hierarchy,
    availability,
    context,
    topology,
  )
  const signature = await branchCoverageSignature(
    parseOverlapSelection(mapAreaSelectionKey(resolveMapEntries(entries, data, new Map()))),
  )
  if (!signature || !coverage.signatures.includes(signature))
    throw new Error('Full-dataset geometry does not match this catalog.')

  const size = 64
  const occupied = new Map<string, Set<number>>()
  // Eight concurrent reads, consumed in canonical order regardless of arrival order.
  for (let x = 0; x < 8; x++) {
    const tiles = await Promise.all(
      Array.from({ length: 8 }, async (_, y) => {
        const tile = { z: 3, x, y }
        return decodePrecomputedTile(
          await readTile(`${coverage.directory}${signature}/3-${x}-${y}.pbf`, tile),
          tile,
        )
      }),
    )
    for (const tile of tiles)
      for (const feature of tile.features) {
        const cells = new Set<number>()
        for (const polygon of feature.geometry.coordinates) {
          const rings = polygon.map((ring) =>
            ring.map(
              ([px, py]) =>
                [
                  ((tile.tile.x + px / tile.extent) * size) / 8,
                  ((tile.tile.y + py / tile.extent) * size) / 8,
                ] as const,
            ),
          )
          for (const cell of polygonCells(rings, size, size)) cells.add(cell)
        }
        for (const id of feature.properties.variantIds) {
          const languageId = data.variantById.get(id)?.languageId
          if (!languageId) throw new Error(`Unknown geometry variant: ${id}`)
          const set = occupied.get(languageId) ?? new Set<number>()
          for (const cell of cells) set.add(cell)
          occupied.set(languageId, set)
        }
      }
  }
  // Trim empty ocean margins for compact datasets, retaining Mercator coordinates.
  let x0 = size,
    x1 = -1,
    y0 = size,
    y1 = -1
  for (const cells of occupied.values())
    for (const cell of cells) {
      const x = cell % size,
        y = Math.floor(cell / size)
      x0 = Math.min(x0, x)
      x1 = Math.max(x1, x)
      y0 = Math.min(y0, y)
      y1 = Math.max(y1, y)
    }
  if (x1 < x0 || y1 < y0) throw new Error(`No full-dataset geometry for ${profile.id}.`)
  const columns = x1 - x0 + 1,
    rows = y1 - y0 + 1
  return {
    coverageSignature: signature,
    input: {
      topology,
      reference,
      configuration: DEFAULT_COLOR_CONFIGURATION,
      view: {
        columns,
        rows,
        footprints: [...occupied]
          .filter(([, cells]) => cells.size)
          .map(([languageId, cells]) => ({
            id: languageId,
            languageId,
            cells: [...cells].map((c) => (Math.floor(c / size) - y0) * columns + (c % size) - x0),
          })),
      },
    },
  }
}

/** Complete catalog output also replaces colors from any earlier regional solve. */
export const optimizeGlobalColors = (
  input: ColorOptimizationInput,
  profile: GlobalColorProfile,
): OptimizedColors => {
  const result = optimizeColors(input)
  return {
    ...result,
    datasetProfile: profile.id,
    colors: new Map([...input.reference.colors, ...result.colors]),
  }
}
