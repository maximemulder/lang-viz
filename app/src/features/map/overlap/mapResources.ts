import type { ErrorEvent, Map as MapLibreMap, VectorSourceSpecification } from 'maplibre-gl'
import type { CoverageResources } from './controller.ts'
import { COVERAGE_LAYER } from './delivery.ts'
import { type CoverageSnapshot, registerCoverage, releaseCoverage } from './deliveryProtocol.ts'
import { preparePublicationTest } from './diagnostics.ts'
import {
  BUFFERS,
  blendLayerPrefix,
  coverageSourceId,
  fallbackLayerId,
  solidLayerId,
  stripeLayerId,
} from './layerIds.ts'
import { checkPatternBudget, MAX_PATTERN_PIXELS, patternPixels, stripeImage } from './patterns.ts'

export {
  BUFFERS,
  coverageSourceId,
  fallbackLayerId,
  solidLayerId,
  stripeLayerId,
} from './layerIds.ts'

/** Own MapLibre images, source identities, and error/readiness observations. */
export const createMapResources = (
  map: MapLibreMap,
  archiveUrl: string,
  colors: ReadonlyMap<string, string>,
  onSourceFailed: (snapshotId: number) => void,
  drawPatterns: () => boolean = () => true,
): CoverageResources & {
  updateColors(colors: ReadonlyMap<string, string>): void
  prune(): void
  dispose(): void
} => {
  let currentColors = colors
  const ownedPatterns = new Map<string, readonly string[]>()
  const snapshots = new Map<
    number,
    {
      snapshot: CoverageSnapshot
      buffer: 0 | 1
      patterns: Set<string>
      failed: boolean
      retired: boolean
    }
  >()
  const collectReleased = () => {
    for (const [id, entry] of snapshots) {
      if (!entry.retired) continue
      const sourceUrl = (sourceId: string) =>
        (map.getSource(sourceId)?.serialize() as VectorSourceSpecification | undefined)?.tiles?.[0]
      // Controller state changes precede React's source removal. Keep bytes and
      // images until the actual source has stopped referencing this snapshot.
      if (sourceUrl(coverageSourceId(entry.buffer)) === entry.snapshot.url) continue
      snapshots.delete(id)
      releaseCoverage(entry.snapshot)
    }
  }
  const onError = (
    event: ErrorEvent & { sourceId?: string; source?: VectorSourceSpecification },
  ) => {
    for (const entry of snapshots.values()) {
      const url = event.source?.tiles?.[0]
      if (event.sourceId === coverageSourceId(entry.buffer) && url === entry.snapshot.url) {
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
      for (const id of [
        solidLayerId(buffer),
        stripeLayerId(buffer),
        fallbackLayerId(buffer),
        ...layers.filter((id) => id.startsWith(blendLayerPrefix(buffer))),
      ])
        if (layers.indexOf(id) > inspection) map.moveLayer(id, 'inspected-language-areas')
  }
  const patternImage = (members: readonly string[]) => {
    const memberColors = members.map((member) => {
      const color = currentColors.get(member)
      if (!color) throw new Error(`Missing language color for ${member}`)
      return color
    })
    return stripeImage(memberColors)
  }
  const addPattern = (id: string, members: readonly string[]) => {
    map.addImage(id, patternImage(members), { pixelRatio: 1 })
  }
  const restorePattern = ({ id }: { id: string }) => {
    const members = ownedPatterns.get(id)
    if (!members || map.hasImage(id)) return
    try {
      // Style replacement drops runtime images while React restores the sources
      // and layers. Recreate the validated image without repartitioning geometry.
      addPattern(id, members)
    } catch {
      for (const entry of snapshots.values()) {
        if (!entry.patterns.has(id)) continue
        entry.failed = true
        onSourceFailed(entry.snapshot.id)
      }
    }
  }
  map.on('error', onError)
  const onStyleData = () => {
    collectReleased()
    syncLayerOrder()
  }
  map.on('styledata', onStyleData)
  map.on('styleimagemissing', restorePattern)
  syncLayerOrder()
  return {
    updateColors(nextColors) {
      const previousColors = currentColors
      // Retiring snapshots can still contain an aggregate removed by the new
      // selection. Retain its last color until its image is released.
      currentColors = new Map([...currentColors, ...nextColors])
      for (const [id, members] of ownedPatterns) {
        if (
          !map.hasImage(id) ||
          members.every((member) => previousColors.get(member) === currentColors.get(member))
        )
          continue
        // Memberships and image dimensions are unchanged. Refresh pixels in place,
        // keeping delivery snapshots, tile bytes and geometry worker caches intact.
        map.updateImage(id, patternImage(members))
      }
    },
    stage(tiles, buffer) {
      const unique = new Map(
        [...tiles.values()]
          .flatMap((tile) => tile.patterns)
          .filter((p) => drawPatterns() && p.variantIds.length > 1)
          .map((p) => [p.pattern, p]),
      )
      const pixels = [...unique.values()].reduce(
        (sum, p) => sum + patternPixels(p.variantIds.length),
        0,
      )
      checkPatternBudget(pixels)
      let resident = 0
      for (const id of ownedPatterns.keys()) {
        const image = map.getImage(id)?.data
        if (image) resident += (image.width + 2) * (image.height + 2)
      }
      for (const p of unique.values())
        if (!map.hasImage(p.pattern)) resident += patternPixels(p.variantIds.length)
      checkPatternBudget(resident, 2 * MAX_PATTERN_PIXELS)
      for (const p of unique.values()) {
        if (map.hasImage(p.pattern)) continue
        addPattern(p.pattern, p.variantIds)
        ownedPatterns.set(p.pattern, p.variantIds)
      }
      const snapshot = registerCoverage(tiles, archiveUrl)
      preparePublicationTest(snapshot.id)
      snapshots.set(snapshot.id, {
        snapshot,
        buffer,
        patterns: new Set(unique.keys()),
        failed: false,
        retired: false,
      })
      return { snapshot, pixels }
    },
    isReady(snapshot, buffer) {
      // Sources can finish an older camera's tiles during a zoom gesture. Keep
      // the visible snapshot stable until the camera and replacement tiles settle.
      if (map.isMoving()) return false
      const source = (id: string) =>
        map.getSource(id)?.serialize() as VectorSourceSpecification | undefined
      const failed = snapshots.get(snapshot.id)?.failed !== false
      return (
        !failed &&
        source(coverageSourceId(buffer))?.tiles?.[0] === snapshot.url &&
        map.isSourceLoaded(coverageSourceId(buffer))
      )
    },
    release(snapshot) {
      const entry = snapshots.get(snapshot.id)
      if (entry) entry.retired = true
      collectReleased()
    },
    prune() {
      collectReleased()
      const sources = BUFFERS.map(coverageSourceId)
      if (sources.some((id) => map.getSource(id) && !map.isSourceLoaded(id))) return
      const referenced = new Set([...snapshots.values()].flatMap((s) => [...s.patterns]))
      for (const id of sources)
        if (map.getSource(id))
          for (const feature of map.querySourceFeatures(id, { sourceLayer: COVERAGE_LAYER }))
            referenced.add(feature.properties.pattern)
      for (const id of ownedPatterns.keys()) {
        if (referenced.has(id)) continue
        if (map.hasImage(id)) map.removeImage(id)
        ownedPatterns.delete(id)
      }
    },
    dispose() {
      map.off('error', onError)
      map.off('styledata', onStyleData)
      map.off('styleimagemissing', restorePattern)
      for (const entry of snapshots.values()) releaseCoverage(entry.snapshot)
      snapshots.clear()
      for (const id of ownedPatterns.keys()) if (map.hasImage(id)) map.removeImage(id)
      ownedPatterns.clear()
    },
  }
}
