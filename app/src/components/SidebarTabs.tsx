import { type KeyboardEvent, type ReactNode, useRef } from 'react'
import './sidebarTabs.css'

type Tab<Value extends string> = {
  readonly value: Value
  readonly label: string
  readonly ariaLabel?: string
  readonly badge?: ReactNode
}

export const SidebarTabs = <Value extends string>({
  tabs,
  selected,
  onSelect,
  idPrefix,
  label,
  className = '',
}: {
  readonly tabs: readonly Tab<Value>[]
  readonly selected: Value
  readonly onSelect: (value: Value) => void
  readonly idPrefix: string
  readonly label: string
  readonly className?: string
}) => {
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const handleKey = (event: KeyboardEvent, index: number) => {
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % tabs.length
        : event.key === 'ArrowLeft'
          ? (index + tabs.length - 1) % tabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabs.length - 1
              : undefined
    if (next === undefined) return
    const tab = tabs[next]
    if (!tab) return
    event.preventDefault()
    onSelect(tab.value)
    tabRefs.current[next]?.focus()
  }

  return (
    <div className={`sidebar-tabs ${className}`} role="tablist" aria-label={label}>
      {tabs.map((tab, index) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          id={`${idPrefix}-tab-${tab.value}`}
          aria-controls={`${idPrefix}-panel-${tab.value}`}
          aria-selected={selected === tab.value}
          aria-label={tab.ariaLabel}
          tabIndex={selected === tab.value ? 0 : -1}
          ref={(element) => {
            tabRefs.current[index] = element
          }}
          onClick={() => onSelect(tab.value)}
          onKeyDown={(event) => handleKey(event, index)}
        >
          {tab.label}
          {tab.badge !== undefined && <span>{tab.badge}</span>}
        </button>
      ))}
    </div>
  )
}
