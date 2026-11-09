import type { Map as MapLibreMap } from 'maplibre-gl'
import { type MapArea, mapAreaMemberships, mapAreaRefinements } from '../../domain/aggregation.ts'
import type {
  ColorOptimizationInput,
  ColorView,
  OptimizedColors,
} from '../../domain/colorOptimization.ts'
import type { MapEntry } from '../../domain/mapEntries.ts'
import { refinedMemberships } from '../../domain/refinement.ts'
import { featureVariantIds, visibleColorLayers } from './inspection.ts'

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

/** Query rendered polygons, not the catalog's discovery/hit layer. Cell boxes
 * retain small islands and thin polygons that point sampling would miss. Screen
 * queries respect clipping, the globe, selected sources/periods, and refinements.
 * This deliberately bounded approximation never fetches or partitions geometry.
 */
export const captureColorView = async (
  map: MapLibreMap,
  areas: readonly MapArea[],
  entries: readonly MapEntry[],
  signal: AbortSignal,
): Promise<ColorView> => {
  if (map.isMoving() || !map.areTilesLoaded() || !map.isStyleLoaded()) {
    throw new Error('Wait for the map to finish loading and moving, then try again.')
  }
  const camera = JSON.stringify([map.getCenter(), map.getZoom(), map.getProjection()])
  const canvas = map.getCanvas()
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  const columns = Math.max(1, Math.min(36, Math.ceil(width / 30)))
  const rows = Math.max(1, Math.min(24, Math.ceil(height / 30)))
  const layers = visibleColorLayers(map)
  const memberships = mapAreaMemberships(areas)
  const refinements = mapAreaRefinements(areas)
  const entryById = new Map(entries.map((entry) => [entry.id, entry]))
  const occupied = new Map<string, number[]>()
  for (let y = 0; y < rows; y++) {
    signal.throwIfAborted()
    if (layers.length)
      for (let x = 0; x < columns; x++) {
        const features = map.queryRenderedFeatures(
          [
            [(x * width) / columns, (y * height) / rows],
            [((x + 1) * width) / columns, ((y + 1) * height) / rows],
          ],
          { layers },
        )
        const ids = new Set(
          features.flatMap(({ properties }) =>
            refinedMemberships(
              featureVariantIds(properties).flatMap((id) =>
                entryById.has(id) ? [id] : (memberships[id] ?? []),
              ),
              refinements,
            ),
          ),
        )
        for (const id of ids) {
          if (!entryById.has(id)) continue
          const cells = occupied.get(id) ?? []
          cells.push(y * columns + x)
          occupied.set(id, cells)
        }
      }
    if (y % 4 === 3) await frame()
  }
  if (
    map.isMoving() ||
    canvas.clientWidth !== width ||
    canvas.clientHeight !== height ||
    camera !== JSON.stringify([map.getCenter(), map.getZoom(), map.getProjection()])
  ) {
    throw new Error('The view changed while capturing colors. Try again when the map is still.')
  }
  return {
    columns,
    rows,
    footprints: [...occupied].flatMap(([id, cells]) => {
      const entry = entryById.get(id)
      return entry
        ? [
            {
              id,
              languageId: entry.languageId,
              cells,
              ...(entry.colorOverride ? { fixedColor: entry.colorOverride } : {}),
            },
          ]
        : []
    }),
  }
}

export const optimizeColorView = (input: ColorOptimizationInput, signal: AbortSignal) =>
  new Promise<OptimizedColors>((resolve, reject) => {
    signal.throwIfAborted()
    const worker = new Worker(new URL('./colorOptimization.worker.ts', import.meta.url), {
      type: 'module',
    })
    const finish = () => {
      worker.terminate()
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
    }
    const abort = () => {
      finish()
      reject(new DOMException('Color optimization cancelled', 'AbortError'))
    }
    const timer = setTimeout(() => {
      finish()
      reject(new Error('Color optimization took too long. Try a smaller view.'))
    }, 60_000)
    signal.addEventListener('abort', abort, { once: true })
    worker.onmessage = ({ data }: MessageEvent<{ result?: OptimizedColors; error?: string }>) => {
      finish()
      if (data.result) resolve(data.result)
      else reject(new Error(data.error ?? 'Color optimization failed'))
    }
    worker.onerror = () => {
      finish()
      reject(new Error('Color optimization could not start. Try again.'))
    }
    try {
      worker.postMessage(input)
    } catch (error) {
      finish()
      reject(error)
    }
  })
