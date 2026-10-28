import { addProtocol } from 'maplibre-gl'
import { type DeliveryTile, deliveryTile } from './delivery.ts'
import type { TileCoordinate } from './types.ts'

let nextId = 0
const snapshots = new Map<number, ReadonlyMap<string, DeliveryTile>>()

export interface CoverageSnapshot {
  readonly id: number
  readonly url: string
  readonly coverageTiles: readonly TileCoordinate[]
  readonly maxzoom: number
}

/** Snapshots share immutable encoded tile buffers; they never copy the geometry. */
export const registerCoverage = (tiles: ReadonlyMap<string, DeliveryTile>): CoverageSnapshot => {
  const id = ++nextId
  snapshots.set(id, new Map(tiles))
  return {
    id,
    url: `language-overlap://${id}/{z}/{x}/{y}`,
    coverageTiles: [...tiles.values()].map(({ tile }) => tile),
    maxzoom: tiles.values().next().value?.tile.z ?? 0,
  }
}

export const releaseCoverage = (snapshot: CoverageSnapshot) => snapshots.delete(snapshot.id)

addProtocol('language-overlap', async ({ url }, controller) => {
  controller.signal.throwIfAborted()
  const [id, z, x, y] = url.slice('language-overlap://'.length).split('/').map(Number)
  if (
    id === undefined ||
    z === undefined ||
    x === undefined ||
    y === undefined ||
    ![id, z, x, y].every(Number.isInteger)
  )
    throw new Error('Invalid overlap tile URL')
  const tiles = snapshots.get(id)
  // A released staging source may finish an already scheduled request. Empty
  // data is safe: the corresponding source is inactive or being removed.
  const data = tiles ? deliveryTile(tiles, { z, x, y }) : new Uint8Array()
  // MapLibre can transfer the returned buffer. Keep our retained copy intact.
  return { data: data.slice().buffer }
})

if (import.meta.hot) import.meta.hot.dispose(() => snapshots.clear())
