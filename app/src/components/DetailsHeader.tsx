import type { ReactNode } from 'react'
import type { DetailPanelPlacement } from '../state/detailPanelLayout.ts'
import './detailsHeader.css'

export interface DetailsPanelControls {
  readonly layout: {
    readonly placement: DetailPanelPlacement
    readonly sidebarLabel: string
    readonly onToggle: () => void
  }
  readonly onClose: () => void
}

/** Detail headers show the selected identity, optional layout action, and close. */
export const DetailsHeader = ({
  title,
  titleId,
  subtitle,
  layout,
  onClose,
  closeLabel,
  className = '',
  identityClassName = '',
  closeClassName = '',
}: {
  readonly title: string
  readonly titleId?: string
  readonly subtitle?: ReactNode
  readonly layout?: DetailsPanelControls['layout']
  readonly onClose: () => void
  readonly closeLabel: string
  readonly className?: string
  readonly identityClassName?: string
  readonly closeClassName?: string
}) => {
  const coversSidebar = layout?.placement === 'cover'
  const placementLabel = coversSidebar
    ? `Show ${layout?.sidebarLabel} beside details`
    : `Show details over ${layout?.sidebarLabel}`
  return (
    <header className={`details-header ${className}`}>
      <div className={`details-header__identity ${identityClassName}`} aria-live="polite">
        <h3 id={titleId} className="details-header__title">
          {title}
        </h3>
        {subtitle && <small className="details-header__subtitle">{subtitle}</small>}
      </div>
      {layout && (
        <button
          type="button"
          className="details-header__icon"
          aria-label={placementLabel}
          title={placementLabel}
          onClick={layout.onToggle}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d={coversSidebar ? 'M12 8H4m0 0 3-3M4 8l3 3' : 'M4 8h8m0 0-3-3M12 8l-3 3'}
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
      <button
        type="button"
        className={`details-header__icon ${closeClassName}`}
        aria-label={closeLabel}
        title={closeLabel}
        onClick={onClose}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="m4 4 8 8M12 4l-8 8"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </header>
  )
}
