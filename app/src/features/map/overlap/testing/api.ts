type TileService = 'coverage' | 'fallback'

export interface OverlapTestApi {
  configure(options: {
    languageIds: 'all' | readonly string[]
    center: [number, number]
    zoom: number
  }): void
  camera(center: [number, number], zoom: number, duration?: number): void
  recompute(): void
  failNextPublication(service: TileService): void
  inspect(center: [number, number]): { variantIds: string[]; point: [number, number] }
  reloadStyle(): void
  setTileDelay(service: TileService, milliseconds: number): void
  watchAreas(points: [number, number][] | null): void
  watchStripes(center: [number, number] | null): void
  samplePixels(center: [number, number], radius: number): Promise<number[]>
  probeTileSeams(): Promise<unknown>
  unexpectedMemberships(): string[]
  snapshot(): unknown
}

declare global {
  interface Window {
    overlapTest?: OverlapTestApi
  }
}
