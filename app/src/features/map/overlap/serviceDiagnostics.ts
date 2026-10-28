import type { DeliveryMetrics } from './deliveryStore.ts'
import type { FallbackMetrics } from './fallbackCache.ts'

/** Cumulative service counters; payload bytes exclude JS/GPU/GEOS heap overhead. */
export const serviceDiagnostics: {
  nativeRequests: number
  receiver?: { snapshots: number; tiles: number; bytes: number; peakBytes: number }
  delivery?: DeliveryMetrics
  fallback?: FallbackMetrics
} = { nativeRequests: 0 }
