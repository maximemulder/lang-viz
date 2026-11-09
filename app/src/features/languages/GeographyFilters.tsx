import { useAtom, useAtomValue } from 'jotai'
import { useEffect, useRef, useState } from 'react'
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

  useEffect(() => {
    if (!isOpen) return

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
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
        onClick={() => setIsOpen((open) => !open)}
      >
        <span>{summary}</span>
        <span className="source-filter__chevron" aria-hidden="true">
          ▾
        </span>
      </button>
      {isOpen && (
        <div className="source-filter__popover" role="dialog" aria-label="Geographic sources">
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
      )}
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
    <details className="finder-options" ref={rootRef}>
      <summary>
        Sources &amp; period{' '}
        <span>
          <GeographyFilterSummary />
        </span>
      </summary>
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
    </details>
  )
}
