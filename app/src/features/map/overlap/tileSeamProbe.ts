import { addProtocol, Map as MapLibreMap, removeProtocol } from 'maplibre-gl'
import { COVERAGE_LAYER, deliveryTile, encodeCoverageTile, tileKey } from './delivery.ts'
import type { TileCoordinate } from './types.ts'

const nativeTile = (tile: TileCoordinate) => {
  // Adjacent rows deliberately have different boundary vertices. The canonical
  // rectangles still cover the entire tile exactly, without gaps or overlaps.
  const split = tile.y % 2 ? 6000 : 2000
  return encodeCoverageTile({
    tile,
    extent: 8192,
    vertices: 10,
    features: [0, split].map((left, i) => ({
      type: 'Feature',
      properties: { variantIds: ['test'], pattern: 'test' },
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [
            [
              [left, 0],
              [i ? 8192 : split, 0],
              [i ? 8192 : split, 8192],
              [left, 8192],
              [left, 0],
            ],
          ],
        ],
      },
    })),
  })
}

/** Diagnostic-only synthetic map: every interior pixel must be covered.
 * Keep the unbuffered control to prove that the camera exercises the defect.
 */
export const probeTileSeams = async () => {
  const container = document.createElement('div')
  container.style.cssText = 'position:fixed;inset:0;z-index:9999'
  document.body.append(container)
  addProtocol('atlas-seam-test', async ({ url }) => {
    const [z = 0, x = 0, y = 0, buffered = 0, parent = 0] = url
      .slice('atlas-seam-test://'.length)
      .split('/')
      .map(Number)
    const target = { z, x, y }
    const tiles = parent
      ? [0, 1, 2, 3].map((i) =>
          nativeTile({ z: z + 1, x: x * 2 + (i % 2), y: y * 2 + Math.floor(i / 2) }),
        )
      : [nativeTile(target)]
    return {
      data: deliveryTile(
        new globalThis.Map(tiles.map((t) => [tileKey(t.tile), t])),
        target,
        !!buffered,
      ).slice().buffer as ArrayBuffer,
    }
  })
  const map = new MapLibreMap({
    container,
    center: [0, 40],
    zoom: 3.5,
    attributionControl: false,
    style: { version: 8, sources: {}, layers: [] },
  })
  const results: {
    projection: string
    parent: boolean
    buffered: boolean
    zoom: number
    gaps: number
  }[] = []
  try {
    for (const projection of ['globe', 'mercator'] as const)
      for (const parent of [false, true])
        for (const buffered of [false, true]) {
          map.setStyle(
            {
              version: 8,
              projection: { type: projection },
              sources: {
                test: {
                  type: 'vector',
                  tiles: [`atlas-seam-test://{z}/{x}/{y}/${Number(buffered)}/${Number(parent)}`],
                  maxzoom: parent ? 5 : 6,
                },
              },
              layers: [
                { id: 'background', type: 'background', paint: { 'background-color': '#ff00ff' } },
                {
                  id: 'fill',
                  type: 'fill',
                  source: 'test',
                  'source-layer': COVERAGE_LAYER,
                  paint: { 'fill-color': '#00ff00', 'fill-antialias': false },
                },
              ],
            },
            { diff: false },
          )
          // Parents only serve zoom-out retention; never overzoom an assembled
          // parent in a way that the actual coverage source cannot do.
          for (const zoom of parent ? [2.5, 3.5, 4.5] : [2.5, 3.5, 4.5, 5.5, 6.5]) {
            map.jumpTo({ zoom })
            await new Promise<void>((resolve) => map.once('idle', () => resolve()))
            const gaps = await new Promise<number>((resolve, reject) => {
              map.once('render', () => {
                const canvas = map.getCanvas()
                const gl = canvas.getContext('webgl2')
                if (!gl) return reject(new Error('WebGL2 unavailable'))
                const width = 600,
                  height = 400
                const pixels = new Uint8Array(width * height * 4)
                gl.readPixels(
                  Math.floor((canvas.width - width) / 2),
                  Math.floor((canvas.height - height) / 2),
                  width,
                  height,
                  gl.RGBA,
                  gl.UNSIGNED_BYTE,
                  pixels,
                )
                let count = 0
                for (let i = 0; i < pixels.length; i += 4)
                  if ((pixels[i] ?? 0) > 200 && (pixels[i + 1] ?? 255) < 50) count++
                resolve(count)
              })
              map.triggerRepaint()
            })
            results.push({ projection, parent, buffered, zoom, gaps })
          }
        }
    return results
  } finally {
    map.remove()
    removeProtocol('atlas-seam-test')
    container.remove()
  }
}
