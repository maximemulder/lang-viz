import { useVirtualizer } from '@tanstack/react-virtual'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  areaMode,
  areaStatus,
  areaVariants,
  isAreaAvailable,
  mappedLeavesForLanguage,
} from '../../domain/aggregation'
import type {
  AtlasData,
  GeographyDatasetSelection,
  Language,
  TemporalViewSelection,
} from '../../domain/atlas'
import { searchCatalog } from '../../domain/catalog'
import {
  flattenLanguageHierarchy,
  type HierarchyRow,
  languageAncestors,
} from '../../domain/hierarchy'
import {
  isTemporalViewSelection,
  TEMPORAL_VIEWS,
  temporalQualityLabel,
  temporalView,
} from '../../domain/temporal'
import {
  areaModesAtom,
  atlasDataAtom,
  finderScopeAtom,
  geographyAvailabilityAtom,
  geographyDatasetFilterAtom,
  geometryOverridesAtom,
  languageHierarchyAtom,
  languageQueryAtom,
  selectedMapAreasAtom,
  setGeometryOverrideAtom,
  showLanguagesAtom,
  showMappedLeavesAtom,
  temporalViewAtom,
  toggleVisibleLanguageAtom,
  viewportLanguageIdsAtom,
  visibleLanguageIdsAtom,
} from '../../state/atlasState'

interface LanguageRowProps {
  readonly row: HierarchyRow
  readonly expanded: boolean
  readonly active: boolean
  readonly context: string | null
  readonly onExpand: () => void
  readonly onFocus: () => void
  readonly onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void
}

const LanguageRow = ({
  row,
  expanded,
  active,
  context,
  onExpand,
  onFocus,
  onKeyDown,
}: LanguageRowProps) => {
  const { language } = row
  const visibleIds = useAtomValue(visibleLanguageIdsAtom)
  const availability = useAtomValue(geographyAvailabilityAtom)
  const [modes, setModes] = useAtom(areaModesAtom)
  const toggleVisible = useSetAtom(toggleVisibleLanguageAtom)
  const available = availability.get(language.id)
  if (!available) return null
  const mode = areaMode(available, modes[language.id])
  const variants = areaVariants(available, mode)
  const isVisible = visibleIds.includes(language.id)
  const status = areaStatus(available, mode)
  const canChoose = Boolean(
    (available.own && available.descendants.length) ||
      (!variants.length && (available.own || available.descendants.length)),
  )
  const availabilityLabel = variants.length
    ? `${status}${mode === 'descendants' ? `, ${variants.length} contributors, ${available.uncoveredBranches.length} uncovered branches` : ''}`
    : available.hasAnyAreas
      ? 'No areas for this representation with the selected sources / period'
      : 'No areas available, including descendants'

  return (
    <div
      role="treeitem"
      aria-label={`${language.name}, ${language.level}, ${availabilityLabel}`}
      data-area-mode={mode}
      data-area-status={status}
      aria-level={row.depth + 1}
      aria-posinset={row.position}
      aria-setsize={row.siblingCount}
      aria-expanded={row.childCount ? expanded : undefined}
      aria-checked={isVisible}
      tabIndex={active ? 0 : -1}
      data-tree-key={row.key}
      data-language-id={language.id}
      className={`language-row${active ? ' language-row--active' : ''}`}
      style={{ paddingLeft: `${4 + row.depth * 14}px`, minWidth: `${280 + row.depth * 14}px` }}
      onFocus={onFocus}
      onClick={(event) => {
        event.currentTarget.focus()
        onFocus()
      }}
      onKeyDown={onKeyDown}
    >
      {row.childCount ? (
        <button
          type="button"
          className="language-row__disclosure"
          tabIndex={-1}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${language.name}`}
          onClick={onExpand}
        >
          <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
        </button>
      ) : (
        <span className="language-row__leaf" aria-hidden="true">
          ·
        </span>
      )}
      <span
        className="language-row__identity"
        title={[`${language.name} · ${language.id}`, context].filter(Boolean).join('\n')}
      >
        <span className="language-row__name">
          <span className="language-row__label">{language.name}</span>
          <small className={`language-row__level language-row__level--${language.level}`}>
            {language.level}
          </small>
          {row.childCount > 0 && <small className="language-row__children">{row.childCount}</small>}
        </span>
        {context && <small className="language-row__context">{context}</small>}
      </span>
      {canChoose ? (
        <select
          className="language-row__area-mode"
          aria-label={`Map representation for ${language.name}`}
          title={availabilityLabel}
          tabIndex={active ? 0 : -1}
          value={mode}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) =>
            setModes({
              ...modes,
              [language.id]: event.currentTarget.value === 'own' ? 'own' : 'descendants',
            })
          }
        >
          <option value="own" disabled={!available.own}>
            Own area{!available.own ? ' (unavailable)' : ''}
          </option>
          <option value="descendants" disabled={!available.descendants.length}>
            Descendant areas{!available.descendants.length ? ' (unavailable)' : ''}
          </option>
        </select>
      ) : (
        <span
          className={`language-row__area-status${variants.length ? '' : ' language-row__area-status--unavailable'}`}
          title={availabilityLabel}
        >
          {status}
        </span>
      )}
      <input
        type="checkbox"
        tabIndex={-1}
        aria-label={`Show ${language.name} on map`}
        title={availabilityLabel}
        checked={isVisible}
        disabled={!variants.length && !isVisible}
        style={{ accentColor: mode === 'own' ? available.own?.color : available.color }}
        onChange={() => toggleVisible(language.id)}
      />
    </div>
  )
}

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

export const LanguageFinder = () => {
  const data = useAtomValue(atlasDataAtom)
  const viewportIds = useAtomValue(viewportLanguageIdsAtom)
  const visibleIds = useAtomValue(visibleLanguageIdsAtom)
  const [query, setQuery] = useAtom(languageQueryAtom)
  const [datasetFilter, setDatasetFilter] = useAtom(geographyDatasetFilterAtom)
  const [scope, setScope] = useAtom(finderScopeAtom)
  const [temporalSelection, setTemporalSelection] = useAtom(temporalViewAtom)
  const showLanguages = useSetAtom(showLanguagesAtom)
  const showMappedLeaves = useSetAtom(showMappedLeavesAtom)
  const toggleVisible = useSetAtom(toggleVisibleLanguageAtom)
  const setVisibleIds = useSetAtom(visibleLanguageIdsAtom)
  const overrides = useAtomValue(geometryOverridesAtom)
  const setGeometryOverride = useSetAtom(setGeometryOverrideAtom)
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(new Set())
  const [focusedKey, setFocusedKey] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const pendingFocus = useRef<string | null>(null)
  const hierarchy = useAtomValue(languageHierarchyAtom)
  const availability = useAtomValue(geographyAvailabilityAtom)
  const [modes, setModes] = useAtom(areaModesAtom)
  const mapAreas = useAtomValue(selectedMapAreasAtom)
  const isSearching = Boolean(query.trim())
  const isBrowsingRoots = !isSearching && scope === 'world'
  const viewportSearchIds = useMemo(() => {
    if (scope !== 'viewport') return null
    const visible = new Set(viewportIds)
    return new Set(
      [...availability]
        .filter(([id, available]) =>
          areaVariants(available, areaMode(available, modes[id])).some((variant) =>
            visible.has(variant.languageId),
          ),
        )
        .map(([id]) => id),
    )
  }, [scope, viewportIds, availability, modes])
  const search = useMemo(
    () => searchCatalog(data, query, viewportSearchIds, temporalSelection, datasetFilter),
    [data, query, viewportSearchIds, temporalSelection, datasetFilter],
  )
  const roots = isBrowsingRoots ? hierarchy.roots : search.languages
  const rows = useMemo(
    () => flattenLanguageHierarchy(hierarchy, roots, expandedKeys),
    [hierarchy, roots, expandedKeys],
  )
  const showableIds = roots
    .filter((language) => isAreaAvailable(availability.get(language.id), modes[language.id]))
    .map(({ id }) => id)
  const activeKey = rows.some((row) => row.key === focusedKey) ? focusedKey : rows[0]?.key
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 44,
    overscan: 8,
    getItemKey: (index) => rows[index]?.key ?? index,
  })
  const virtualRows = virtualizer.getVirtualItems()

  // Focus after virtualization mounts a row reached by keyboard or classification navigation.
  useEffect(() => {
    if (!pendingFocus.current) return
    const index = rows.findIndex((row) => row.key === pendingFocus.current)
    if (index < 0) return
    if (!virtualRows.some((row) => row.index === index)) {
      virtualizer.scrollToIndex(index, { align: 'auto' })
      return
    }
    const element = [
      ...(listRef.current?.querySelectorAll<HTMLElement>('[data-tree-key]') ?? []),
    ].find((element) => element.dataset.treeKey === pendingFocus.current)
    if (element) {
      element.focus({ preventScroll: true })
      element.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      element.querySelector('input')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      pendingFocus.current = null
    }
  }, [rows, virtualRows, virtualizer])

  const visibleIdSet = new Set(visibleIds)
  const shownCount = mapAreas.length
  const areAllFilteredSelected =
    showableIds.length > 0 && showableIds.every((id) => visibleIdSet.has(id))
  const toggleFilteredLanguages = () => {
    if (areAllFilteredSelected) {
      const filteredIdSet = new Set(showableIds)
      setVisibleIds(visibleIds.filter((id) => !filteredIdSet.has(id)))
    } else showLanguages(showableIds)
  }
  const toggleExpanded = (key: string) =>
    setExpandedKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const focusRow = (index: number) => {
    const row = rows[index]
    if (!row) return
    pendingFocus.current = row.key
    setFocusedKey(row.key)
    setDetailId(row.language.id)
    virtualizer.scrollToIndex(index, { align: 'auto' })
  }
  const handleTreeKey = (
    event: ReactKeyboardEvent<HTMLElement>,
    row: HierarchyRow,
    index: number,
  ) => {
    if (event.target !== event.currentTarget) return
    switch (event.key) {
      case 'ArrowDown':
        focusRow(Math.min(rows.length - 1, index + 1))
        break
      case 'ArrowUp':
        focusRow(Math.max(0, index - 1))
        break
      case 'Home':
        focusRow(0)
        break
      case 'End':
        focusRow(rows.length - 1)
        break
      case 'ArrowRight':
        if (!row.childCount) return
        if (!expandedKeys.has(row.key)) toggleExpanded(row.key)
        else focusRow(index + 1)
        break
      case 'ArrowLeft':
        if (row.childCount && expandedKeys.has(row.key)) toggleExpanded(row.key)
        else if (row.parentKey)
          focusRow(rows.findIndex((candidate) => candidate.key === row.parentKey))
        break
      case ' ':
        if (
          visibleIdSet.has(row.language.id) ||
          isAreaAvailable(availability.get(row.language.id), modes[row.language.id])
        )
          toggleVisible(row.language.id)
        break
      case 'Enter':
        setDetailId(row.language.id)
        break
      default:
        return
    }
    event.preventDefault()
  }
  const revealInClassification = (language: Language) => {
    const path = [...languageAncestors(hierarchy, language), language]
    const next = new Set(expandedKeys)
    let key = ''
    for (const entry of path) {
      key = key ? `${key}/${entry.id}` : entry.id
      if (entry.id !== language.id) next.add(key)
    }
    setExpandedKeys(next)
    setQuery('')
    setScope('world')
    setFocusedKey(key)
    setDetailId(language.id)
    pendingFocus.current = key
    const nextRows = flattenLanguageHierarchy(hierarchy, hierarchy.roots, next)
    virtualizer.scrollToOffset(nextRows.findIndex((row) => row.key === key) * 44)
  }
  const detail = detailId ? data.languageById.get(detailId) : undefined
  const detailAvailability = detail ? availability.get(detail.id) : undefined
  const mappedLeaves = useMemo(
    () => (detailId ? mappedLeavesForLanguage(detailId, hierarchy, availability) : undefined),
    [detailId, hierarchy, availability],
  )
  const detailMode = detailAvailability
    ? areaMode(detailAvailability, modes[detailId ?? ''])
    : 'own'
  const detailVariants = detailAvailability?.ownVariants ?? []
  const activeVariant =
    detailVariants.find((variant) => variant.id === overrides[detailId ?? '']) ?? detailVariants[0]
  const sourceSummary =
    datasetFilter === 'all'
      ? 'All sources'
      : datasetFilter.length === 0
        ? 'No sources'
        : datasetFilter.length === 1
          ? (data.datasets.find((dataset) => dataset.id === datasetFilter[0])?.shortName ??
            '1 source')
          : `${datasetFilter.length} sources`

  return (
    <aside className="language-finder" aria-label="Language finder">
      <header className="language-finder__header">
        <div>
          <p className="eyebrow">Language layers</p>
          <h2>Explore languages</h2>
        </div>
        <span className="selection-count">
          {shownCount === visibleIds.length
            ? `${shownCount} shown`
            : `${shownCount} of ${visibleIds.length} shown`}
        </span>
      </header>
      <label className="search-field">
        <span className="visually-hidden">Search families, languages and dialects</span>
        <input
          type="search"
          value={query}
          placeholder="Name, alternative name, ISO or Glottocode…"
          onChange={(event) => {
            setQuery(event.currentTarget.value)
            pendingFocus.current = null
            setFocusedKey(null)
            setDetailId(null)
            virtualizer.scrollToOffset(0)
          }}
        />
      </label>
      <details className="finder-options">
        <summary>
          Map filters{' '}
          <span>
            {sourceSummary} · {temporalView(temporalSelection).shortLabel} ·{' '}
            {scope === 'world' ? 'Whole world' : 'Current map'}
          </span>
        </summary>
        <div className="finder-filters">
          <label className="finder-filters__period">
            <span>Geographic period</span>
            <select
              value={temporalSelection}
              onChange={(event) => {
                const value = event.currentTarget.value
                if (isTemporalViewSelection(value)) setTemporalSelection(value)
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
            temporalSelection={temporalSelection}
            onChange={setDatasetFilter}
          />
          <label>
            <span>Area</span>
            <select
              value={scope}
              onChange={(event) => {
                setScope(event.currentTarget.value === 'viewport' ? 'viewport' : 'world')
                pendingFocus.current = null
                setFocusedKey(null)
                virtualizer.scrollToOffset(0)
              }}
            >
              <option value="world">Whole world</option>
              <option value="viewport">Current map ({viewportIds.length})</option>
            </select>
          </label>
        </div>
        <p className="temporal-note">{temporalView(temporalSelection).description}</p>
      </details>
      <div className="finder-actions">
        <p aria-live="polite">
          <strong>{roots.length.toLocaleString()}</strong>{' '}
          {isBrowsingRoots ? 'roots' : roots.length === 1 ? 'match' : 'matches'} ·{' '}
          {showableIds.length.toLocaleString()} mappable
          <small>
            {isBrowsingRoots
              ? `${data.languages.length.toLocaleString()} entries in the classification`
              : 'Expand a match to browse all its children'}
          </small>
        </p>
        <div>
          <button
            type="button"
            onClick={toggleFilteredLanguages}
            disabled={!showableIds.length}
            title="Show these starting entries using their chosen representations. Descendant areas remain one selection."
          >
            {areAllFilteredSelected ? 'Deselect' : 'Select'} {isBrowsingRoots ? 'roots' : 'matches'}
          </button>
          <button type="button" className="button-secondary" onClick={() => setVisibleIds([])}>
            Clear map
          </button>
        </div>
      </div>
      <div
        className="language-list"
        ref={listRef}
        role="tree"
        tabIndex={virtualRows.some((row) => rows[row.index]?.key === activeKey) ? -1 : 0}
        onFocus={(event) => {
          if (event.target === event.currentTarget) focusRow(virtualRows[0]?.index ?? 0)
        }}
        aria-label={isBrowsingRoots ? 'Language classification' : 'Expandable search results'}
      >
        {rows.length === 0 && (
          <p className="finder-empty">
            No matching entries{scope === 'viewport' ? ' in the current map area' : ''}. Try another
            name or identifier.
          </p>
        )}
        <div
          className="language-list__sizer"
          role="presentation"
          style={{ height: `${virtualizer.getTotalSize()}px` }}
        >
          {virtualRows.map((virtualRow) => {
            const row = rows[virtualRow.index]
            if (!row) return null
            const context =
              row.depth === 0 && !isBrowsingRoots
                ? languageAncestors(hierarchy, row.language)
                    .map(({ name }) => name)
                    .join(' › ')
                : null
            return (
              <div
                className="language-list__item"
                role="presentation"
                key={row.key}
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                <LanguageRow
                  row={row}
                  context={context}
                  expanded={expandedKeys.has(row.key)}
                  active={row.key === activeKey}
                  onExpand={() => toggleExpanded(row.key)}
                  onFocus={() => {
                    setFocusedKey(row.key)
                    setDetailId(row.language.id)
                  }}
                  onKeyDown={(event) => handleTreeKey(event, row, virtualRow.index)}
                />
              </div>
            )
          })}
        </div>
      </div>
      <section className="finder-detail" aria-label="Entry details">
        {detail ? (
          <>
            <div className="finder-detail__heading">
              <strong>{detail.name}</strong>
              <small>
                {detail.level} · {detail.id}
                {detail.iso6393 ? ` · ${detail.iso6393}` : ''}
              </small>
            </div>
            <nav className="finder-detail__path" aria-label="Classification ancestors">
              {languageAncestors(hierarchy, detail).map((ancestor) => (
                <button
                  type="button"
                  key={ancestor.id}
                  onClick={() => revealInClassification(ancestor)}
                >
                  {ancestor.name}
                  <span aria-hidden="true"> ›</span>
                </button>
              ))}
            </nav>
            {mappedLeaves && (hierarchy.childrenById.get(detail.id)?.length ?? 0) > 0 && (
              <div className="finder-detail__mapped-leaves">
                <button
                  type="button"
                  disabled={!mappedLeaves.languageIds.length}
                  onClick={() => showMappedLeaves(detail.id)}
                >
                  Show mapped leaves ({mappedLeaves.languageIds.length.toLocaleString()})
                </button>
                <p>
                  Shows the deepest entries with polygons in this entire branch, each with its own
                  color. Uses current sources and period; branches without polygons are omitted.
                  Replaces selections within this branch.
                </p>
              </div>
            )}
            {detailAvailability && (
              <label className="finder-detail__mode">
                <span>Map representation</span>
                <select
                  aria-label={`Map representation for ${detail.name}`}
                  value={detailMode}
                  onChange={(event) =>
                    setModes({
                      ...modes,
                      [detail.id]: event.currentTarget.value === 'own' ? 'own' : 'descendants',
                    })
                  }
                  disabled={!detailAvailability.own && !detailAvailability.descendants.length}
                >
                  <option value="own" disabled={!detailAvailability.own}>
                    Own area{!detailAvailability.own ? ' (unavailable)' : ''}
                  </option>
                  <option value="descendants" disabled={!detailAvailability.descendants.length}>
                    Descendant areas{!detailAvailability.descendants.length ? ' (unavailable)' : ''}
                  </option>
                </select>
              </label>
            )}
            {detailMode === 'descendants' && detailAvailability ? (
              <div className="finder-detail__aggregation">
                <p>
                  {detailAvailability.descendants.length.toLocaleString()} contributing entries ·{' '}
                  {detailAvailability.uncoveredBranches.length.toLocaleString()} uncovered branches
                  with these filters.
                </p>
                <p>Uses the first available area down each branch. Coverage may be incomplete.</p>
                <details>
                  <summary>Contributors and sources</summary>
                  <ul>
                    {detailAvailability.descendants.map((variant) => (
                      <li key={variant.id}>
                        <button
                          type="button"
                          onClick={() => {
                            const contributor = data.languageById.get(variant.languageId)
                            if (contributor) revealInClassification(contributor)
                          }}
                        >
                          {data.languageById.get(variant.languageId)?.name}
                        </button>
                        <small>
                          {variant.label} · {temporalQualityLabel(variant.temporalCoverage.quality)}
                        </small>
                      </li>
                    ))}
                  </ul>
                </details>
                {detailAvailability.uncoveredBranches.length > 0 && (
                  <details>
                    <summary>Uncovered branches</summary>
                    <ul>
                      {detailAvailability.uncoveredBranches.map((entry) => (
                        <li key={entry.id}>
                          <button type="button" onClick={() => revealInClassification(entry)}>
                            {entry.name}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            ) : detailVariants.length > 1 ? (
              <select
                className="language-row__variant"
                aria-label={`Geographic source for ${detail.name}`}
                value={activeVariant?.id}
                onChange={(event) =>
                  setGeometryOverride({
                    languageId: detail.id,
                    variantId: event.currentTarget.value,
                  })
                }
              >
                {detailVariants.map((variant) => (
                  <option key={variant.id} value={variant.id}>
                    {variant.label} · {temporalQualityLabel(variant.temporalCoverage.quality)}
                  </option>
                ))}
              </select>
            ) : (
              <p>
                {activeVariant
                  ? `${activeVariant.label} · ${temporalQualityLabel(activeVariant.temporalCoverage.quality)}`
                  : detail.geometryVariantIds.length
                    ? 'No polygon for selected sources / period'
                    : 'No polygon available'}
              </p>
            )}
            <button
              type="button"
              className="finder-detail__reveal"
              onClick={() => revealInClassification(detail)}
            >
              Show in classification
            </button>
          </>
        ) : (
          <p>
            Own area = supplied polygons. Descendant areas = combined available branches. No areas /
            Filtered out = unavailable. Check a row to show its chosen representation.
          </p>
        )}
      </section>
    </aside>
  )
}

export const LanguageFinderFallback = () => (
  <aside className="language-finder language-finder--loading" aria-busy="true">
    <p className="eyebrow">Language layers</p>
    <h2>Loading catalog…</h2>
    <div className="loading-line" />
    <div className="loading-line loading-line--short" />
  </aside>
)
