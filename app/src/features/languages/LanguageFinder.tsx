import { useVirtualizer } from '@tanstack/react-virtual'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useEffect, useRef, useState } from 'react'
import { normalizeLanguageQuery } from '../../data/atlasRepository'
import type {
  AtlasData,
  GeographyDatasetSelection,
  Language,
  TemporalViewSelection,
} from '../../domain/atlas'
import { geographyVariantsForLanguage } from '../../domain/geography'
import {
  isTemporalViewSelection,
  TEMPORAL_VIEWS,
  temporalQualityLabel,
  temporalView,
} from '../../domain/temporal'
import {
  atlasDataAtom,
  finderScopeAtom,
  geographyDatasetFilterAtom,
  geometryOverridesAtom,
  languageQueryAtom,
  setGeometryOverrideAtom,
  showLanguagesAtom,
  temporalViewAtom,
  toggleVisibleLanguageAtom,
  viewportLanguageIdsAtom,
  visibleLanguageIdsAtom,
} from '../../state/atlasState'

interface LanguageRowProps {
  readonly language: Language
}

const LanguageRow = ({ language }: LanguageRowProps) => {
  const data = useAtomValue(atlasDataAtom)
  const visibleIds = useAtomValue(visibleLanguageIdsAtom)
  const overrides = useAtomValue(geometryOverridesAtom)
  const temporalSelection = useAtomValue(temporalViewAtom)
  const datasetSelection = useAtomValue(geographyDatasetFilterAtom)
  const toggleVisible = useSetAtom(toggleVisibleLanguageAtom)
  const setGeometryOverride = useSetAtom(setGeometryOverrideAtom)
  const variants = geographyVariantsForLanguage(data, language, temporalSelection, datasetSelection)
  const hasGeometry = variants.length > 0
  const isVisible = visibleIds.includes(language.id)
  const activeVariant =
    variants.find((variant) => variant.id === overrides[language.id]) ?? variants[0]

  return (
    <article className={`language-row${hasGeometry ? '' : ' language-row--unavailable'}`}>
      <label className="language-row__identity">
        <input
          type="checkbox"
          checked={isVisible}
          disabled={!hasGeometry && !isVisible}
          onChange={() => toggleVisible(language.id)}
        />
        <span
          className="language-row__swatch"
          style={{ backgroundColor: activeVariant?.color ?? '#b8c0bc' }}
          aria-hidden="true"
        />
        <span>
          <strong>{language.name}</strong>
          <small>
            {language.familyName ?? 'Unclassified'} · {language.id}
          </small>
        </span>
      </label>

      {variants.length > 1 ? (
        <select
          className="language-row__variant"
          aria-label={`Geographic source for ${language.name}`}
          value={activeVariant?.id}
          onChange={(event) =>
            setGeometryOverride({ languageId: language.id, variantId: event.currentTarget.value })
          }
        >
          {variants.map((variant) => (
            <option key={variant.id} value={variant.id}>
              {variant.label}
              {variant.temporalCoverage.quality === 'proxy' ||
              variant.temporalCoverage.quality === 'mixed'
                ? ` · ${temporalQualityLabel(variant.temporalCoverage.quality)}`
                : ''}
            </option>
          ))}
        </select>
      ) : (
        <small className="language-row__availability">
          {variants[0]
            ? `${variants[0].label}${
                variants[0].temporalCoverage.quality === 'proxy' ||
                variants[0].temporalCoverage.quality === 'mixed'
                  ? ` · ${temporalQualityLabel(variants[0].temporalCoverage.quality)}`
                  : ''
              }`
            : `No polygon in ${temporalView(temporalSelection).shortLabel.toLocaleLowerCase()}`}
        </small>
      )}
    </article>
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
  const setVisibleIds = useSetAtom(visibleLanguageIdsAtom)
  const listRef = useRef<HTMLDivElement>(null)
  const normalizedQuery = normalizeLanguageQuery(query.trim())
  const viewportIdSet = new Set(viewportIds)
  const languages = data.languages.filter((language) => {
    const variants = geographyVariantsForLanguage(data, language, temporalSelection, datasetFilter)
    if (
      normalizedQuery &&
      !data.searchTextByLanguageId.get(language.id)?.includes(normalizedQuery)
    ) {
      return false
    }
    if (scope === 'viewport' && !viewportIdSet.has(language.id)) {
      return false
    }
    return variants.length > 0
  })
  const virtualizer = useVirtualizer({
    count: languages.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 70,
    overscan: 8,
    getItemKey: (index) => languages[index]?.id ?? index,
  })
  const showableIds = languages.map((language) => language.id)
  const visibleIdSet = new Set(visibleIds)
  const shownCount = visibleIds.filter((languageId) => {
    const language = data.languageById.get(languageId)
    return (
      language &&
      geographyVariantsForLanguage(data, language, temporalSelection, datasetFilter).length > 0
    )
  }).length
  const areAllFilteredSelected =
    showableIds.length > 0 && showableIds.every((languageId) => visibleIdSet.has(languageId))

  const toggleFilteredLanguages = () => {
    if (areAllFilteredSelected) {
      const filteredIdSet = new Set(showableIds)
      setVisibleIds(visibleIds.filter((languageId) => !filteredIdSet.has(languageId)))
      return
    }
    showLanguages(showableIds)
  }

  return (
    <aside className="language-finder" aria-label="Language finder">
      <header className="language-finder__header">
        <div>
          <p className="eyebrow">Language layers</p>
          <h2>Find a language</h2>
        </div>
        <span className="selection-count">
          {shownCount === visibleIds.length
            ? `${shownCount} shown`
            : `${shownCount} of ${visibleIds.length} shown`}
        </span>
      </header>

      <label className="search-field">
        <span className="visually-hidden">Search languages</span>
        <input
          type="search"
          value={query}
          placeholder="Name, family, ISO or Glottocode…"
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </label>

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
            onChange={(event) =>
              setScope(event.currentTarget.value === 'viewport' ? 'viewport' : 'world')
            }
          >
            <option value="world">Whole world</option>
            <option value="viewport">Current map ({viewportIds.length})</option>
          </select>
        </label>
      </div>

      <p className="temporal-note">{temporalView(temporalSelection).description}</p>

      <div className="finder-actions">
        <p>
          <strong>{languages.length.toLocaleString()}</strong> matches ·{' '}
          {showableIds.length.toLocaleString()} mappable
        </p>
        <div>
          <button type="button" onClick={toggleFilteredLanguages} disabled={!showableIds.length}>
            {areAllFilteredSelected ? 'Deselect all' : 'Select all'}
          </button>
          <button type="button" className="button-secondary" onClick={() => setVisibleIds([])}>
            Clear all
          </button>
        </div>
      </div>

      <div className="language-list" ref={listRef}>
        <div className="language-list__sizer" style={{ height: `${virtualizer.getTotalSize()}px` }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const language = languages[virtualRow.index]
            if (!language) return null
            return (
              <div
                className="language-list__item"
                key={language.id}
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                <LanguageRow language={language} />
              </div>
            )
          })}
        </div>
      </div>
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
