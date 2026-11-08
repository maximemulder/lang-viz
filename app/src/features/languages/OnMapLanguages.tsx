import { useVirtualizer } from '@tanstack/react-virtual'
import { useAtomValue, useSetAtom } from 'jotai'
import { useMemo, useRef, useState } from 'react'
import { areaMode, areaStatus, isAreaAvailable } from '../../domain/aggregation'
import { normalizeLanguageQuery } from '../../domain/catalog'
import {
  areaModesAtom,
  atlasDataAtom,
  clearMapSelectionAtom,
  geographyAvailabilityAtom,
  languageColorsAtom,
  selectedMapAreasAtom,
  toggleVisibleLanguageAtom,
  visibleLanguageIdsAtom,
} from '../../state/atlasState'
import { openLanguageDetailsAtom } from '../../state/languageControls'

export const OnMapLanguages = () => {
  const data = useAtomValue(atlasDataAtom)
  const ids = useAtomValue(visibleLanguageIdsAtom)
  const areas = useAtomValue(selectedMapAreasAtom)
  const availability = useAtomValue(geographyAvailabilityAtom)
  const modes = useAtomValue(areaModesAtom)
  const colors = useAtomValue(languageColorsAtom)
  const remove = useSetAtom(toggleVisibleLanguageAtom)
  const clear = useSetAtom(clearMapSelectionAtom)
  const openDetails = useSetAtom(openLanguageDetailsAtom)
  const [query, setQuery] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const languages = useMemo(() => {
    const normalized = normalizeLanguageQuery(query.trim())
    return ids
      .flatMap((id) => {
        const language = data.languageById.get(id)
        return language &&
          (!normalized || data.searchTextByLanguageId.get(id)?.includes(normalized))
          ? [language]
          : []
      })
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  }, [ids, data, query])
  const virtualizer = useVirtualizer({
    count: languages.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 68,
    getItemKey: (index) => languages[index]?.id ?? index,
    overscan: 5,
  })

  return (
    <div className="on-map-view">
      <label className="search-field">
        <span className="visually-hidden">Search selected languages</span>
        <input
          type="search"
          value={query}
          placeholder="Find in your map selection…"
          onChange={(event) => {
            setQuery(event.currentTarget.value)
            virtualizer.scrollToOffset(0)
          }}
        />
      </label>
      <div className="finder-actions on-map-actions">
        <p aria-live="polite">
          <strong>{ids.length.toLocaleString()}</strong> selected · {areas.length.toLocaleString()}{' '}
          displayed
          <small>
            {ids.length - areas.length > 0
              ? `${(ids.length - areas.length).toLocaleString()} unavailable with the current geography settings`
              : 'Independent of your Explore search and map position'}
            {query.trim() && ` · ${languages.length.toLocaleString()} matches`}
          </small>
        </p>
        <button
          type="button"
          className="button-secondary"
          disabled={!ids.length}
          onClick={() => clear()}
        >
          Clear map
        </button>
      </div>
      <div ref={listRef} className="on-map-list">
        {!languages.length && (
          <div className="finder-empty">
            <p>
              {ids.length
                ? 'No selected entries match this search.'
                : 'Your map selection is empty.'}
            </p>
            <p>
              {ids.length
                ? 'Try another name or identifier.'
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
            const language = languages[item.index]
            if (!language) return null
            const available = availability.get(language.id)
            const mode = available ? areaMode(available, modes[language.id]) : 'own'
            const displayed = isAreaAvailable(available, mode)
            const status = available ? areaStatus(available, mode) : 'No areas'
            return (
              <li
                key={language.id}
                aria-posinset={item.index + 1}
                aria-setsize={languages.length}
                className="on-map-row"
                data-language-id={language.id}
                data-displayed={displayed}
                style={{ transform: `translateY(${item.start}px)` }}
              >
                <span
                  className="language-swatch"
                  style={{ backgroundColor: colors.get(language.id) }}
                  aria-hidden="true"
                />
                <button
                  type="button"
                  className="on-map-row__identity"
                  aria-label={`Details for ${language.name}`}
                  onClick={() => openDetails(language.id)}
                >
                  <strong>{language.name}</strong>
                  <small>
                    {language.level} · {language.id}
                  </small>
                  <small className={displayed ? '' : 'on-map-row__unavailable'}>
                    {displayed
                      ? status
                      : status === 'Filtered out'
                        ? 'Unavailable with current sources / period'
                        : `${status} for this representation`}
                  </small>
                </button>
                <button
                  type="button"
                  className="on-map-row__remove"
                  aria-label={`Remove ${language.name} from map`}
                  title="Remove from map"
                  onClick={() => remove(language.id)}
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
