import { checkTileTestFailure, delayTileTest, diagnosticsEnabled } from './diagnostics.ts'
import { FallbackWorkerClient } from './fallbackWorkerClient.ts'
import { serviceDiagnostics } from './serviceDiagnostics.ts'
import type { TileCoordinate } from './types.ts'

const client = new FallbackWorkerClient(
  () => new Worker(new URL('./fallback.worker.ts', import.meta.url), { type: 'module' }),
  (metrics) => {
    if (diagnosticsEnabled) serviceDiagnostics.fallback = metrics
  },
)

export const requestSourceTile = (archiveUrl: string, tile: TileCoordinate, signal: AbortSignal) =>
  client.request({ archiveUrl, coverage: [], tile }, signal)

/** Load the complementary layer for the same atomic MVT as coverage. */
export const requestFallbackTile = async (
  archiveUrl: string,
  coverage: readonly TileCoordinate[],
  tile: TileCoordinate,
  snapshotId: number,
  signal: AbortSignal,
) => {
  await delayTileTest('fallback', signal)
  checkTileTestFailure('fallback', snapshotId)
  return client.request({ archiveUrl, coverage, tile }, signal)
}

if (import.meta.hot)
  import.meta.hot.dispose(() => {
    client.terminate(new Error('Fallback worker reloaded'))
  })
