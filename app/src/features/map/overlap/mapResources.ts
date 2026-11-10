import type { ErrorEvent, Map as MapLibreMap, VectorSourceSpecification } from 'maplibre-gl'
import { geometryDisplay } from '../geometry/display.ts'
import type { FallbackGeometry } from '../geometry/fallbackGeometry.ts'
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
import { stripeRepeats } from './stripeStyle.ts'
import { StripeTextureClient, type StripeTextureWorker } from './stripeTextureClient.ts'

// Doubled textures hold two default cycles, leaving room for a thicker preset.
const MAX_STRIPE_PATTERN_PIXELS = 4 * MAX_PATTERN_PIXELS
const stripeClients = new WeakMap<MapLibreMap, StripeTextureClient>()
export const stripeTextureState = (map: MapLibreMap) => stripeClients.get(map)?.state()

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
  archiveUrl: string | (() => string),
  colors: ReadonlyMap<string, string>,
  onSourceFailed: (snapshotId: number) => void,
  drawPatterns: () => boolean = () => true,
  createStripeWorker: () => StripeTextureWorker = () =>
    new Worker(new URL('./stripeTexture.worker.ts', import.meta.url), { type: 'module' }),
  geometry?: () => Omit<FallbackGeometry, 'tiles'>,
): CoverageResources & {
  updateColors(colors: ReadonlyMap<string, string>): void
  updateStripeThickness(thickness: number): void
  prune(): void
  dispose(): void
} => {
  let currentColors = colors
  let thickness = 1
  let lastDensity: string | null = null
  const ownedPatterns = new Map<string, readonly string[]>()
  const repeatsByPattern = new Map<string, number>()
  const textures = new StripeTextureClient(
    createStripeWorker,
    (image) => {
      if (!ownedPatterns.has(image.id) || !map.hasImage(image.id)) return
      const { width, height, data } = image
      map.updateImage(image.id, { width, height, data })
      repeatsByPattern.set(image.id, image.repeats)
    },
    (message) => {
      lastDensity = null
      map.fire('error', { error: new Error(message) })
    },
  )
  stripeClients.set(map, textures)
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
    const anchor = map.getLayer('language-highlight-anchor')
      ? 'language-highlight-anchor'
      : 'inspected-language-areas'
    if (!map.getLayer(anchor)) return
    const layers = map.getLayersOrder()
    const inspection = layers.indexOf(anchor)
    for (const buffer of BUFFERS)
      for (const id of [
        solidLayerId(buffer),
        stripeLayerId(buffer),
        fallbackLayerId(buffer),
        ...layers.filter((id) => id.startsWith(blendLayerPrefix(buffer))),
      ])
        if (layers.indexOf(id) > inspection) map.moveLayer(id, anchor)
  }
  const patternImage = (members: readonly string[]) => {
    const memberColors = members.map((member) => {
      const color = currentColors.get(member)
      if (!color) throw new Error(`Missing language color for ${member}`)
      return color
    })
    return stripeImage(memberColors, 2, stripeRepeats(members.length, map.getZoom(), thickness))
  }
  const addPattern = (id: string, members: readonly string[]) => {
    const image = patternImage(members)
    // Data-driven pattern ratios are Uint16 in MapLibre; fractional ratios
    // truncate to zero and make whole overlap faces disappear.
    map.addImage(id, image, { pixelRatio: 1 })
    repeatsByPattern.set(id, stripeRepeats(members.length, map.getZoom(), thickness))
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
  const updateDensity = () => {
    // The texture grid quantizes widths. Equivalent slider values can keep
    // their existing job instead of cancelling and regenerating identical pixels.
    const zoom = map.getZoom()
    const density = Array.from({ length: 41 }, (_, index) =>
      stripeRepeats(index + 2, zoom, thickness),
    ).join(',')
    if (lastDensity === density) return
    lastDensity = density
    // Cancel immediately; prepare only the latest input after this event turn.
    textures.request(() =>
      [...ownedPatterns].flatMap(([id, members]) => {
        const repeats = stripeRepeats(members.length, map.getZoom(), thickness)
        if (!map.hasImage(id) || repeatsByPattern.get(id) === repeats) return []
        return [
          { id, repeats, colors: members.map((member) => currentColors.get(member) ?? '#777777') },
        ]
      }),
    )
  }
  map.on('zoom', updateDensity)
  syncLayerOrder()
  return {
    updateStripeThickness(nextThickness) {
      thickness = nextThickness
      updateDensity()
    },
    updateColors(nextColors) {
      const previousColors = currentColors
      // Retiring snapshots can still contain an aggregate removed by the new
      // selection. Retain its last color until its image is released.
      currentColors = new Map([...currentColors, ...nextColors])
      // Palette changes invalidate generated pixels as well as their density.
      // Cancel any old-color result before refreshing existing textures.
      textures.cancel()
      for (const [id, members] of ownedPatterns) {
        if (
          !map.hasImage(id) ||
          members.every((member) => previousColors.get(member) === currentColors.get(member))
        )
          continue
        // Memberships and image dimensions are unchanged. Refresh pixels in place,
        // keeping delivery snapshots, tile bytes and geometry worker caches intact.
        map.updateImage(id, patternImage(members))
        repeatsByPattern.set(id, stripeRepeats(members.length, map.getZoom(), thickness))
      }
      lastDensity = null
      updateDensity()
    },
    stage(tiles, buffer, scope) {
      const unique = new Map(
        [...tiles.values()]
          .flatMap((tile) => tile.patterns)
          .filter((p) => drawPatterns() && p.variantIds.length > 1)
          .map((p) => [p.pattern, p]),
      )
      const pixels = [...unique.values()].reduce(
        (sum, p) => sum + patternPixels(p.variantIds.length, 2),
        0,
      )
      checkPatternBudget(pixels, MAX_STRIPE_PATTERN_PIXELS)
      let resident = 0
      for (const id of ownedPatterns.keys()) {
        const image = map.getImage(id)?.data
        if (image) resident += (image.width + 2) * (image.height + 2)
      }
      for (const p of unique.values())
        if (!map.hasImage(p.pattern)) resident += patternPixels(p.variantIds.length, 2)
      checkPatternBudget(resident, 2 * MAX_STRIPE_PATTERN_PIXELS)
      for (const p of unique.values()) {
        if (map.hasImage(p.pattern)) continue
        addPattern(p.pattern, p.variantIds)
        ownedPatterns.set(p.pattern, p.variantIds)
      }
      const snapshot = registerCoverage(
        tiles,
        typeof archiveUrl === 'function' ? archiveUrl() : archiveUrl,
        geometry ? { ...geometry(), tiles: scope } : undefined,
      )
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
        geometryDisplay(map).canPublish(snapshot.maxzoom) &&
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
      let removed = false
      for (const id of ownedPatterns.keys()) {
        if (referenced.has(id)) continue
        if (map.hasImage(id)) map.removeImage(id)
        ownedPatterns.delete(id)
        repeatsByPattern.delete(id)
        removed = true
      }
      if (removed) {
        lastDensity = null
        updateDensity()
      }
    },
    dispose() {
      textures.dispose()
      if (stripeClients.get(map) === textures) stripeClients.delete(map)
      map.off('error', onError)
      map.off('styledata', onStyleData)
      map.off('styleimagemissing', restorePattern)
      map.off('zoom', updateDensity)
      for (const entry of snapshots.values()) releaseCoverage(entry.snapshot)
      snapshots.clear()
      for (const id of ownedPatterns.keys()) if (map.hasImage(id)) map.removeImage(id)
      ownedPatterns.clear()
      repeatsByPattern.clear()
    },
  }
}
