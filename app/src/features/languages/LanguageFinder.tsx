import { useVirtualizer } from '@tanstack/react-virtual'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useRef } from 'react'
import { normalizeLanguageQuery } from '../../data/atlasRepository'
import type { Language } from '../../domain/atlas'
import {
  atlasDataAtom,
  finderScopeAtom,
  geographyDatasetFilterAtom,
  geometryOverridesAtom,
  languageQueryAtom,
  setGeometryOverrideAtom,
  showLanguagesAtom,
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
  const toggleVisible = useSetAtom(toggleVisibleLanguageAtom)
  const setGeometryOverride = useSetAtom(setGeometryOverrideAtom)
  const variants = language.geometryVariantIds.flatMap((id) => {
    const variant = data.variantById.get(id)
    return variant ? [variant] : []
  })
  const hasGeometry = variants.length > 0
  const isVisible = visibleIds.includes(language.id)
  const activeVariantId = overrides[language.id] ?? variants[0]?.id

  return (
    <article className={`language-row${hasGeometry ? '' : ' language-row--unavailable'}`}>
      <label className="language-row__identity">
        <input
          type="checkbox"
          checked={isVisible}
          disabled={!hasGeometry}
          onChange={() => toggleVisible(language.id)}
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
          value={activeVariantId}
          onChange={(event) =>
            setGeometryOverride({ languageId: language.id, variantId: event.currentTarget.value })
          }
        >
          {variants.map((variant) => (
            <option key={variant.id} value={variant.id}>
              {variant.label}
            </option>
          ))}
        </select>
      ) : (
        <small className="language-row__availability">
          {variants[0]?.label ?? 'No polygon available'}
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
  const showLanguages = useSetAtom(showLanguagesAtom)
  const setVisibleIds = useSetAtom(visibleLanguageIdsAtom)
  const listRef = useRef<HTMLDivElement>(null)
  const normalizedQuery = normalizeLanguageQuery(query.trim())
  const viewportIdSet = new Set(viewportIds)
  const languages = data.languages.filter((language) => {
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
    return language.geometryVariantIds.some(
      (variantId) => data.variantById.get(variantId)?.datasetId === datasetFilter,
    )
  })
  const virtualizer = useVirtualizer({
    count: languages.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 104,
    overscan: 6,
    getItemKey: (index) => languages[index]?.id ?? index,
  })
  const showableIds = languages
    .filter((language) => language.geometryVariantIds.length > 0)
    .map((language) => language.id)

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
          placeholder="Name, ISO or Glottocode…"
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </label>

      <div className="finder-filters">
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

      <div className="finder-actions">
        <p>
          <strong>{languages.length.toLocaleString()}</strong> matches ·{' '}
          {showableIds.length.toLocaleString()} mappable
        </p>
        <div>
          <button
            type="button"
            onClick={() => showLanguages(showableIds)}
            disabled={!showableIds.length}
          >
            Show filtered
          </button>
          <button type="button" className="button-secondary" onClick={() => setVisibleIds([])}>
            Clear
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
