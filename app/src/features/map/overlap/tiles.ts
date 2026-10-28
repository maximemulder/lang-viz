import type { TileCoordinate } from './types.ts'

const MAX_LATITUDE = 85.0511287798066

/** Covered rectangles expressed in a requested fallback tile's integer space. */
export const coverageRectangles = (
  tile: TileCoordinate,
  coverage: readonly TileCoordinate[],
  extent: number,
): [number, number, number, number][] => {
  const rectangles: [number, number, number, number][] = []
  for (const covered of coverage) {
    const scale = 2 ** (tile.z - covered.z)
    const left = Math.max(0, (covered.x * scale - tile.x) * extent)
    const top = Math.max(0, (covered.y * scale - tile.y) * extent)
    const right = Math.min(extent, ((covered.x + 1) * scale - tile.x) * extent)
    const bottom = Math.min(extent, ((covered.y + 1) * scale - tile.y) * extent)
    if (left < right && top < bottom) rectangles.push([left, top, right, bottom])
  }
  return rectangles
}

/** Keep recently visited tiles at the current detail level, without duplicate coverage. */
export const retainCoverageTiles = (
  viewport: readonly TileCoordinate[],
  previous: readonly TileCoordinate[],
  limit = 48,
): TileCoordinate[] => {
  const tiles = new Map<string, TileCoordinate>()
  for (const tile of [...viewport, ...previous]) {
    if (tile.z !== viewport[0]?.z) continue
    const key = `${tile.z}/${tile.x}/${tile.y}`
    if (!tiles.has(key) && tiles.size < limit) tiles.set(key, tile)
  }
  return [...tiles.values()]
}

export const coverageTilesKey = (tiles: readonly TileCoordinate[]) =>
  tiles
    .map(({ z, x, y }) => `${z}/${x}/${y}`)
    .sort()
    .join('|')

const latitudeToTile = (latitude: number, count: number) => {
  const radians = (Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, latitude)) * Math.PI) / 180
  return ((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2) * count
}

/** Work in the same simplified tile coordinates as the map, with bounded viewport work. */
export const tilesForBounds = (
  bounds: { west: number; south: number; east: number; north: number },
  zoom: number,
  maxTiles = 48,
): TileCoordinate[] => {
  const west = bounds.west
  let east = bounds.east
  if (east < west) east += 360
  east = Math.min(east, west + 360)

  for (let z = Math.max(0, Math.min(8, Math.floor(zoom))); z >= 0; z--) {
    const count = 2 ** z
    const minX = Math.floor(((west + 180) / 360) * count)
    const maxX = Math.max(minX, Math.ceil(((east + 180) / 360) * count) - 1)
    const minY = Math.max(0, Math.min(count - 1, Math.floor(latitudeToTile(bounds.north, count))))
    const maxY = Math.max(
      minY,
      Math.min(count - 1, Math.floor(latitudeToTile(bounds.south, count))),
    )
    if (Math.min(count, maxX - minX + 1) * (maxY - minY + 1) > maxTiles) continue

    const tiles: TileCoordinate[] = []
    for (let x = minX; x <= Math.min(maxX, minX + count - 1); x++) {
      for (let y = minY; y <= maxY; y++) {
        tiles.push({ z, x: ((x % count) + count) % count, y })
      }
    }
    return tiles
  }
  return [{ z: 0, x: 0, y: 0 }]
}

export const tilePositionToLngLat = (
  position: readonly number[],
  tile: TileCoordinate,
  extent: number,
): [number, number] => {
  const count = 2 ** tile.z
  const x = (tile.x + (position[0] ?? 0) / extent) / count
  const y = (tile.y + (position[1] ?? 0) / extent) / count
  return [x * 360 - 180, (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI]
}
