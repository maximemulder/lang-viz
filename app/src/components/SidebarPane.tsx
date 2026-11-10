import { type ComponentProps, type ReactNode, useId, useState } from 'react'

type PaneHeadingProps = {
  readonly title: ReactNode
  readonly summary?: ReactNode
}

const PaneHeading = ({ title, summary }: PaneHeadingProps) => (
  <span className="sidebar-pane__heading">
    <span className="sidebar-pane__title">{title}</span>
    {summary && <span className="sidebar-pane__summary">{summary}</span>}
  </span>
)

/** Native disclosure keeps its contents mounted, including drafts and scroll positions. */
export const SidebarPane = ({
  title,
  summary,
  children,
  className = '',
  ...props
}: PaneHeadingProps & Omit<ComponentProps<'details'>, 'title'>) => (
  <details {...props} className={`sidebar-pane ${className}`}>
    <summary className="sidebar-pane__header">
      <span className="sidebar-pane__chevron" aria-hidden="true">
        ▸
      </span>
      <PaneHeading title={title} summary={summary} />
    </summary>
    <div className="sidebar-pane__content">{children}</div>
  </details>
)

/** The inspector also needs an independently clickable name and a close action. */
export const SidebarPaneHeader = ({
  title,
  summary,
  expanded,
  onToggle,
  controls,
  toggleLabel,
  actions,
  className = '',
  toggleClassName = '',
}: PaneHeadingProps & {
  readonly expanded: boolean
  readonly onToggle: () => void
  readonly controls: string
  readonly toggleLabel: string
  readonly actions?: ReactNode
  readonly className?: string
  readonly toggleClassName?: string
}) => {
  return (
    <header className={`sidebar-pane__header ${className}`}>
      <button
        type="button"
        className={`sidebar-pane__toggle ${toggleClassName}`}
        aria-label={toggleLabel}
        aria-expanded={expanded}
        aria-controls={controls}
        onClick={onToggle}
      >
        <span className="sidebar-pane__chevron" data-expanded={expanded} aria-hidden="true">
          ▸
        </span>
      </button>
      <div className="sidebar-pane__identity">
        {title}
        {summary && <span className="sidebar-pane__summary">{summary}</span>}
      </div>
      {actions}
    </header>
  )
}

/** A section with an explicit content box lets long lists fill the available space. */
export const SidebarSection = ({
  title,
  summary,
  children,
  id,
  className = '',
  expanded,
  defaultExpanded = true,
  onExpandedChange,
}: PaneHeadingProps & {
  readonly children: ReactNode
  readonly id?: string
  readonly className?: string
  readonly expanded?: boolean
  readonly defaultExpanded?: boolean
  readonly onExpandedChange?: (expanded: boolean) => void
}) => {
  const generatedId = useId()
  const sectionId = id ?? generatedId
  const [localExpanded, setLocalExpanded] = useState(defaultExpanded)
  const isExpanded = expanded ?? localExpanded
  return (
    <section
      id={id}
      className={`sidebar-section ${className}`}
      data-expanded={isExpanded}
      aria-labelledby={`${sectionId}-heading`}
    >
      <button
        type="button"
        id={`${sectionId}-heading`}
        className="sidebar-pane__header sidebar-section__toggle"
        aria-expanded={isExpanded}
        aria-controls={`${sectionId}-content`}
        onClick={() => {
          setLocalExpanded(!isExpanded)
          onExpandedChange?.(!isExpanded)
        }}
      >
        <span className="sidebar-pane__chevron" data-expanded={isExpanded} aria-hidden="true">
          ▸
        </span>
        <PaneHeading title={title} summary={summary} />
      </button>
      <div id={`${sectionId}-content`} className="sidebar-section__content" hidden={!isExpanded}>
        {children}
      </div>
    </section>
  )
}
