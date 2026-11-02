import type { ErrorEvent, Map as MapLibreMap, VectorSourceSpecification } from 'maplibre-gl'
import type { CoverageResources } from './controller.ts'
import { COVERAGE_LAYER } from './delivery.ts'
import { type CoverageSnapshot, registerCoverage, releaseCoverage } from './deliveryProtocol.ts'
import { preparePublicationTest } from './diagnostics.ts'
import { fallbackTilesUrl } from './fallbackProtocol.ts'
import { checkPatternBudget, MAX_PATTERN_PIXELS, patternPixels, stripeImage } from './patterns.ts'

export const BUFFERS = [0, 1] as const
export const coverageSourceId = (buffer: number) => `language-overlap-regions-${buffer}`
export const stripeLayerId = (buffer: number) => `language-overlap-hatching-${buffer}`
export const solidLayerId = (buffer: number) => `language-overlap-solids-${buffer}`
export const fallbackSourceId = (buffer: number) => `language-overlap-fallback-${buffer}`

/** Own MapLibre images, source identities, and error/readiness observations. */
export const createMapResources = (
  map: MapLibreMap,
  archiveUrl: string,
  colors: ReadonlyMap<string, string>,
  onSourceFailed: (snapshotId: number) => void,
): CoverageResources & { prune(): void; dispose(): void } => {
  const ownedPatterns = new Set<string>()
  const snapshots = new Map<
    number,
    {
      snapshot: CoverageSnapshot
      buffer: 0 | 1
      patterns: Set<string>
      failed: boolean
    }
  >()
  const onError = (
    event: ErrorEvent & { sourceId?: string; source?: VectorSourceSpecification },
  ) => {
    for (const entry of snapshots.values()) {
      const url = event.source?.tiles?.[0]
      if (
        (event.sourceId === coverageSourceId(entry.buffer) && url === entry.snapshot.url) ||
        (event.sourceId === fallbackSourceId(entry.buffer) &&
          url === fallbackTilesUrl(archiveUrl, entry.snapshot.coverageTiles, entry.snapshot.id))
      ) {
        entry.failed = true
        onSourceFailed(entry.snapshot.id)
        return
      }
    }
  }
  const syncLayerOrder = () => {
    if (!map.getLayer('inspected-language-areas')) return
    const layers = map.getLayersOrder()
    const inspection = layers.indexOf('inspected-language-areas')
    for (const buffer of BUFFERS)
      for (const id of [solidLayerId(buffer), stripeLayerId(buffer), fallbackSourceId(buffer)])
        if (layers.indexOf(id) > inspection) map.moveLayer(id, 'inspected-language-areas')
  }
  map.on('error', onError)
  map.on('styledata', syncLayerOrder)
  syncLayerOrder()
  return {
    stage(tiles, buffer) {
      const unique = new Map(
        [...tiles.values()]
          .flatMap((tile) => tile.patterns)
          .filter((p) => p.variantIds.length > 1)
          .map((p) => [p.pattern, p]),
      )
      const pixels = [...unique.values()].reduce(
        (sum, p) => sum + patternPixels(p.variantIds.length),
        0,
      )
      checkPatternBudget(pixels)
      let resident = 0
      for (const id of ownedPatterns) {
        const image = map.getImage(id)?.data
        if (image) resident += (image.width + 2) * (image.height + 2)
      }
      for (const p of unique.values())
        if (!map.hasImage(p.pattern)) resident += patternPixels(p.variantIds.length)
      checkPatternBudget(resident, 2 * MAX_PATTERN_PIXELS)
      for (const p of unique.values()) {
        if (map.hasImage(p.pattern)) continue
        const memberColors = p.variantIds.map((id) => {
          const color = colors.get(id)
          if (!color) throw new Error(`Missing language color for ${id}`)
          return color
        })
        map.addImage(p.pattern, stripeImage(memberColors), { pixelRatio: 1 })
        ownedPatterns.add(p.pattern)
      }
      const snapshot = registerCoverage(tiles)
      preparePublicationTest(snapshot.id)
      snapshots.set(snapshot.id, {
        snapshot,
        buffer,
        patterns: new Set(unique.keys()),
        failed: false,
      })
      return { snapshot, pixels }
    },
    readiness(snapshot, buffer) {
      const source = (id: string) =>
        map.getSource(id)?.serialize() as VectorSourceSpecification | undefined
      const failed = snapshots.get(snapshot.id)?.failed !== false
      return {
        coverage:
          !failed &&
          source(coverageSourceId(buffer))?.tiles?.[0] === snapshot.url &&
          map.isSourceLoaded(coverageSourceId(buffer)),
        fallback:
          !failed &&
          source(fallbackSourceId(buffer))?.tiles?.[0] ===
            fallbackTilesUrl(archiveUrl, snapshot.coverageTiles, snapshot.id) &&
          map.isSourceLoaded(fallbackSourceId(buffer)),
      }
    },
    release(snapshot) {
      snapshots.delete(snapshot.id)
      releaseCoverage(snapshot)
    },
    prune() {
      const sources = BUFFERS.map(coverageSourceId)
      if (sources.some((id) => map.getSource(id) && !map.isSourceLoaded(id))) return
      const referenced = new Set([...snapshots.values()].flatMap((s) => [...s.patterns]))
      for (const id of sources)
        if (map.getSource(id))
          for (const feature of map.querySourceFeatures(id, { sourceLayer: COVERAGE_LAYER }))
            referenced.add(feature.properties.pattern)
      for (const id of ownedPatterns) {
        if (referenced.has(id)) continue
        if (map.hasImage(id)) map.removeImage(id)
        ownedPatterns.delete(id)
      }
    },
    dispose() {
      map.off('error', onError)
      map.off('styledata', syncLayerOrder)
      for (const entry of snapshots.values()) releaseCoverage(entry.snapshot)
      snapshots.clear()
      for (const id of ownedPatterns) if (map.hasImage(id)) map.removeImage(id)
      ownedPatterns.clear()
    },
  }
}
