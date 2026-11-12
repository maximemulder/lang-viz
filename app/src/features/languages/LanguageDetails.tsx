import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useMemo } from 'react'
import { SidebarPane, SidebarPaneHeader } from '../../components/SidebarPane'
import { mappedBranchForLanguage } from '../../domain/aggregation'
import { languageAncestors } from '../../domain/hierarchy'
import { targetGeometry } from '../../domain/languageFocus'
import { mapEntryDescription } from '../../domain/mapEntries'
import { hasCoverage } from '../../domain/mapGroups'
import { temporalQualityLabel } from '../../domain/temporal'
import {
  atlasDataAtom,
  geographyAvailabilityAtom,
  geometryOverridesAtom,
  languageColorsAtom,
  languageHierarchyAtom,
  mapEntriesAtom,
  mapGroupsAtom,
  removeMapEntryAtom,
  removeMapGroupAtom,
  selectedMapAreasAtom,
  setGeometryOverrideAtom,
} from '../../state/atlasState'
import {
  closeLanguageDetailsAtom,
  editGeographyFiltersAtom,
  focusLanguageOnMapAtom,
  languagePanelAtom,
  openLanguageDetailsAtom,
  revealLanguageAtom,
} from '../../state/languageControls'
import {
  searchCoverageAtom,
  searchSelectionAtom,
  toggleSearchSelectionAtom,
} from '../../state/searchSelection'
import { LanguageFeatures } from '../wals/LanguageFeatures.tsx'
import { GeographyFilterSummary } from './GeographyFilters'
import { GeometrySourceRecords } from './GeometrySourceRecords'
import { useLanguagePreview } from './LanguagePreview'
import { LanguageWordsButton } from './LanguageWordsButton.tsx'
import { PinnedMapEntries } from './PinnedMapEntries'

export const LanguageDetails = () => {
  const [panel, setPanel] = useAtom(languagePanelAtom)
  const data = useAtomValue(atlasDataAtom)
  const hierarchy = useAtomValue(languageHierarchyAtom)
  const availability = useAtomValue(geographyAvailabilityAtom)
  const coverage = useAtomValue(searchCoverageAtom)
  const overrides = useAtomValue(geometryOverridesAtom)
  const colors = useAtomValue(languageColorsAtom)
  const selectedIds = useAtomValue(searchSelectionAtom)
  const toggleSelected = useSetAtom(toggleSearchSelectionAtom)
  const areas = useAtomValue(selectedMapAreasAtom)
  const setGeometryOverride = useSetAtom(setGeometryOverrideAtom)
  const openDetails = useSetAtom(openLanguageDetailsAtom)
  const closeDetails = useSetAtom(closeLanguageDetailsAtom)
  const editGeography = useSetAtom(editGeographyFiltersAtom)
  const entries = useAtomValue(mapEntriesAtom)
  const groups = useAtomValue(mapGroupsAtom)
  const removeEntry = useSetAtom(removeMapEntryAtom)
  const removeGroup = useSetAtom(removeMapGroupAtom)
  const reveal = useSetAtom(revealLanguageAtom)
  const focusOnMap = useSetAtom(focusLanguageOnMapAtom)
  const profileTarget = {
    languageId: panel.detailId ?? '',
    ...(panel.detailEntryId ? { entryId: panel.detailEntryId } : {}),
    ...(panel.detailGroupId ? { groupId: panel.detailGroupId } : {}),
  }
  const preview = useLanguagePreview(profileTarget)
  const detailId = panel.detailId
  const detail = detailId ? data.languageById.get(detailId) : undefined
  const detailAvailability = detail ? availability.get(detail.id) : undefined
  const mappedBranch = useMemo(
    () => (detailId ? mappedBranchForLanguage(detailId, hierarchy, availability) : undefined),
    [detailId, hierarchy, availability],
  )
  const detailVariants = detailAvailability?.ownVariants ?? []
  const activeVariant =
    detailVariants.find((variant) => variant.id === overrides[detailId ?? '']) ?? detailVariants[0]
  const selected = detailId !== null && selectedIds.includes(detailId)
  const focusedEntry = entries.find(
    (entry) => entry.id === panel.detailEntryId && entry.languageId === detailId,
  )
  const focusedGroup = groups.find(({ group }) => group.id === panel.detailGroupId)
  const canFocusMap =
    targetGeometry(profileTarget, data, availability, coverage, hierarchy, entries).length > 0
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
        <span>{selected ? 'Selected in Explore' : 'Select for Add to map'}</span>
        <button
          type="button"
          disabled={!selected && !hasCoverage(detailAvailability, coverage)}
          onClick={() => {
            toggleSelected(detail.id)
            setPanel({ ...panel, view: 'explore' })
          }}
        >
          {selected ? 'Deselect' : 'Select'}
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
      {...preview}
      className="finder-detail"
      aria-label="Entry details"
      aria-labelledby="focused-language-name"
    >
      <SidebarPaneHeader
        className="finder-detail__header"
        toggleClassName="finder-detail__toggle"
        title={
          <div className="finder-detail__heading" aria-live="polite">
            <h3 id="focused-language-name">
              <button
                type="button"
                className="finder-detail__name"
                disabled={!canFocusMap}
                title={`Center map on ${detail.name}`}
                onClick={() => focusOnMap(profileTarget)}
              >
                {detail.name}
              </button>
            </h3>
            <small>
              {detail.level} · {detail.id}
              {detail.iso6393 ? ` · ${detail.iso6393}` : ''}
            </small>
          </div>
        }
        expanded={!panel.detailCollapsed}
        controls="focused-language-body"
        toggleLabel={
          panel.detailCollapsed ? 'Expand language details' : 'Collapse language details'
        }
        onToggle={() => setPanel({ ...panel, detailCollapsed: !panel.detailCollapsed })}
        actions={
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
        }
      />
      <div
        id="focused-language-body"
        className="finder-detail__body"
        key={`${detail.id}/${panel.detailGroupId ?? ''}/${panel.detailEntryId ?? ''}`}
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
        {focusedGroup ? (
          <div className="focused-map-entry" data-group-id={focusedGroup.group.id}>
            <div>
              <strong>
                {focusedGroup.entries[0] && mapEntryDescription(focusedGroup.entries[0], data)}
              </strong>
              <small>
                {focusedGroup.entries.length.toLocaleString()} mapped areas ·{' '}
                {focusedGroup.group.coverage === 'branch' ? 'Entry and descendants' : 'Own area'}
              </small>
            </div>
            <button type="button" onClick={() => removeGroup(focusedGroup.group.id)}>
              Remove group
            </button>
          </div>
        ) : focusedEntry ? (
          <div className="focused-map-entry" data-entry-id={focusedEntry.id}>
            <span
              className="language-swatch"
              style={{
                backgroundColor:
                  areas.find(({ id }) => id === focusedEntry.id)?.color ?? colors.get(detail.id),
              }}
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
        {!canFocusMap && (
          <p className="finder-detail__context" role="status">
            {(panel.detailEntryId && !focusedEntry) || (panel.detailGroupId && !focusedGroup)
              ? 'This map entry has been removed.'
              : 'No mapped area for this representation.'}
          </p>
        )}
        <LanguageWordsButton language={detail} />
        <LanguageFeatures profileId={detail.id} />
        <SidebarPane className="finder-detail__more" title="More details">
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
          <h4>Geography for the next Add to map</h4>
          <p>
            Select entries in Explore, then choose Add to map. By default, each group includes its
            entry and all mapped descendants.
          </p>
          {(focusedEntry || focusedGroup) && draftSelection}
          {mappedBranch && mappedBranch.languageIds.length > 0 && (
            <details className="finder-detail__aggregation">
              <summary>
                Available mapped areas ({mappedBranch.languageIds.length.toLocaleString()})
              </summary>
              <p>Descendants refine overlapping ancestor areas. Missing areas are not inferred.</p>
              <ul>
                {mappedBranch.languageIds.map((id) => {
                  const variant = availability.get(id)?.own
                  return (
                    <li key={id}>
                      <button type="button" onClick={() => openDetails(id)}>
                        {data.languageById.get(id)?.name ?? id}
                      </button>
                      <small>{variant?.label}</small>
                    </li>
                  )
                })}
              </ul>
            </details>
          )}
          {detailVariants.length > 1 ? (
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
          {activeVariant && (
            <GeometrySourceRecords
              key={activeVariant.id}
              manifest={data.manifest}
              variant={activeVariant}
            />
          )}
        </SidebarPane>
        <button type="button" className="finder-detail__reveal" onClick={() => reveal(detail.id)}>
          Show in classification
        </button>
      </div>
    </section>
  )
}
