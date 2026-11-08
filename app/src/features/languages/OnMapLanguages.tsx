import { useVirtualizer } from '@tanstack/react-virtual'
import { useAtomValue, useSetAtom } from 'jotai'
import { useMemo, useRef, useState } from 'react'
import { matchesLanguageQuery, normalizeLanguageQuery } from '../../domain/catalog'
import { mapEntryDescription } from '../../domain/mapEntries'
import {
  atlasDataAtom,
  clearMapSelectionAtom,
  mapEntriesAtom,
  removeMapEntryAtom,
  selectedMapAreasAtom,
} from '../../state/atlasState'
import { openLanguageDetailsAtom } from '../../state/languageControls'

export const OnMapLanguages = () => {
  const data = useAtomValue(atlasDataAtom)
  const entries = useAtomValue(mapEntriesAtom)
  const areas = useAtomValue(selectedMapAreasAtom)
  const areaById = useMemo(() => new Map(areas.map((area) => [area.id, area])), [areas])
  const remove = useSetAtom(removeMapEntryAtom)
  const clear = useSetAtom(clearMapSelectionAtom)
  const openDetails = useSetAtom(openLanguageDetailsAtom)
  const [query, setQuery] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const rows = useMemo(() => {
    const normalized = normalizeLanguageQuery(query.trim())
    return entries
      .flatMap((entry) => {
        const language = data.languageById.get(entry.languageId)
        const description = mapEntryDescription(entry, data)
        return language &&
          (matchesLanguageQuery(data.languageSearchIndex.get(language.id), normalized) ||
            normalizeLanguageQuery(description).includes(normalized))
          ? [{ entry, language, description }]
          : []
      })
      .sort(
        (a, b) =>
          a.language.name.localeCompare(b.language.name) ||
          a.description.localeCompare(b.description) ||
          a.entry.id.localeCompare(b.entry.id),
      )
  }, [entries, data, query])
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 68,
    getItemKey: (index) => rows[index]?.entry.id ?? index,
    overscan: 5,
  })

  return (
    <div className="on-map-view">
      <label className="search-field">
        <span className="visually-hidden">Search selected languages</span>
        <input
          type="search"
          value={query}
          placeholder="Find a language, source or period…"
          onChange={(event) => {
            setQuery(event.currentTarget.value)
            virtualizer.scrollToOffset(0)
          }}
        />
      </label>
      <div className="finder-actions on-map-actions">
        <p aria-live="polite">
          <strong>{entries.length.toLocaleString()}</strong> selected ·{' '}
          {areas.length.toLocaleString()} displayed
          <small>
            {entries.length - areas.length > 0
              ? `${(entries.length - areas.length).toLocaleString()} missing pinned geometry in this catalog`
              : 'Sources and periods are pinned independently of Explore'}
            {query.trim() && ` · ${rows.length.toLocaleString()} matches`}
          </small>
        </p>
        <button
          type="button"
          className="button-secondary"
          disabled={!entries.length}
          onClick={() => clear()}
        >
          Clear map
        </button>
      </div>
      <div ref={listRef} className="on-map-list">
        {!rows.length && (
          <div className="finder-empty">
            <p>
              {entries.length
                ? 'No selected entries match this search.'
                : 'Your map selection is empty.'}
            </p>
            <p>
              {entries.length
                ? 'Try another name, identifier, source or period.'
                : 'Use Explore to add languages, families, or mapped leaves.'}
            </p>
          </div>
        )}
        <ul
          className="language-list__sizer"
          aria-label="Selected languages"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index]
            if (!row) return null
            const { entry, language, description } = row
            const area = areaById.get(entry.id)
            const displayed = Boolean(area)
            return (
              <li
                key={entry.id}
                aria-posinset={item.index + 1}
                aria-setsize={rows.length}
                className="on-map-row"
                data-language-id={language.id}
                data-entry-id={entry.id}
                data-displayed={displayed}
                style={{ transform: `translateY(${item.start}px)` }}
              >
                <span
                  className="language-swatch"
                  style={{ backgroundColor: area?.color ?? '#777777' }}
                  aria-hidden="true"
                />
                <button
                  type="button"
                  className="on-map-row__identity"
                  aria-label={`Details for ${language.name}`}
                  title={`${language.name} · ${description}`}
                  onClick={() => openDetails({ languageId: language.id, entryId: entry.id })}
                >
                  <strong>{language.name}</strong>
                  <small>{description}</small>
                  <small className={displayed ? '' : 'on-map-row__unavailable'}>
                    {displayed
                      ? entry.mode === 'own'
                        ? 'Own area'
                        : `Descendant areas · ${entry.variantIds.length} contributors · ${entry.uncoveredBranchIds.length} uncovered branches`
                      : 'Pinned geometry unavailable in this catalog'}
                  </small>
                </button>
                <button
                  type="button"
                  className="on-map-row__remove"
                  aria-label={`Remove ${language.name} from map`}
                  title="Remove from map"
                  onClick={() => remove(entry.id)}
                >
                  ×
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
