import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useMemo } from 'react'
import { areaMode, isAreaAvailable, mappedBranchForLanguage } from '../../domain/aggregation'
import { languageAncestors } from '../../domain/hierarchy'
import { mapEntryDescription } from '../../domain/mapEntries'
import { temporalQualityLabel } from '../../domain/temporal'
import {
  areaModesAtom,
  atlasDataAtom,
  geographyAvailabilityAtom,
  geometryOverridesAtom,
  languageColorsAtom,
  languageHierarchyAtom,
  mapEntriesAtom,
  removeMapEntryAtom,
  selectedDraftLanguageIdsAtom,
  setGeometryOverrideAtom,
  showBranchAtom,
  toggleVisibleLanguageAtom,
} from '../../state/atlasState'
import {
  closeLanguageDetailsAtom,
  editGeographyFiltersAtom,
  languagePanelAtom,
  openLanguageDetailsAtom,
  revealLanguageAtom,
} from '../../state/languageControls'
import { GeographyFilterSummary } from './GeographyFilters'
import { GeometrySourceRecords } from './GeometrySourceRecords'
import { PinnedMapEntries } from './PinnedMapEntries'

export const LanguageDetails = () => {
  const [panel, setPanel] = useAtom(languagePanelAtom)
  const data = useAtomValue(atlasDataAtom)
  const hierarchy = useAtomValue(languageHierarchyAtom)
  const availability = useAtomValue(geographyAvailabilityAtom)
  const [modes, setModes] = useAtom(areaModesAtom)
  const overrides = useAtomValue(geometryOverridesAtom)
  const colors = useAtomValue(languageColorsAtom)
  const visibleIds = useAtomValue(selectedDraftLanguageIdsAtom)
  const toggleVisible = useSetAtom(toggleVisibleLanguageAtom)
  const setGeometryOverride = useSetAtom(setGeometryOverrideAtom)
  const showBranch = useSetAtom(showBranchAtom)
  const openDetails = useSetAtom(openLanguageDetailsAtom)
  const closeDetails = useSetAtom(closeLanguageDetailsAtom)
  const editGeography = useSetAtom(editGeographyFiltersAtom)
  const entries = useAtomValue(mapEntriesAtom)
  const removeEntry = useSetAtom(removeMapEntryAtom)
  const reveal = useSetAtom(revealLanguageAtom)
  const detailId = panel.detailId
  const detail = detailId ? data.languageById.get(detailId) : undefined
  const detailAvailability = detail ? availability.get(detail.id) : undefined
  const mappedBranch = useMemo(
    () => (detailId ? mappedBranchForLanguage(detailId, hierarchy, availability) : undefined),
    [detailId, hierarchy, availability],
  )
  const detailMode = detailAvailability
    ? areaMode(detailAvailability, modes[detailId ?? ''])
    : 'own'
  const detailVariants = detailAvailability?.ownVariants ?? []
  const activeVariant =
    detailVariants.find((variant) => variant.id === overrides[detailId ?? '']) ?? detailVariants[0]
  const selected = detailId !== null && visibleIds.includes(detailId)
  const focusedEntry = entries.find(
    (entry) => entry.id === panel.detailEntryId && entry.languageId === detailId,
  )
  if (!detail) return null
  const classification = detail.classification
  const draftSelection = (
    <>
      <div className="detail-selection">
        <span
          className="language-swatch"
          style={{ backgroundColor: colors.get(detail.id) }}
          aria-hidden="true"
        />
        <span>{selected ? 'This representation is on the map' : 'Add this representation'}</span>
        <button
          type="button"
          disabled={!selected && !isAreaAvailable(detailAvailability, modes[detail.id])}
          onClick={() => toggleVisible(detail.id)}
        >
          {selected ? 'Remove from map' : 'Add to map'}
        </button>
      </div>
      <p className="finder-detail__context">
        <GeographyFilterSummary />{' '}
        <button
          type="button"
          aria-label="Change sources and period"
          onClick={() => editGeography()}
        >
          Change
        </button>
      </p>
    </>
  )
  return (
    <section
      className="finder-detail"
      aria-label="Entry details"
      aria-labelledby="focused-language-name"
    >
      <header className="finder-detail__header">
        <div className="finder-detail__heading" aria-live="polite">
          <h3 id="focused-language-name">{detail.name}</h3>
          <small>
            {detail.level} · {detail.id}
            {detail.iso6393 ? ` · ${detail.iso6393}` : ''}
          </small>
        </div>
        <button
          type="button"
          className="finder-detail__toggle"
          aria-label={
            panel.detailCollapsed ? 'Expand language details' : 'Collapse language details'
          }
          aria-expanded={!panel.detailCollapsed}
          aria-controls="focused-language-body"
          onClick={() => setPanel({ ...panel, detailCollapsed: !panel.detailCollapsed })}
        >
          <span aria-hidden="true">{panel.detailCollapsed ? '▸' : '▾'}</span>
        </button>
        <button
          type="button"
          className="finder-detail__close"
          aria-label="Close language details"
          onClick={() => {
            const origin = document.querySelector<HTMLElement>(
              `#language-panel-${panel.view} [data-inspected="true"] :is(.language-row__identity, .on-map-row__identity)`,
            )
            const restoreFocus = origin ?? document.getElementById(`language-tab-${panel.view}`)
            closeDetails()
            restoreFocus?.focus({ preventScroll: true })
          }}
        >
          <span aria-hidden="true">×</span>
        </button>
      </header>
      <div
        id="focused-language-body"
        className="finder-detail__body"
        key={`${detail.id}/${panel.detailEntryId ?? ''}`}
        hidden={panel.detailCollapsed}
      >
        <nav className="finder-detail__path" aria-label="Classification ancestors">
          {languageAncestors(hierarchy, detail).map((ancestor) => (
            <button type="button" key={ancestor.id} onClick={() => openDetails(ancestor.id)}>
              {ancestor.name}
              <span aria-hidden="true"> ›</span>
            </button>
          ))}
        </nav>
        {focusedEntry ? (
          <div className="focused-map-entry" data-entry-id={focusedEntry.id}>
            <span
              className="language-swatch"
              style={{ backgroundColor: focusedEntry.colorOverride ?? colors.get(detail.id) }}
              aria-hidden="true"
            />
            <div>
              <strong>{mapEntryDescription(focusedEntry, data)}</strong>
              <small>{focusedEntry.mode === 'own' ? 'Own area' : 'Descendant areas'}</small>
            </div>
            <button type="button" onClick={() => removeEntry(focusedEntry.id)}>
              Remove entry
            </button>
          </div>
        ) : (
          draftSelection
        )}
        <details className="finder-detail__more">
          <summary>More details</summary>
          {classification.kind === 'source' && (
            <div className="finder-detail__classification">
              <h4>Source-defined entry</h4>
              <p>
                {data.datasets.find(({ id }) => id === classification.datasetId)?.name ??
                  classification.datasetId}{' '}
                · {classification.label}
              </p>
              <p>No matched Glottocode. {classification.note}</p>
            </div>
          )}
          <PinnedMapEntries languageId={detail.id} focusedEntryId={panel.detailEntryId} />
          <h4>Representation to add</h4>
          <p>Uses the sources and period in Explore. Existing map entries keep their geography.</p>
          {focusedEntry && draftSelection}
          {mappedBranch && (hierarchy.childrenById.get(detail.id)?.length ?? 0) > 0 && (
            <div className="finder-detail__branch">
              <button
                type="button"
                disabled={!mappedBranch.languageIds.length}
                onClick={() => showBranch(detail.id)}
              >
                Show branch on map ({mappedBranch.languageIds.length.toLocaleString()})
              </button>
              <p>
                Shows this entry and its mapped descendants. More specific areas replace ancestor
                colors where they overlap; broader areas remain elsewhere. Uses current sources and
                period. Replaces entries in this branch from the same context; other comparisons
                stay.
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
                          if (contributor) openDetails(contributor.id)
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
                        <button type="button" onClick={() => openDetails(entry.id)}>
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
          {detailMode === 'own' && activeVariant && (
            <GeometrySourceRecords
              key={activeVariant.id}
              manifest={data.manifest}
              variant={activeVariant}
            />
          )}
        </details>
        <button type="button" className="finder-detail__reveal" onClick={() => reveal(detail.id)}>
          Show in classification
        </button>
      </div>
    </section>
  )
}
