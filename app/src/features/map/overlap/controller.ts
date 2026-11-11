import type { GeometryCoverageClient } from '../geometry/geometryService.ts'
import { PUBLICATION_TIMEOUT_MS } from '../geometry/limits.ts'
import { type DeliveryTile, tileKey } from './delivery.ts'
import type { CoverageSnapshot } from './deliveryProtocol.ts'
import type { overlapDiagnostics } from './diagnostics.ts'
import { MAX_COVERAGE_VERTICES } from './limits.ts'
import { OverlapPatternError } from './patterns.ts'
import { coverageTilesKey, retainCoverageTiles } from './tiles.ts'
import type { OverlapRequest, OverlapResponse, TileCoordinate } from './types.ts'
import { parseOverlapSelection } from './types.ts'

export interface HatchingState {
  readonly snapshots: readonly [CoverageSnapshot | null, CoverageSnapshot | null]
  readonly activeBuffer: 0 | 1 | null
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  readonly message: string
}

export interface CoverageResources {
  stage(
    tiles: ReadonlyMap<string, DeliveryTile>,
    buffer: 0 | 1,
    scope: readonly TileCoordinate[],
  ): {
    snapshot: CoverageSnapshot
    pixels: number
  }
  isReady(snapshot: CoverageSnapshot, buffer: 0 | 1): boolean
  release(snapshot: CoverageSnapshot): void
}

interface Publication {
  readonly snapshot: CoverageSnapshot
  readonly tiles: ReadonlyMap<string, DeliveryTile>
  readonly buffer: 0 | 1
  readonly version: number
  readonly stagedAt: number
}

interface Request {
  readonly id: number
  readonly selectionKey: string
  readonly startedAt: number
  phase: 'computing' | 'complete' | 'failed'
  version: number
  error: string
  publicationBlocked: boolean
}

export const idleHatchingState = (): HatchingState => ({
  snapshots: [null, null],
  activeBuffer: null,
  status: 'idle',
  message: '',
})

/** Own computation and publication transitions, independent of React and MapLibre. */
export const createOverlapController = (options: {
  worker: Pick<GeometryCoverageClient, 'postMessage' | 'cancel' | 'terminate' | 'restarts'>
  resources: CoverageResources
  archiveUrl: string | (() => string)
  sourceLayer: string
  onChange(state: HatchingState): void
  onCoverageReady(key: string | null): void
  precomputed?: OverlapRequest['precomputed']
  parts?: (variantIds: readonly string[]) => OverlapRequest['parts']
  diagnostics?: typeof overlapDiagnostics
  nativeFallback?: boolean
}) => {
  const { worker, resources, diagnostics } = options
  let selectionKey = '[]'
  let enabled = false
  let nextRequestId = 0
  let previousKey = ''
  let retained: TileCoordinate[] = []
  let viewportKeys = new Set<string>()
  const results = new Map<string, DeliveryTile>()
  let request: Request | null = null
  let active: Publication | null = null
  let staging: Publication | null = null
  let batch: ReturnType<typeof setTimeout> | undefined
  let deadline: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  let failedSource = false
  let forceReplacement = false

  const report = () => diagnostics?.reports.findLast((entry) => entry.requestId === request?.id)
  const update = (values: Parameters<NonNullable<typeof diagnostics>['update']>[1]) => {
    if (request) diagnostics?.update(request.id, values)
  }
  const emit = () => {
    if (disposed) return
    const snapshots: [CoverageSnapshot | null, CoverageSnapshot | null] = [null, null]
    if (active) snapshots[active.buffer] = active.snapshot
    if (staging) snapshots[staging.buffer] = staging.snapshot
    const status = request?.error
      ? 'error'
      : request?.phase === 'complete' && !staging && active?.version === request.version
        ? 'ready'
        : request
          ? 'loading'
          : 'idle'
    options.onChange({
      snapshots,
      activeBuffer: active?.buffer ?? null,
      status,
      message:
        request?.error ||
        (status === 'ready'
          ? [...results.values()].some((tile) => tile.patterns.some((p) => p.variantIds.length > 1))
            ? 'Shared areas alternate language colors'
            : 'No overlaps in this view'
          : status === 'loading'
            ? 'Updating stripes; solid areas may still contain overlaps.'
            : ''),
    })
  }
  const cancelTimers = () => {
    clearTimeout(batch)
    clearTimeout(deadline)
    batch = undefined
  }
  const discardStaging = () => {
    if (staging) resources.release(staging.snapshot)
    staging = null
  }
  const supersede = () => {
    if (report()?.outcome === 'pending') update({ outcome: 'superseded' })
    cancelTimers()
    discardStaging()
  }
  const changesDetail = () =>
    active !== null &&
    results.size > 0 &&
    results.values().next().value?.tile.z !== active.snapshot.maxzoom
  const fail = (reason: string, message: string, blockPublication: boolean) => {
    if (!request) return
    worker.cancel()
    // Valid prefixes can still need publication after computation fails. Keep
    // their source-loading deadline until they publish or are discarded.
    if (blockPublication || !results.size || (changesDetail() && !staging)) clearTimeout(deadline)
    request.phase = 'failed'
    request.error = message
    request.publicationBlocked ||= blockPublication
    if (blockPublication) {
      clearTimeout(batch)
      batch = undefined
      discardStaging()
    }
    update({ outcome: 'error', failure: reason })
    emit()
  }
  const pruneHistory = () => {
    let changed = false
    for (const key of results.keys()) {
      if (viewportKeys.has(key)) continue
      results.delete(key)
      changed = true
    }
    if (changed) {
      retained = retained.filter((tile) => viewportKeys.has(tileKey(tile)))
      previousKey = JSON.stringify([
        parseOverlapSelection(selectionKey).variantIds,
        coverageTilesKey(retained),
      ])
      if (request) request.version++
    }
    return changed
  }
  const stage = () => {
    clearTimeout(batch)
    batch = undefined
    if (!request || request.publicationBlocked || staging || !results.size) return
    if (active?.version === request.version) return
    // A prefix at a new detail level can replace previously striped areas with
    // solid fallback. Keep the old snapshot until the whole replacement succeeds;
    // a failed prefix stays cached for Retry without degrading the current view.
    if ((changesDetail() || forceReplacement) && request.phase !== 'complete') return
    if (
      request.phase === 'computing' &&
      [...results.values()].every((tile) => !tile.features && !tile.fallback)
    )
      return
    const started = performance.now()
    try {
      const buffer = active?.buffer === 0 ? 1 : 0
      const { snapshot, pixels } = resources.stage(results, buffer, retained)
      staging = {
        snapshot,
        tiles: new Map(results),
        buffer,
        version: request.version,
        stagedAt: performance.now(),
      }
      update({
        patternsMs: (report()?.patternsMs ?? 0) + performance.now() - started,
        patternPixels: pixels,
        features: [...results.values()].reduce((sum, tile) => sum + tile.features, 0),
        sharedPatterns: new Set(
          [...results.values()].flatMap((tile) =>
            tile.patterns.filter((p) => p.variantIds.length > 1).map((p) => p.pattern),
          ),
        ).size,
      })
      emit()
    } catch (error) {
      // Visited tiles are an optional cache. They must not consume the texture
      // budget needed to publish the current viewport.
      if (
        error instanceof OverlapPatternError &&
        error.reason === 'pattern-memory' &&
        pruneHistory()
      ) {
        stage()
        return
      }
      fail(
        error instanceof OverlapPatternError ? error.reason : 'render-error',
        error instanceof Error ? error.message : 'Could not draw overlap stripes.',
        true,
      )
    }
  }
  const publish = () => {
    if (!request || !staging || request.publicationBlocked) return
    const elapsed = performance.now() - staging.stagedAt
    if (!resources.isReady(staging.snapshot, staging.buffer)) return
    const previous = active
    active = staging
    forceReplacement = false
    failedSource = false
    staging = null
    const finished = request.phase === 'complete' && active.version === request.version
    if (request.phase !== 'computing' && active.version === request.version) clearTimeout(deadline)
    update({
      ...(request.error ? {} : { outcome: finished ? 'ready' : 'pending' }),
      firstCoverageMs: report()?.firstCoverageMs ?? performance.now() - request.startedAt,
      publications: (report()?.publications ?? 0) + 1,
      sourceReadyMs: (report()?.sourceReadyMs ?? 0) + elapsed,
      ...(finished ? { totalMs: performance.now() - request.startedAt } : {}),
      buffer: active.buffer,
    })
    emit()
    options.onCoverageReady(request.selectionKey)
    if (previous) resources.release(previous.snapshot)
    if (active.version !== request.version) batch = setTimeout(stage, 32)
  }
  const reset = () => {
    forceReplacement = false
    failedSource = false
    supersede()
    worker.cancel()
    if (active) resources.release(active.snapshot)
    active = null
    request = null
    retained = []
    previousKey = ''
    results.clear()
    options.onCoverageReady(null)
    emit()
  }
  return {
    configure(key: string, hatching: boolean) {
      if (selectionKey === key && enabled === hatching) return
      reset()
      selectionKey = key
      enabled = hatching
    },
    refresh(viewport: readonly TileCoordinate[]) {
      if (disposed) return
      viewportKeys = new Set(viewport.map(tileKey))
      const selection = enabled ? parseOverlapSelection(selectionKey) : { variantIds: [] }
      const { variantIds } = selection
      const tiles = retainCoverageTiles(variantIds.length ? viewport : [], retained)
      const key = JSON.stringify([variantIds, coverageTilesKey(tiles)])
      retained = tiles
      if (key === previousKey) return
      supersede()
      previousKey = key
      if (!tiles.length) {
        reset()
        previousKey = key
        return
      }
      const desired = new Set(tiles.map(tileKey))
      for (const [key, tile] of results) if (!desired.has(key) || tile.fallback) results.delete(key)
      // Reversing a zoom can return to the still-visible snapshot before its
      // replacement finishes. Reuse those native tiles instead of fetching them again.
      let vertices = [...results.values()].reduce((sum, tile) => sum + tile.vertices, 0)
      for (const [key, tile] of (forceReplacement ? [] : active?.tiles) ?? []) {
        if (
          !desired.has(key) ||
          tile.fallback ||
          results.has(key) ||
          vertices + tile.vertices > MAX_COVERAGE_VERTICES
        )
          continue
        results.set(key, tile)
        vertices += tile.vertices
      }
      request = {
        id: ++nextRequestId,
        selectionKey,
        phase: 'computing',
        version: (active?.version ?? 0) + 1,
        startedAt: performance.now(),
        error: '',
        publicationBlocked: false,
      }
      diagnostics?.start(request.id, tiles.length, variantIds.length)
      deadline = setTimeout(
        () =>
          fail(
            'publication-deadline',
            'Stripes took too long to load. Keeping available coverage. Try again.',
            true,
          ),
        PUBLICATION_TIMEOUT_MS,
      )
      emit()
      const parts = options.parts?.(variantIds)
      if (options.nativeFallback)
        for (const tile of tiles) {
          const key = tileKey(tile)
          if (!results.has(key))
            results.set(key, {
              tile,
              fallback: true,
              data: new Uint8Array(),
              renderData: new Uint8Array(),
              patterns: [],
              vertices: 0,
              features: 0,
            })
        }
      worker.postMessage({
        requestId: request.id,
        archiveUrl:
          typeof options.archiveUrl === 'function' ? options.archiveUrl() : options.archiveUrl,
        sourceLayer: options.sourceLayer,
        variantIds,
        ...(selection.variantGroups ? { variantGroups: selection.variantGroups } : {}),
        ...(selection.refinements ? { refinements: selection.refinements } : {}),
        ...(options.precomputed ? { precomputed: options.precomputed } : {}),
        ...(parts ? { parts } : {}),
        tiles,
        knownTiles: [...results].filter(([, tile]) => !tile.fallback).map(([key]) => key),
        ...(diagnostics ? { profile: true } : {}),
      })
      if (options.nativeFallback) stage()
    },
    receive(response: OverlapResponse) {
      if (disposed || response.requestId !== request?.id || request.phase !== 'computing') return
      if ('tile' in response) {
        const key = tileKey(response.tile.tile)
        if (!retained.some((tile) => tileKey(tile) === key)) return
        let vertices =
          [...results.values()].reduce((sum, tile) => sum + tile.vertices, 0) -
          (results.get(key)?.vertices ?? 0) +
          response.tile.vertices
        if (vertices > MAX_COVERAGE_VERTICES && pruneHistory()) {
          if (!viewportKeys.has(key)) return
          vertices =
            [...results.values()].reduce((sum, tile) => sum + tile.vertices, 0) -
            (results.get(key)?.vertices ?? 0) +
            response.tile.vertices
        }
        if (vertices > MAX_COVERAGE_VERTICES) {
          fail(
            'output-vertices',
            'Overlap geometry is too complex. Zoom in or select fewer languages.',
            false,
          )
          stage()
          return
        }
        results.set(key, response.tile)
        request.version++
        update({ deliveredTiles: (report()?.deliveredTiles ?? 0) + 1 })
        if (!staging && batch === undefined)
          batch = setTimeout(stage, Math.max(32, 250 - (performance.now() - request.startedAt)))
        return
      }
      diagnostics?.response(response)
      update({ workerRestarts: worker.restarts })
      if ('error' in response) {
        fail(response.failure, `${response.error} Keeping available coverage.`, false)
        // Publish a valid prefix even if the batch timer already ran while empty.
        stage()
        return
      }
      request.phase = 'complete'
      if (
        active &&
        !failedSource &&
        results.size === active.tiles.size &&
        [...results].every(([key, tile]) => active?.tiles.get(key) === tile)
      ) {
        // A zoom reversal may already be displaying exactly the requested tiles.
        // Mark that publication current without rebuilding its sources or images.
        active = { ...active, version: request.version }
      }
      stage()
      if (!staging && active?.version === request.version && !request.error) {
        clearTimeout(deadline)
        update({
          outcome: 'ready',
          totalMs: performance.now() - request.startedAt,
          buffer: active.buffer,
        })
        emit()
      }
    },
    sourceFailed(snapshotId: number) {
      if (disposed || (staging?.snapshot.id !== snapshotId && active?.snapshot.id !== snapshotId))
        return
      if (active?.snapshot.id === snapshotId) {
        // Loaded tiles remain a coherent geometry revision. Retry replaces the
        // source atomically instead of exposing independently loaded originals.
        failedSource = true
      }
      fail(
        'source-error',
        active
          ? 'New stripes could not load. Keeping the previous view. Try again.'
          : 'Map geometry could not load. Try again.',
        true,
      )
    },
    workerFailed() {
      fail('worker-error', 'Could not calculate stripes. Try again.', false)
      stage()
    },
    publish,
    retry() {
      previousKey = ''
    },
    recompute() {
      supersede()
      worker.cancel()
      request = null
      previousKey = ''
      results.clear()
      // Force fresh worker output while the displayed revision stays coherent.
      // Unlike a selection reset, recomputation must not expose blank/fallback frames.
      forceReplacement = active !== null
      emit()
    },
    dispose() {
      reset()
      disposed = true
      worker.terminate()
    },
  }
}
