import { useVirtualizer } from '@tanstack/react-virtual'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { SidebarPane, SidebarSection } from '../../components/SidebarPane'
import { searchCatalog } from '../../domain/catalog'
import { prepareExploreResults } from '../../domain/exploration'
import {
  flattenLanguageHierarchy,
  type HierarchyRow,
  languageAncestors,
} from '../../domain/hierarchy'
import { hasCoverage } from '../../domain/mapGroups'
import {
  atlasDataAtom,
  finderScopeAtom,
  geographyAvailabilityAtom,
  languageHierarchyAtom,
  languageQueryAtom,
  mapEntriesAtom,
  viewportLanguageIdsAtom,
} from '../../state/atlasState'

import {
  languagePanelAtom,
  openLanguageDetailsAtom,
  revealLanguageIdAtom,
} from '../../state/languageControls'
import {
  addSearchSelectionToMapAtom,
  searchColoringAtom,
  searchCoverageAtom,
  searchSelectionAtom,
  selectSearchResultsAtom,
  toggleSearchSelectionAtom,
} from '../../state/searchSelection'
import { GeographyFilters } from './GeographyFilters'
import { useLanguagePreview } from './LanguagePreview'

interface LanguageRowProps {
  readonly row: HierarchyRow
  readonly expanded: boolean
  readonly active: boolean
  readonly context: string | null
  readonly onDetails: () => void
  readonly onExpand: () => void
  readonly onFocus: () => void
  readonly onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void
}

const LanguageRow = ({
  row,
  expanded,
  active,
  context,
  onDetails,
  onExpand,
  onFocus,
  onKeyDown,
}: LanguageRowProps) => {
  const { language } = row
  const selectedIds = useAtomValue(searchSelectionAtom)
  const entries = useAtomValue(mapEntriesAtom)
  const availability = useAtomValue(geographyAvailabilityAtom)
  const coverage = useAtomValue(searchCoverageAtom)
  const panel = useAtomValue(languagePanelAtom)
  const toggleSelected = useSetAtom(toggleSearchSelectionAtom)
  const preview = useLanguagePreview({ languageId: language.id }, panel.view === 'explore')
  const available = availability.get(language.id)
  if (!available) return null
  const usable = hasCoverage(available, coverage)
  const isSelected = selectedIds.includes(language.id)
  const selectedCount = entries.filter(({ languageId }) => languageId === language.id).length
  const status = usable ? 'Area available' : available.hasAnyAreas ? 'Filtered out' : 'No areas'
  const availabilityLabel = usable
    ? coverage === 'branch'
      ? 'Areas available for this entry and its descendants'
      : 'Own area available'
    : available.hasAnyAreas
      ? 'No areas for this coverage with the selected sources / period'
      : 'No areas available, including descendants'

  return (
    <div
      {...preview}
      role="treeitem"
      aria-label={`${language.name}, ${language.level}, ${availabilityLabel}`}
      data-area-mode={coverage}
      data-area-status={status}
      aria-level={row.depth + 1}
      aria-posinset={row.position}
      aria-setsize={row.siblingCount}
      aria-expanded={row.childCount ? expanded : undefined}
      aria-checked={isSelected}
      tabIndex={active ? 0 : -1}
      data-tree-key={row.key}
      data-language-id={language.id}
      data-inspected={panel.detailId === language.id}
      className={`language-row${active ? ' language-row--active' : ''}${usable ? '' : ' language-row--unavailable'}`}
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
      <button
        type="button"
        aria-label={`Details for ${language.name}`}
        aria-current={panel.detailId === language.id ? 'true' : undefined}
        tabIndex={active ? 0 : -1}
        onClick={(event) => {
          event.stopPropagation()
          onDetails()
        }}
        className="language-row__identity"
        title={[`${language.name} · ${language.level} · ${language.id}`, context]
          .filter(Boolean)
          .join('\n')}
      >
        <span className="language-row__name">
          <span className="language-row__label">{language.name}</span>
          {language.classification.kind === 'source' && (
            <small
              className="language-row__children"
              title="Defined by the source; no matched Glottocode"
            >
              source-defined
            </small>
          )}
          {row.childCount > 0 && <small className="language-row__children">{row.childCount}</small>}
          {selectedCount > 0 && (
            <small className="language-row__children">{selectedCount} on map</small>
          )}
        </span>
        {context && <small className="language-row__context">{context}</small>}
      </button>
      {!usable && (
        <span
          className="language-row__area-status language-row__area-status--unavailable"
          title={availabilityLabel}
        >
          {status}
        </span>
      )}
      <input
        type="checkbox"
        tabIndex={-1}
        aria-label={`Select ${language.name}`}
        title={`${availabilityLabel}. Select for a bulk action; the map stays as it is until Add to map.`}
        checked={isSelected}
        disabled={!usable && !isSelected}
        onChange={() => toggleSelected(language.id)}
      />
    </div>
  )
}

export const ExploreLanguages = () => {
  const data = useAtomValue(atlasDataAtom)
  const viewportIds = useAtomValue(viewportLanguageIdsAtom)
  const [selectedIds, setSelectedIds] = useAtom(searchSelectionAtom)
  const [query, setQuery] = useAtom(languageQueryAtom)
  const [scope, setScope] = useAtom(finderScopeAtom)
  const selectResults = useSetAtom(selectSearchResultsAtom)
  const toggleSelected = useSetAtom(toggleSearchSelectionAtom)
  const addSelection = useSetAtom(addSearchSelectionToMapAtom)
  const [coverage, setCoverage] = useAtom(searchCoverageAtom)
  const [coloring, setColoring] = useAtom(searchColoringAtom)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [searchExpanded, setSearchExpanded] = useState(true)
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(new Set())
  const [focusedKey, setFocusedKey] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const pendingFocus = useRef<string | null>(null)
  const hierarchy = useAtomValue(languageHierarchyAtom)
  const availability = useAtomValue(geographyAvailabilityAtom)
  const openDetails = useSetAtom(openLanguageDetailsAtom)
  const [revealId, setRevealId] = useAtom(revealLanguageIdAtom)
  const panel = useAtomValue(languagePanelAtom)
  const isSearching = Boolean(query.trim())
  const isBrowsingRoots = !isSearching && scope === 'world'
  const matches = useMemo(
    () => searchCatalog(data.languageSearchIndex, query),
    [data.languageSearchIndex, query],
  )
  const searchViewportIds = useMemo(
    () => (scope === 'viewport' ? new Set(viewportIds) : null),
    [scope, viewportIds],
  )
  const { roots, showableIds } = useMemo(
    () =>
      prepareExploreResults({
        matches,
        hierarchy,
        browseRoots: isBrowsingRoots,
        viewportLanguageIds: searchViewportIds,
        availability,
        modes: {},
        coverage,
      }),
    [matches, hierarchy, isBrowsingRoots, searchViewportIds, availability, coverage],
  )
  const rows = useMemo(
    () => flattenLanguageHierarchy(hierarchy, roots, expandedKeys),
    [hierarchy, roots, expandedKeys],
  )
  const activeKey = rows.some((row) => row.key === focusedKey) ? focusedKey : rows[0]?.key
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => listRef.current,
    // Section resizing and virtual row measurement must settle in separate frames.
    useAnimationFrameWithResizeObserver: true,
    estimateSize: () => 44,
    overscan: 8,
    getItemKey: (index) => rows[index]?.key ?? index,
  })
  const virtualRows = virtualizer.getVirtualItems()

  // Focus after virtualization mounts a row reached by keyboard or classification navigation.
  useEffect(() => {
    if (panel.view !== 'explore' || !pendingFocus.current) return
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
  }, [rows, virtualRows, virtualizer, panel.view])

  const selectedIdSet = new Set(selectedIds)
  const areAllFilteredSelected =
    showableIds.length > 0 && showableIds.every((id) => selectedIdSet.has(id))
  const resultIds = new Set(roots.map(({ id }) => id))
  const selectedInResults = selectedIds.filter((id) => resultIds.has(id)).length
  const mappableSelected = selectedIds.filter((id) =>
    hasCoverage(availability.get(id), coverage),
  ).length
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
          selectedIdSet.has(row.language.id) ||
          hasCoverage(availability.get(row.language.id), coverage)
        )
          toggleSelected(row.language.id)
        break
      case 'Enter':
        openDetails(row.language.id)
        break
      default:
        return
    }
    event.preventDefault()
  }
  useEffect(() => {
    if (panel.view !== 'explore' || !revealId) return
    const language = data.languageById.get(revealId)
    if (!language) {
      setRevealId(null)
      return
    }
    setSearchExpanded(true)
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
    pendingFocus.current = key
    setRevealId(null)
  }, [panel.view, revealId, data, hierarchy, expandedKeys, setQuery, setScope, setRevealId])
  return (
    <div className="explore-view">
      <div className="explore-controls">
        <GeographyFilters />
      </div>
      <SidebarSection
        id="explore-search"
        className="explore-search"
        title="Search"
        expanded={searchExpanded}
        onExpandedChange={setSearchExpanded}
      >
        <div className="explore-search-controls">
          <label className="search-field">
            <span className="visually-hidden">Search families, languages and dialects</span>
            <input
              type="search"
              value={query}
              placeholder="Name, alternative name, ISO or catalog ID…"
              onChange={(event) => {
                setQuery(event.currentTarget.value)
                setSearchExpanded(true)
                pendingFocus.current = null
                setFocusedKey(null)
                virtualizer.scrollToOffset(0)
              }}
            />
          </label>
          <label className="finder-scope">
            <span>Search area</span>
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
                className="button-secondary"
                onClick={() => {
                  selectResults(showableIds)
                  setFeedback(null)
                }}
                disabled={!showableIds.length || areAllFilteredSelected}
                title="Select all mappable results, including those beyond the visible list. Expanded children are selected separately."
              >
                Select all
              </button>
            </div>
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
              No matching entries{scope === 'viewport' ? ' in the current map area' : ''}. Try
              another name or identifier.
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
                    }}
                    onDetails={() => openDetails(row.language.id)}
                    onKeyDown={(event) => handleTreeKey(event, row, virtualRow.index)}
                  />
                </div>
              )
            })}
          </div>
        </div>
      </SidebarSection>
      <footer className="finder-actions explore-footer">
        <div className="finder-bulk">
          <p aria-live="polite">
            <strong>{selectedIds.length.toLocaleString()} selected</strong> ·{' '}
            {selectedInResults.toLocaleString()} in these results
          </p>
          <div className="finder-bulk__actions">
            <button
              type="button"
              className="button-secondary"
              disabled={!selectedIds.length}
              onClick={() => {
                setSelectedIds([])
                setFeedback(null)
              }}
            >
              Clear selection
            </button>
            <button
              type="button"
              className="finder-add"
              disabled={!mappableSelected}
              onClick={() => {
                const result = addSelection()
                setFeedback(
                  result.addedAreas
                    ? `Added ${result.addedAreas.toLocaleString()} areas${result.addedGroups ? ` in ${result.addedGroups.toLocaleString()} new groups` : ''}.${result.unavailable ? ` ${result.unavailable} selected entries have no area with these settings.` : ''}`
                    : 'These groups are already on the map.',
                )
              }}
            >
              Add to map
            </button>
          </div>
          <SidebarPane
            className="finder-bulk__coverage"
            title="Add options"
            summary={`${coverage === 'own' ? 'Own area' : 'Entry + descendants'} · ${coloring === 'uniform' ? 'One color' : 'Hierarchy colors'}`}
          >
            <label>
              Coloring
              <select
                aria-label="Coloring for selected entries"
                value={coloring}
                onChange={(event) => {
                  setColoring(event.currentTarget.value === 'uniform' ? 'uniform' : 'hierarchy')
                  setFeedback(null)
                }}
              >
                <option value="hierarchy">Color by hierarchy</option>
                <option value="uniform">One color per group</option>
              </select>
            </label>
            <label>
              Include
              <select
                aria-label="Coverage for selected entries"
                value={coverage}
                onChange={(event) => {
                  setCoverage(event.currentTarget.value === 'own' ? 'own' : 'branch')
                  setFeedback(null)
                }}
              >
                <option value="branch">This entry and its descendants</option>
                <option value="own">Only this entry’s area</option>
              </select>
            </label>
            <p>
              Descendants take precedence where they overlap ancestors; broader coverage remains
              elsewhere. Search area filters results and does not clip added areas.
            </p>
          </SidebarPane>
          {mappableSelected < selectedIds.length && (
            <p>
              {selectedIds.length - mappableSelected} selected entries have no area with the current
              sources, period, and coverage.
            </p>
          )}
        </div>
        {feedback && (
          <p role="status" className="finder-feedback">
            {feedback}
          </p>
        )}
      </footer>
    </div>
  )
}
