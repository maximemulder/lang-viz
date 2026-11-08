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
  mappedLeavesForLanguages,
} from '../../domain/aggregation'
import { searchCatalog } from '../../domain/catalog'
import { prepareExploreResults } from '../../domain/exploration'
import {
  flattenLanguageHierarchy,
  type HierarchyRow,
  languageAncestors,
} from '../../domain/hierarchy'
import {
  areaModesAtom,
  atlasDataAtom,
  finderScopeAtom,
  geographyAvailabilityAtom,
  languageColorsAtom,
  languageHierarchyAtom,
  languageQueryAtom,
  showLanguagesAtom,
  showMappedLeavesAtom,
  toggleVisibleLanguageAtom,
  viewportLanguageIdsAtom,
  visibleLanguageIdsAtom,
} from '../../state/atlasState'

import {
  languagePanelAtom,
  openLanguageDetailsAtom,
  revealLanguageIdAtom,
} from '../../state/languageControls'

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
  const visibleIds = useAtomValue(visibleLanguageIdsAtom)
  const availability = useAtomValue(geographyAvailabilityAtom)
  const colors = useAtomValue(languageColorsAtom)
  const modes = useAtomValue(areaModesAtom)
  const toggleVisible = useSetAtom(toggleVisibleLanguageAtom)
  const available = availability.get(language.id)
  if (!available) return null
  const mode = areaMode(available, modes[language.id])
  const variants = areaVariants(available, mode)
  const isVisible = visibleIds.includes(language.id)
  const status = variants.length ? areaStatus(available, mode) : 'No area'
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
      className={`language-row${active ? ' language-row--active' : ''}${variants.length ? '' : ' language-row--unavailable'}`}
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
        tabIndex={active ? 0 : -1}
        onClick={(event) => {
          event.stopPropagation()
          onDetails()
        }}
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
      </button>
      <span
        className={`language-row__area-status${variants.length ? '' : ' language-row__area-status--unavailable'}`}
        title={availabilityLabel}
      >
        {status}
      </span>
      <input
        type="checkbox"
        tabIndex={-1}
        aria-label={`Show ${language.name} on map`}
        title={availabilityLabel}
        checked={isVisible}
        disabled={!variants.length && !isVisible}
        style={{ accentColor: colors.get(language.id) }}
        onChange={() => toggleVisible(language.id)}
      />
    </div>
  )
}

export const ExploreLanguages = () => {
  const data = useAtomValue(atlasDataAtom)
  const viewportIds = useAtomValue(viewportLanguageIdsAtom)
  const visibleIds = useAtomValue(visibleLanguageIdsAtom)
  const [query, setQuery] = useAtom(languageQueryAtom)
  const [scope, setScope] = useAtom(finderScopeAtom)
  const showLanguages = useSetAtom(showLanguagesAtom)
  const showMappedLeaves = useSetAtom(showMappedLeavesAtom)
  const toggleVisible = useSetAtom(toggleVisibleLanguageAtom)
  const setVisibleIds = useSetAtom(visibleLanguageIdsAtom)
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(new Set())
  const [focusedKey, setFocusedKey] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const pendingFocus = useRef<string | null>(null)
  const hierarchy = useAtomValue(languageHierarchyAtom)
  const availability = useAtomValue(geographyAvailabilityAtom)
  const modes = useAtomValue(areaModesAtom)
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
        modes,
      }),
    [matches, hierarchy, isBrowsingRoots, searchViewportIds, availability, modes],
  )
  const filteredMappedLeaves = useMemo(
    () =>
      mappedLeavesForLanguages(
        roots.map(({ id }) => id),
        hierarchy,
        availability,
      ),
    [roots, hierarchy, availability],
  )
  const rows = useMemo(
    () => flattenLanguageHierarchy(hierarchy, roots, expandedKeys),
    [hierarchy, roots, expandedKeys],
  )
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

  const visibleIdSet = new Set(visibleIds)
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
            onClick={toggleFilteredLanguages}
            disabled={!showableIds.length}
            title="Show these starting entries using their chosen representations. Descendant areas remain one selection."
          >
            {areAllFilteredSelected ? 'Deselect' : 'Select'} {isBrowsingRoots ? 'roots' : 'matches'}
          </button>
          <button
            type="button"
            disabled={!filteredMappedLeaves.languageIds.length}
            onClick={() => showMappedLeaves(roots.map(({ id }) => id))}
            title={`Show the deepest entries with polygons across all ${isBrowsingRoots ? 'roots' : 'matches'}, each with its own color. Uses current sources and period; replaces selections within these branches.`}
          >
            Show mapped leaves ({filteredMappedLeaves.languageIds.length.toLocaleString()})
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
                  }}
                  onDetails={() => openDetails(row.language.id)}
                  onKeyDown={(event) => handleTreeKey(event, row, virtualRow.index)}
                />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
