import type { ReactNode } from 'react'
import './detailsHeader.css'

/** Detail headers show the selected identity, optional layout action, and close. */
export const DetailsHeader = ({
  title,
  titleId,
  subtitle,
  action,
  onClose,
  closeLabel,
  className = '',
  identityClassName = '',
  closeClassName = '',
}: {
  readonly title: string
  readonly titleId?: string
  readonly subtitle?: ReactNode
  readonly action?: ReactNode
  readonly onClose: () => void
  readonly closeLabel: string
  readonly className?: string
  readonly identityClassName?: string
  readonly closeClassName?: string
}) => (
  <header className={`details-header ${className}`}>
    <div className={`details-header__identity ${identityClassName}`} aria-live="polite">
      <h3 id={titleId} className="details-header__title">
        {title}
      </h3>
      {subtitle && <small className="details-header__subtitle">{subtitle}</small>}
    </div>
    {action}
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
