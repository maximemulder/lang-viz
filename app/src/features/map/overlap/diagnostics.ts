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
  coverageSourceMs?: number
  fallbackSourceMs?: number
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

export interface OverlapTestApi {
  configure(options: {
    languageIds: 'all' | readonly string[]
    center: [number, number]
    zoom: number
  }): void
  camera(center: [number, number], zoom: number, duration?: number): void
  recompute(): void
  unexpectedMemberships(): string[]
  snapshot(): unknown
}

declare global {
  interface Window {
    overlapTest?: OverlapTestApi
  }
}
