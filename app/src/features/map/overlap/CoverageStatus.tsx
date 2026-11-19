import { useEffect, useState } from 'react'
import type { HatchingState } from './controller'

const PROGRESS_DELAY_MS = 400

export const CoverageStatus = ({
  update,
  error,
  showingCoverage,
  onRetry,
}: {
  readonly update: HatchingState['update']
  readonly error: string
  readonly showingCoverage: boolean
  readonly onRetry: () => void
}) => {
  const [shownSince, setShownSince] = useState<number | null>(null)
  const pendingSince = update && update.phase !== 'ready' ? update.startedAt : null
  useEffect(() => {
    if (pendingSince === null) return
    const delay = Math.max(0, PROGRESS_DELAY_MS - (performance.now() - pendingSince))
    const timer = setTimeout(() => setShownSince(pendingSince), delay)
    return () => clearTimeout(timer)
  }, [pendingSince])

  const showProgress = pendingSince !== null && pendingSince === shownSince
  const status = error ? 'error' : showProgress ? 'loading' : undefined
  const progressMessage =
    update?.phase === 'drawing' ? 'Drawing language areas…' : 'Preparing language areas…'
  return (
    <div className="map-coverage-status" data-status={status}>
      <span role="status" aria-atomic="true">
        {error ? (
          <>
            {error}
            {showingCoverage && <small>Showing available map detail.</small>}
          </>
        ) : showProgress ? (
          progressMessage
        ) : (
          update?.phase === 'ready' &&
          update.startedAt === shownSince && <span className="visually-hidden">Map updated.</span>
        )}
      </span>
      {error && (
        <button type="button" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  )
}
