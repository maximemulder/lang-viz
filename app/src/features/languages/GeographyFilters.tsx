import { useAtom, useAtomValue } from 'jotai'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { SidebarPane } from '../../components/SidebarPane'
import type {
  AtlasData,
  GeographyDatasetSelection,
  TemporalViewSelection,
} from '../../domain/atlas'
import { isTemporalViewSelection, TEMPORAL_VIEWS, temporalView } from '../../domain/temporal'
import { atlasDataAtom, geographyDatasetFilterAtom, temporalViewAtom } from '../../state/atlasState'
import { geographyFiltersRequestedAtom } from '../../state/languageControls'

interface GeographySourceFilterProps {
  readonly data: AtlasData
  readonly selection: GeographyDatasetSelection
  readonly temporalSelection: TemporalViewSelection
  readonly onChange: (selection: GeographyDatasetSelection) => void
}

const GeographySourceFilter = ({
  data,
  selection,
  temporalSelection,
  onChange,
}: GeographySourceFilterProps) => {
  const [isOpen, setIsOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const popoverId = useId()
  const selectedIds = selection === 'all' ? data.datasets.map((dataset) => dataset.id) : selection
  const selectedIdSet = new Set(selectedIds)
  const availableDatasetIds = new Set(
    data.variants
      .filter(
        (variant) =>
          temporalSelection === 'all' || variant.temporalCoverage.viewId === temporalSelection,
      )
      .map((variant) => variant.datasetId),
  )
  const summary =
    selection === 'all'
      ? 'All sources'
      : selection.length === 0
        ? 'No sources'
        : selection.length === 1
          ? (data.datasets.find((dataset) => dataset.id === selection[0])?.shortName ?? '1 source')
          : `${selection.length} sources`

  useLayoutEffect(() => {
    if (!isOpen) return
    const root = rootRef.current
    const popover = popoverRef.current
    const trigger = root?.querySelector('button')
    if (!root || !popover || !trigger) return

    // Top-layer popovers escape section scroll clipping; keep them beside their trigger.
    const position = () => {
      if (!trigger.getClientRects().length) {
        popover.hidePopover()
        return
      }
      const rect = trigger.getBoundingClientRect()
      const gap = 5
      const margin = 8
      const width = Math.min(Math.max(rect.width, 240), window.innerWidth - margin * 2)
      popover.style.width = `${width}px`
      popover.style.left = `${Math.max(margin, Math.min(rect.right - width, window.innerWidth - width - margin))}px`
      const below = window.innerHeight - rect.bottom - gap - margin
      const above = rect.top - gap - margin
      const upwards = below < popover.scrollHeight && above > below
      popover.style.maxHeight = `${Math.max(0, upwards ? above : below)}px`
      popover.style.top = `${upwards ? rect.top - gap - popover.offsetHeight : rect.bottom + gap}px`
    }
    position()
    const observer = new ResizeObserver(position)
    observer.observe(root)
    const section = root.closest('details')
    const closeWithSection = () => {
      if (!section?.open) popover.hidePopover()
    }
    section?.addEventListener('toggle', closeWithSection)
    window.addEventListener('resize', position)
    document.addEventListener('scroll', position, true)
    return () => {
      observer.disconnect()
      section?.removeEventListener('toggle', closeWithSection)
      window.removeEventListener('resize', position)
      document.removeEventListener('scroll', position, true)
    }
  }, [isOpen])

  const toggleDataset = (datasetId: string) => {
    const nextIds = selectedIdSet.has(datasetId)
      ? selectedIds.filter((id) => id !== datasetId)
      : [...selectedIds, datasetId]
    onChange(nextIds.length === data.datasets.length ? 'all' : nextIds)
  }

  return (
    <div className="source-filter" ref={rootRef}>
      <span>Geographic sources</span>
      <button
        type="button"
        className="source-filter__trigger"
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        popoverTarget={popoverId}
      >
        <span>{summary}</span>
        <span className="source-filter__chevron" aria-hidden="true">
          ▾
        </span>
      </button>
      <div
        id={popoverId}
        ref={popoverRef}
        popover="auto"
        className="source-filter__popover"
        role="dialog"
        aria-label="Geographic sources"
        onToggle={(event) => setIsOpen(event.currentTarget.matches(':popover-open'))}
      >
        <div className="source-filter__actions">
          <button type="button" onClick={() => onChange('all')}>
            Select all
          </button>
          <button type="button" onClick={() => onChange([])}>
            Clear
          </button>
        </div>
        <div className="source-filter__options">
          {data.datasets.map((dataset) => {
            const availableInPeriod = availableDatasetIds.has(dataset.id)
            return (
              <label
                className={`source-filter__option${
                  availableInPeriod ? '' : ' source-filter__option--unavailable'
                }`}
                key={dataset.id}
              >
                <input
                  type="checkbox"
                  checked={selectedIdSet.has(dataset.id)}
                  onChange={() => toggleDataset(dataset.id)}
                />
                <span>
                  <strong>{dataset.shortName}</strong>
                  <small>
                    {availableInPeriod ? dataset.citation : 'Not available in this period'}
                  </small>
                </span>
              </label>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export const GeographyFilterSummary = () => {
  const data = useAtomValue(atlasDataAtom)
  const datasetFilter = useAtomValue(geographyDatasetFilterAtom)
  const period = useAtomValue(temporalViewAtom)
  const summary =
    datasetFilter === 'all'
      ? 'All sources'
      : datasetFilter.length === 0
        ? 'No sources'
        : datasetFilter.length === 1
          ? (data.datasets.find((dataset) => dataset.id === datasetFilter[0])?.shortName ??
            '1 source')
          : `${datasetFilter.length} sources`
  return (
    <>
      {summary} · {temporalView(period).shortLabel}
    </>
  )
}

export const GeographyFilters = () => {
  const data = useAtomValue(atlasDataAtom)
  const [datasetFilter, setDatasetFilter] = useAtom(geographyDatasetFilterAtom)
  const [period, setPeriod] = useAtom(temporalViewAtom)
  const [requested, setRequested] = useAtom(geographyFiltersRequestedAtom)
  const rootRef = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    if (!requested || !rootRef.current) return
    rootRef.current.open = true
    rootRef.current.querySelector('summary')?.focus({ preventScroll: true })
    setRequested(false)
  }, [requested, setRequested])
  return (
    <SidebarPane
      className="finder-options"
      ref={rootRef}
      title="Data sources"
      summary={<GeographyFilterSummary />}
    >
      <div className="finder-filters">
        <label className="finder-filters__period">
          <span>Geographic period</span>
          <select
            value={period}
            onChange={(event) => {
              if (isTemporalViewSelection(event.currentTarget.value))
                setPeriod(event.currentTarget.value)
            }}
          >
            {TEMPORAL_VIEWS.map((view) => (
              <option key={view.id} value={view.id}>
                {view.label}
              </option>
            ))}
          </select>
        </label>
        <GeographySourceFilter
          data={data}
          selection={datasetFilter}
          temporalSelection={period}
          onChange={setDatasetFilter}
        />
      </div>
      <p className="temporal-note">
        Filters areas to browse and add. Existing map entries keep their sources and periods.{' '}
        {temporalView(period).description}
      </p>
    </SidebarPane>
  )
}
