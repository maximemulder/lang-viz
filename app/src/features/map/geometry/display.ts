import type { Map as MapLibreMap } from 'maplibre-gl'
import { useSyncExternalStore } from 'react'
import { useMap } from 'react-map-gl/maplibre'
import type { HatchingState } from '../overlap/controller.ts'
import type { CoverageSnapshot } from '../overlap/deliveryProtocol.ts'
import { coverageSourceId } from '../overlap/layerIds.ts'
import { coverageTilesKey } from '../overlap/tiles.ts'
import type { TileCoordinate } from '../overlap/types.ts'

export interface GeometryDisplayState {
  readonly committedTiles: readonly TileCoordinate[]
  readonly target: readonly TileCoordinate[]
  readonly zoom: number
  readonly source: string | null
  readonly snapshot: CoverageSnapshot | null
  readonly selectionKey: string
}

/** The map owns one desired LOD and one committed geometry revision. Preview
 * consumers prepare the replacement alongside fills and join the same commit.
 */
export class GeometryDisplay {
  readonly highlights = new Map<
    string,
    {
      layerId: string
      source: string
      groups: readonly (readonly string[])[]
      variants: readonly string[]
      visible: boolean
      featureState?: boolean
    }
  >()
  private state: GeometryDisplayState = {
    committedTiles: [],
    target: [],
    zoom: 1,
    source: null,
    snapshot: null,
    selectionKey: '[]',
  }
  private readonly listeners = new Set<() => void>()
  private preview: ((zoom: number) => boolean) | undefined
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  readonly getSnapshot = () => this.state
  private emit(state: GeometryDisplayState) {
    this.state = state
    for (const listener of this.listeners) listener()
  }
  target(tiles: readonly TileCoordinate[]) {
    if (coverageTilesKey(tiles) === coverageTilesKey(this.state.target)) return
    this.emit({
      ...this.state,
      target: tiles,
      committedTiles: this.state.snapshot || this.preview ? this.state.committedTiles : tiles,
      zoom:
        this.state.snapshot || this.preview ? this.state.zoom : (tiles[0]?.z ?? this.state.zoom),
    })
  }
  publish(state: HatchingState, selectionKey: string) {
    const snapshot = state.activeBuffer === null ? null : state.snapshots[state.activeBuffer]
    const source =
      snapshot && state.activeBuffer !== null ? coverageSourceId(state.activeBuffer) : null
    if (snapshot === this.state.snapshot && selectionKey === this.state.selectionKey) return
    this.emit({
      ...this.state,
      snapshot,
      source,
      selectionKey,
      zoom:
        snapshot?.maxzoom ??
        (this.preview ? this.state.zoom : this.state.target[0]?.z) ??
        this.state.zoom,
      committedTiles:
        snapshot?.coverageTiles ?? (this.preview ? this.state.committedTiles : this.state.target),
    })
  }
  previewBarrier(ready: (zoom: number) => boolean) {
    this.preview = ready
    return () => {
      if (this.preview === ready) this.preview = undefined
    }
  }
  canPublish(zoom: number) {
    return this.preview?.(zoom) ?? true
  }
  previewReady(zoom: number) {
    if (!this.state.snapshot && this.state.target[0]?.z === zoom && this.state.zoom !== zoom)
      this.emit({ ...this.state, zoom, committedTiles: this.state.target })
  }
}

const displays = new WeakMap<MapLibreMap, GeometryDisplay>()
export const geometryDisplay = (map: MapLibreMap) => {
  let display = displays.get(map)
  if (!display) {
    display = new GeometryDisplay()
    displays.set(map, display)
  }
  return display
}
const absent = new GeometryDisplay()
export const useGeometryDisplay = () => {
  const map = useMap().current?.getMap()
  const display = map ? geometryDisplay(map) : absent
  const state = useSyncExternalStore(display.subscribe, display.getSnapshot)
  return { map, display, state }
}
