import { useVirtualizer } from '@tanstack/react-virtual'
import { useAtomValue, useSetAtom } from 'jotai'
import { useMemo, useRef, useState } from 'react'
import { SidebarPane } from '../../components/SidebarPane'
import { matchesLanguageQuery, normalizeLanguageQuery } from '../../domain/catalog'
import type { MapEntry } from '../../domain/mapEntries'
import { mapEntryDescription } from '../../domain/mapEntries'
import type { MapEntryGroup } from '../../domain/mapGroups'
import {
  atlasDataAtom,
  clearMapSelectionAtom,
  mapEntriesAtom,
  mapGroupsAtom,
  removeMapEntryAtom,
  removeMapGroupAtom,
  selectedMapAreasAtom,
  semanticPaletteAtom,
  setMapGroupStyleAtom,
} from '../../state/atlasState'
import { languagePanelAtom, openLanguageDetailsAtom } from '../../state/languageControls'
import { LanguagePreviewItem } from './LanguagePreview'

type MapRow =
  | {
      readonly kind: 'group'
      readonly key: string
      readonly grouped: MapEntryGroup
      readonly description: string
      readonly expanded: boolean
      readonly expandable: boolean
    }
  | {
      readonly kind: 'entry'
      readonly key: string
      readonly entry: MapEntry
      readonly description: string
    }

export const OnMapLanguages = () => {
  const data = useAtomValue(atlasDataAtom)
  const entries = useAtomValue(mapEntriesAtom)
  const groups = useAtomValue(mapGroupsAtom)
  const areas = useAtomValue(selectedMapAreasAtom)
  const palette = useAtomValue(semanticPaletteAtom)
  const areaById = useMemo(() => new Map(areas.map((area) => [area.id, area])), [areas])
  const remove = useSetAtom(removeMapEntryAtom)
  const removeGroup = useSetAtom(removeMapGroupAtom)
  const setGroupStyle = useSetAtom(setMapGroupStyleAtom)
  const clear = useSetAtom(clearMapSelectionAtom)
  const openDetails = useSetAtom(openLanguageDetailsAtom)
  const panel = useAtomValue(languagePanelAtom)
  const [query, setQuery] = useState('')
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(new Set())
  const listRef = useRef<HTMLDivElement>(null)
  const rows = useMemo(() => {
    const normalized = normalizeLanguageQuery(query.trim())
    const result: MapRow[] = []
    const matches = (id: string) =>
      matchesLanguageQuery(data.languageSearchIndex.get(id), normalized)
    for (const grouped of [...groups].sort((a, b) =>
      (data.languageById.get(a.group.rootId)?.name ?? a.group.rootId).localeCompare(
        data.languageById.get(b.group.rootId)?.name ?? b.group.rootId,
      ),
    )) {
      const { group, entries: members } = grouped
      const descriptions = new Map(
        members.map((entry) => [entry.id, mapEntryDescription(entry, data)]),
      )
      const description = [...new Set(descriptions.values())].join('; ')
      const groupMatches =
        matches(group.rootId) || normalizeLanguageQuery(description).includes(normalized)
      const matching = groupMatches ? members : members.filter((entry) => matches(entry.languageId))
      if (!matching.length) continue
      const expandable = members.length > 1 || members[0]?.languageId !== group.rootId
      const expanded =
        expandable && (expandedGroups.has(group.id) || (Boolean(normalized) && !groupMatches))
      result.push({ kind: 'group', key: group.id, grouped, description, expanded, expandable })
      if (expanded) {
        for (const entry of [...matching].sort((a, b) =>
          (data.languageById.get(a.languageId)?.name ?? a.languageId).localeCompare(
            data.languageById.get(b.languageId)?.name ?? b.languageId,
          ),
        ))
          result.push({
            kind: 'entry',
            key: entry.id,
            entry,
            description: descriptions.get(entry.id) ?? '',
          })
      }
    }
    return result
  }, [groups, data, query, expandedGroups])
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => listRef.current,
    // Section resizing and virtual row measurement must settle in separate frames.
    useAnimationFrameWithResizeObserver: true,
    estimateSize: (index) => (rows[index]?.kind === 'group' ? 108 : 68),
    overscan: 4,
    getItemKey: (index) => rows[index]?.key ?? index,
  })
  return (
    <div className="on-map-view">
      <label className="search-field">
        <span className="visually-hidden">Search map groups and areas</span>
        <input
          type="search"
          value={query}
          placeholder="Find a group, language, source or period…"
          onChange={(event) => {
            setQuery(event.currentTarget.value)
            virtualizer.scrollToOffset(0)
          }}
        />
      </label>
      <div className="finder-actions on-map-actions">
        <p aria-live="polite">
          <strong>{groups.length.toLocaleString()} groups</strong> ·{' '}
          {entries.length.toLocaleString()} areas
          <small>
            {entries.length > areas.length
              ? `${entries.length - areas.length} pinned areas unavailable in this catalog`
              : 'Expand a group to inspect or remove individual areas'}
            {query.trim() &&
              ` · ${rows.filter((row) => row.kind === 'group').length} matching groups`}
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
            <p>{entries.length ? 'No map groups match this search.' : 'Your map is empty.'}</p>
            <p>
              {entries.length
                ? 'Try a language, source, or period.'
                : 'Select entries in Explore, then choose Add to map.'}
            </p>
          </div>
        )}
        <ul
          className="language-list__sizer"
          aria-label="Map groups and areas"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index]
            if (!row) return null
            const position = { transform: `translateY(${virtualRow.start}px)` }
            if (row.kind === 'group') {
              const { group, entries: members } = row.grouped
              const name = data.languageById.get(group.rootId)?.name ?? group.rootId
              const rootEntry = members.find((entry) => entry.languageId === group.rootId)
              const seed = group.color ?? palette.colors.get(group.rootId) ?? '#777777'
              return (
                <LanguagePreviewItem
                  target={{ languageId: group.rootId, groupId: group.id }}
                  active={panel.view === 'map'}
                  key={row.key}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  data-group-id={group.id}
                  data-language-id={group.rootId}
                  data-inspected={
                    panel.detailId === group.rootId &&
                    (panel.detailGroupId === group.id ||
                      (!panel.detailGroupId &&
                        (!panel.detailEntryId || panel.detailEntryId === rootEntry?.id)))
                  }
                  className="on-map-group"
                  style={position}
                >
                  <div className="on-map-group__heading">
                    {row.expandable ? (
                      <button
                        type="button"
                        className="language-row__disclosure"
                        aria-label={`${row.expanded ? 'Collapse' : 'Expand'} ${name} map group`}
                        aria-expanded={row.expanded}
                        onClick={() =>
                          setExpandedGroups((current) => {
                            const next = new Set(current)
                            if (next.has(group.id)) next.delete(group.id)
                            else next.add(group.id)
                            return next
                          })
                        }
                      >
                        <span aria-hidden="true">{row.expanded ? '▾' : '▸'}</span>
                      </button>
                    ) : (
                      <span
                        className="language-swatch"
                        style={{
                          backgroundColor: rootEntry
                            ? (areaById.get(rootEntry.id)?.color ?? seed)
                            : seed,
                        }}
                      />
                    )}
                    <button
                      type="button"
                      className="on-map-group__identity on-map-row__identity"
                      title={`${name} · ${row.description}`}
                      onClick={() => openDetails({ languageId: group.rootId, groupId: group.id })}
                    >
                      <strong>{name}</strong>
                      <small>{row.description}</small>
                      <small>
                        {group.coverage === 'branch'
                          ? 'Entry and descendants'
                          : 'Only this entry’s area'}{' '}
                        · {members.length.toLocaleString()} mapped{' '}
                        {members.length === 1 ? 'area' : 'areas'}
                      </small>
                    </button>
                    <button
                      type="button"
                      className="on-map-row__remove"
                      aria-label={`Remove ${name} group from map`}
                      title="Remove group from map"
                      onClick={() => removeGroup(group.id)}
                    >
                      ×
                    </button>
                  </div>
                  <div className="on-map-group__style">
                    <input
                      type="color"
                      aria-label={`Group color for ${name}, ${row.description}`}
                      title="Group base color; individual color overrides are retained"
                      value={seed}
                      onChange={(event) =>
                        setGroupStyle({ groupId: group.id, color: event.currentTarget.value })
                      }
                    />
                    <SidebarPane
                      className="on-map-group__style-options"
                      title={group.coloring === 'uniform' ? 'One color' : 'Color by hierarchy'}
                    >
                      <label>
                        <span className="visually-hidden">
                          Coloring for {name}, {row.description}
                        </span>
                        <select
                          aria-label={`Coloring for ${name}, ${row.description}`}
                          value={group.coloring}
                          onChange={(event) =>
                            setGroupStyle({
                              groupId: group.id,
                              coloring:
                                event.currentTarget.value === 'uniform' ? 'uniform' : 'hierarchy',
                            })
                          }
                        >
                          <option value="hierarchy">Color by hierarchy</option>
                          <option value="uniform">One color</option>
                        </select>
                      </label>
                      <button
                        type="button"
                        disabled={group.color === null}
                        onClick={() => setGroupStyle({ groupId: group.id, color: null })}
                      >
                        Reset color
                      </button>
                    </SidebarPane>
                  </div>
                </LanguagePreviewItem>
              )
            }
            const { entry, description } = row
            const language = data.languageById.get(entry.languageId)
            const name = language?.name ?? entry.languageId
            const area = areaById.get(entry.id)
            return (
              <LanguagePreviewItem
                target={{ languageId: entry.languageId, entryId: entry.id }}
                active={panel.view === 'map'}
                key={row.key}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                data-language-id={entry.languageId}
                data-entry-id={entry.id}
                data-displayed={Boolean(area)}
                data-inspected={panel.detailEntryId === entry.id}
                className="on-map-row"
                style={position}
              >
                <span
                  className="language-swatch"
                  style={{ backgroundColor: area?.color ?? '#777777' }}
                />
                <button
                  type="button"
                  className="on-map-row__identity"
                  aria-label={`Details for ${name}`}
                  aria-current={panel.detailEntryId === entry.id ? 'true' : undefined}
                  title={`${name} · ${description}`}
                  onClick={() => openDetails({ languageId: entry.languageId, entryId: entry.id })}
                >
                  <strong>{name}</strong>
                  <small>{description}</small>
                  <small className={area ? '' : 'on-map-row__unavailable'}>
                    {area
                      ? entry.mode === 'descendants'
                        ? `${entry.variantIds.length} contributing areas`
                        : 'Source area'
                      : 'Pinned geometry unavailable in this catalog'}
                  </small>
                </button>
                <button
                  type="button"
                  className="on-map-row__remove"
                  aria-label={`Remove ${name} area from map`}
                  title="Remove this area"
                  onClick={() => remove(entry.id)}
                >
                  ×
                </button>
              </LanguagePreviewItem>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
