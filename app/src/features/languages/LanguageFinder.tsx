import { useVirtualizer } from '@tanstack/react-virtual'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useRef } from 'react'
import { normalizeLanguageQuery } from '../../data/atlasRepository'
import type { Language } from '../../domain/atlas'
import {
  isTemporalViewSelection,
  TEMPORAL_VIEWS,
  temporalQualityLabel,
  temporalVariantsForLanguage,
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
  const toggleVisible = useSetAtom(toggleVisibleLanguageAtom)
  const setGeometryOverride = useSetAtom(setGeometryOverrideAtom)
  const variants = temporalVariantsForLanguage(data, language, temporalSelection)
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
    const temporalVariants = temporalVariantsForLanguage(data, language, temporalSelection)
    if (
      normalizedQuery &&
      !data.searchTextByLanguageId.get(language.id)?.includes(normalizedQuery)
    ) {
      return false
    }
    if (scope === 'viewport' && !viewportIdSet.has(language.id)) {
      return false
    }
    if (datasetFilter === 'all') {
      return true
    }
    return temporalVariants.some((variant) => variant.datasetId === datasetFilter)
  })
  const virtualizer = useVirtualizer({
    count: languages.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 70,
    overscan: 8,
    getItemKey: (index) => languages[index]?.id ?? index,
  })
  const showableIds = languages
    .filter((language) => temporalVariantsForLanguage(data, language, temporalSelection).length > 0)
    .map((language) => language.id)
  const visibleIdSet = new Set(visibleIds)
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
        <span className="selection-count">{visibleIds.length} shown</span>
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

        <label>
          <span>Geography</span>
          <select
            value={datasetFilter}
            onChange={(event) => setDatasetFilter(event.currentTarget.value)}
          >
            <option value="all">All languages</option>
            {data.datasets.map((dataset) => (
              <option key={dataset.id} value={dataset.id}>
                In {dataset.shortName}
              </option>
            ))}
          </select>
        </label>

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
