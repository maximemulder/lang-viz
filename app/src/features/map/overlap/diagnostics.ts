import type { OverlapMetrics, OverlapResponse } from './types'

/** Explicit opt-in in production too, so tests measure the shipped bundle. */
export const diagnosticsEnabled = new URLSearchParams(location.search).has('overlap-test')

export const browserMessages: { level: string; message: string }[] = []
if (diagnosticsEnabled) {
  const record = (level: string, message: string) => {
    browserMessages.push({ level, message })
    if (browserMessages.length > 200) browserMessages.shift()
  }
  window.addEventListener('error', (event) => record('pageerror', event.message))
  window.addEventListener('unhandledrejection', (event) =>
    record('pageerror', String(event.reason)),
  )
  for (const level of ['warn', 'error'] as const) {
    const original = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      record(level, args.map(String).join(' '))
      original(...args)
    }
  }
}

interface RequestReport {
  requestId: number
  startedAt: number
  tileCount: number
  selectedCount: number
  outcome: 'pending' | 'ready' | 'error' | 'superseded'
  failure?: string
  workerMs?: number
  dispatchToResponseMs?: number
  responseOverheadMs?: number
  patternsMs?: number
  patternPixels?: number
  sourceReadyMs?: number
  firstRenderMs?: number
  firstCoverageMs?: number
  firstCoverageRenderMs?: number
  publications?: number
  deliveredTiles?: number
  workerRestarts?: number
  buffer?: number
  totalMs?: number
  features?: number
  sharedPatterns?: number
  metrics?: OverlapMetrics
}

const reports: RequestReport[] = []
export const overlapDiagnostics = {
  reports,
  start(requestId: number, tileCount: number, selectedCount: number) {
    if (!diagnosticsEnabled) return
    for (const report of reports) if (report.outcome === 'pending') report.outcome = 'superseded'
    reports.push({
      requestId,
      tileCount,
      selectedCount,
      startedAt: performance.now(),
      outcome: 'pending',
    })
    if (reports.length > 100) reports.shift()
  },
  update(requestId: number, values: Partial<RequestReport>) {
    if (!diagnosticsEnabled) return
    const report = reports.findLast((entry) => entry.requestId === requestId)
    if (report) {
      Object.assign(report, values)
      if (values.outcome === 'error') report.totalMs = performance.now() - report.startedAt
    }
  },
  response(response: OverlapResponse) {
    if (!diagnosticsEnabled) return
    const report = reports.findLast((entry) => entry.requestId === response.requestId)
    if (!report) return
    const dispatchToResponseMs = performance.now() - report.startedAt
    Object.assign(report, {
      workerMs: response.durationMs,
      dispatchToResponseMs,
      // Includes message scheduling/serialization; not a pure transfer benchmark.
      responseOverheadMs: Math.max(0, dispatchToResponseMs - response.durationMs),
      ...('metrics' in response && response.metrics ? { metrics: response.metrics } : {}),
    })
  },
}

type TileService = 'coverage' | 'fallback'
const tileDelays = { coverage: 0, fallback: 0 }
export const setTileDelay = (service: TileService, milliseconds: number) => {
  if (diagnosticsEnabled) tileDelays[service] = milliseconds
}
export const delayTileTest = async (service: TileService, signal: AbortSignal) => {
  if (!diagnosticsEnabled || !tileDelays[service]) return
  await new Promise((resolve) => setTimeout(resolve, tileDelays[service]))
  signal.throwIfAborted()
}
let nextPublicationFailure: TileService | null = null
let tileFailure: { service: TileService; snapshotId: number } | null = null

/** Opt-in regressions exercise the actual protocol and MapLibre error path. */
export const failNextPublication = (service: TileService) => {
  if (diagnosticsEnabled) nextPublicationFailure = service
}
export const preparePublicationTest = (snapshotId: number) => {
  if (!diagnosticsEnabled || !nextPublicationFailure) return
  tileFailure = { service: nextPublicationFailure, snapshotId }
  nextPublicationFailure = null
}
export const checkTileTestFailure = (service: TileService, snapshotId: number) => {
  if (
    !diagnosticsEnabled ||
    tileFailure?.service !== service ||
    tileFailure.snapshotId !== snapshotId
  )
    return
  tileFailure = null
  throw new Error(`Injected ${service} tile failure`)
}
