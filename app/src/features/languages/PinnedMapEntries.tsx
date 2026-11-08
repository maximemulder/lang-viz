import { useAtomValue, useSetAtom } from 'jotai'
import { useEffect, useMemo, useRef } from 'react'
import { mapEntryDescription } from '../../domain/mapEntries'
import { temporalQualityLabel } from '../../domain/temporal'
import {
  atlasDataAtom,
  languageColorsAtom,
  mapEntriesAtom,
  removeMapEntryAtom,
  setMapEntryColorAtom,
} from '../../state/atlasState'
import { openLanguageDetailsAtom } from '../../state/languageControls'

/** Inspect and style pinned geometry without changing the draft being browsed. */
export const PinnedMapEntries = ({
  languageId,
  focusedEntryId,
}: {
  readonly languageId: string
  readonly focusedEntryId: string | null
}) => {
  const data = useAtomValue(atlasDataAtom)
  const entries = useAtomValue(mapEntriesAtom)
  const colors = useAtomValue(languageColorsAtom)
  const remove = useSetAtom(removeMapEntryAtom)
  const setColor = useSetAtom(setMapEntryColorAtom)
  const openDetails = useSetAtom(openLanguageDetailsAtom)
  const rootRef = useRef<HTMLDivElement>(null)
  const selected = useMemo(
    () => entries.filter((entry) => entry.languageId === languageId),
    [entries, languageId],
  )
  useEffect(() => {
    const card = [
      ...(rootRef.current?.querySelectorAll<HTMLElement>('[data-entry-id]') ?? []),
    ].find((element) => element.dataset.entryId === focusedEntryId)
    card?.focus({ preventScroll: true })
    card?.scrollIntoView({ block: 'nearest' })
  }, [focusedEntryId])
  if (!selected.length) return null
  const language = data.languageById.get(languageId)
  return (
    <div ref={rootRef} className="pinned-map-entries">
      <h4>On map ({selected.length})</h4>
      <p>
        Each entry keeps its source polygons and period. Color overrides apply only to that entry.
      </p>
      {selected.map((entry) => {
        const description = mapEntryDescription(entry, data)
        return (
          <article
            key={entry.id}
            data-entry-id={entry.id}
            className="map-entry-card"
            tabIndex={-1}
            aria-label={`${language?.name}, ${description}`}
          >
            <strong>{description}</strong>
            <small>
              {entry.mode === 'own'
                ? 'Own area'
                : `Descendant areas · ${entry.variantIds.length} contributors · ${entry.uncoveredBranchIds.length} uncovered branches`}
            </small>
            {entry.branchRootId && (
              <p>
                Branch view: mapped descendants replace ancestor colors where they overlap. Broader
                coverage remains at its supplied classification level.
              </p>
            )}
            <div className="map-entry-card__actions">
              <label>
                Color
                <input
                  type="color"
                  aria-label={`Color for ${language?.name}, ${description}`}
                  value={entry.colorOverride ?? colors.get(languageId) ?? '#777777'}
                  onChange={(event) =>
                    setColor({ entryId: entry.id, color: event.currentTarget.value })
                  }
                />
              </label>
              <button
                type="button"
                disabled={entry.colorOverride === null}
                onClick={() => setColor({ entryId: entry.id, color: null })}
              >
                Use languoid color
              </button>
              <button type="button" onClick={() => remove(entry.id)}>
                Remove this entry
              </button>
            </div>
            <details>
              <summary>
                {entry.mode === 'own' ? 'Source and period' : 'Pinned contributors and gaps'}
              </summary>
              <ul>
                {entry.variantIds.map((id) => {
                  const variant = data.variantById.get(id)
                  if (!variant) return <li key={id}>Missing geometry: {id}</li>
                  const contributor = data.languageById.get(variant.languageId)
                  return (
                    <li key={id}>
                      <button type="button" onClick={() => openDetails(variant.languageId)}>
                        {contributor?.name ?? variant.languageId}
                      </button>
                      <small>
                        {variant.label} · {variant.temporalCoverage.label} ·{' '}
                        {temporalQualityLabel(variant.temporalCoverage.quality)}
                      </small>
                    </li>
                  )
                })}
              </ul>
              {entry.uncoveredBranchIds.length > 0 && (
                <>
                  <p>Uncovered branches when added:</p>
                  <ul>
                    {entry.uncoveredBranchIds.map((id) => (
                      <li key={id}>
                        <button type="button" onClick={() => openDetails(id)}>
                          {data.languageById.get(id)?.name ?? id}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </details>
          </article>
        )
      })}
    </div>
  )
}
