import { type PMTiles, tileIdToZxy } from 'pmtiles'

/** Visit the archive index, including run-length entries, rather than the world grid. */
export const archiveTiles = async (archive: PMTiles, maxZoom: number) => {
  const header = await archive.getHeader()
  const tiles: { z: number; x: number; y: number }[] = []
  const visit = async (offset: number, length: number) => {
    const entries = await archive.cache.getDirectory(archive.source, offset, length, header)
    for (const entry of entries) {
      if (!entry.runLength) {
        await visit(header.leafDirectoryOffset + entry.offset, entry.length)
        continue
      }
      for (let id = entry.tileId; id < entry.tileId + entry.runLength; id++) {
        const [z, x, y] = tileIdToZxy(id)
        if (z > maxZoom) break
        tiles.push({ z, x, y })
      }
    }
  }
  await visit(header.rootDirectoryOffset, header.rootDirectoryLength)
  return tiles.sort((a, b) => a.z - b.z || a.x - b.x || a.y - b.y)
}
