import type { FallbackGeometry } from '../geometry/fallbackGeometry.ts'
import { geometryService } from '../geometry/geometryService.ts'
import { checkTileTestFailure, delayTileTest, diagnosticsEnabled } from './diagnostics.ts'
import { serviceDiagnostics } from './serviceDiagnostics.ts'
import type { TileCoordinate } from './types.ts'

const requestTile = async (
  archiveUrl: string,
  tile: TileCoordinate,
  coverage: readonly TileCoordinate[],
  signal: AbortSignal,
  fallback?: FallbackGeometry,
) => {
  const result = await geometryService.request(
    { kind: 'source', archiveUrl, coverage, tile, ...(fallback ? { fallback } : {}) },
    signal,
  )
  if (result.kind !== 'source') throw new Error('Invalid geometry response')
  if (diagnosticsEnabled) serviceDiagnostics.fallback = result.metrics
  return result.data
}
export const requestSourceTile = (archiveUrl: string, tile: TileCoordinate, signal: AbortSignal) =>
  requestTile(archiveUrl, tile, [], signal)

/** Load the complementary layer for the same atomic MVT as coverage. */
export const requestFallbackTile = async (
  archiveUrl: string,
  coverage: readonly TileCoordinate[],
  tile: TileCoordinate,
  snapshotId: number,
  signal: AbortSignal,
  fallback?: FallbackGeometry,
) => {
  await delayTileTest('fallback', signal)
  checkTileTestFailure('fallback', snapshotId)
  return requestTile(archiveUrl, tile, coverage, signal, fallback)
}
