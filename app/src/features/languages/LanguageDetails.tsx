import { useAtomValue, useSetAtom } from 'jotai'
import { useMemo } from 'react'
import { DetailsHeader } from '../../components/DetailsHeader'
import { LanguageSummarySection } from '../../components/LanguageSummarySection'
import { mappedBranchForLanguage } from '../../domain/aggregation'
import { languageAncestors } from '../../domain/hierarchy'
import { targetGeometry } from '../../domain/languageFocus'
import { mapEntryDescription } from '../../domain/mapEntries'
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
import { explorerActionAtom } from '../../state/explorerState.ts'
import {
  closeLanguageDetailsAtom,
  focusLanguageOnMapAtom,
  languagePanelAtom,
  openLanguageDetailsAtom,
  revealLanguageAtom,
  toggleLanguageDetailPlacementAtom,
} from '../../state/languageControls'
import { clearMapIsolationAtom, mapIsolationAtom } from '../../state/mapInteraction.ts'
import { searchCoverageAtom } from '../../state/searchSelection'
import { LanguageRegions } from '../administrative/LanguageRegions.tsx'
import {
  administrativeLanguagePlacementAtom,
  administrativeRepositoryAtom,
  selectAdministrativeAtom,
  toggleAdministrativeLanguagePlacementAtom,
} from '../administrative/state.ts'
import { LanguageFeatures } from '../wals/LanguageFeatures.tsx'
import { GeometrySourceRecords } from './GeometrySourceRecords'
import { useLanguagePreview } from './LanguagePreview'
import { LanguageWordsButton } from './LanguageWordsButton.tsx'
import { PinnedMapEntries } from './PinnedMapEntries'
import '../../components/detailsMapAction.css'

export const LanguageDetails = ({ sourceCode }: { readonly sourceCode?: string }) => {
  const panel = useAtomValue(languagePanelAtom)
  const administrativePlacement = useAtomValue(administrativeLanguagePlacementAtom)
  const data = useAtomValue(atlasDataAtom)
  const administrativeRepository = useAtomValue(administrativeRepositoryAtom)
  const selectAdministrative = useSetAtom(selectAdministrativeAtom)
  const dispatch = useSetAtom(explorerActionAtom)
  const hierarchy = useAtomValue(languageHierarchyAtom)
  const availability = useAtomValue(geographyAvailabilityAtom)
  const coverage = useAtomValue(searchCoverageAtom)
  const overrides = useAtomValue(geometryOverridesAtom)
  const colors = useAtomValue(languageColorsAtom)
  const areas = useAtomValue(selectedMapAreasAtom)
  const setGeometryOverride = useSetAtom(setGeometryOverrideAtom)
  const openDetails = useSetAtom(openLanguageDetailsAtom)
  const closeDetails = useSetAtom(closeLanguageDetailsAtom)
  const focusLanguage = useSetAtom(focusLanguageOnMapAtom)
  const isolation = useAtomValue(mapIsolationAtom)
  const setIsolation = useSetAtom(mapIsolationAtom)
  const clearIsolation = useSetAtom(clearMapIsolationAtom)
  const togglePlacement = useSetAtom(toggleLanguageDetailPlacementAtom)
  const toggleAdministrativePlacement = useSetAtom(toggleAdministrativeLanguagePlacementAtom)
  const entries = useAtomValue(mapEntriesAtom)
  const groups = useAtomValue(mapGroupsAtom)
  const removeEntry = useSetAtom(removeMapEntryAtom)
  const removeGroup = useSetAtom(removeMapGroupAtom)
  const reveal = useSetAtom(revealLanguageAtom)
  const sourceLanguage = sourceCode
    ? administrativeRepository?.languageByCode.get(sourceCode)
    : null
  const detailId = sourceCode
    ? sourceLanguage?.glottocode && data.languageById.has(sourceLanguage.glottocode)
      ? sourceLanguage.glottocode
      : null
    : panel.detailId
  const profileTarget = useMemo(
    () => ({
      languageId: detailId ?? '',
      ...(!sourceCode && panel.detailEntryId ? { entryId: panel.detailEntryId } : {}),
      ...(!sourceCode && panel.detailGroupId ? { groupId: panel.detailGroupId } : {}),
    }),
    [detailId, sourceCode, panel.detailEntryId, panel.detailGroupId],
  )
  const preview = useLanguagePreview(profileTarget, Boolean(detailId))
  const detail = detailId ? data.languageById.get(detailId) : undefined
  const detailAvailability = detail ? availability.get(detail.id) : undefined
  const mappedBranch = useMemo(
    () => (detailId ? mappedBranchForLanguage(detailId, hierarchy, availability) : undefined),
    [detailId, hierarchy, availability],
  )
  const detailVariants = detailAvailability?.ownVariants ?? []
  const activeVariant =
    detailVariants.find((variant) => variant.id === overrides[detailId ?? '']) ?? detailVariants[0]
  const focusedEntry = sourceCode
    ? undefined
    : entries.find((entry) => entry.id === panel.detailEntryId && entry.languageId === detailId)
  const focusedGroup = sourceCode
    ? undefined
    : groups.find(({ group }) => group.id === panel.detailGroupId)
  const canFocusMap =
    targetGeometry(profileTarget, data, availability, coverage, hierarchy, entries).length > 0
  const isolationVariantIds = useMemo(
    () =>
      targetGeometry(
        profileTarget,
        data,
        availability,
        detail?.level === 'family' || !detailAvailability?.own ? 'branch' : 'own',
        hierarchy,
        entries,
      ).map(({ id }) => id),
    [profileTarget, data, availability, detail?.level, detailAvailability, hierarchy, entries],
  )
  const isIsolated =
    isolation?.kind === 'language' &&
    isolation.variantIds.length === isolationVariantIds.length &&
    isolation.variantIds.every((id, index) => id === isolationVariantIds[index])
  const inspectAtlas = (languageId: string) => {
    openDetails(languageId, sourceCode ? 'sidebar' : undefined)
    if (sourceCode) dispatch({ type: 'map-mode', mode: 'language' })
  }
  if (!detail && !sourceLanguage) return null
  const classification = detail?.classification
  const placement = sourceCode ? administrativePlacement : panel.detailPlacement
  const placementLabel =
    placement === 'cover'
      ? `Show ${sourceCode ? 'region' : 'language'} controls beside details`
      : `Show details over ${sourceCode ? 'region' : 'language'} controls`
  return (
    <section
      {...preview}
      className="finder-detail"
      aria-label="Entry details"
      aria-labelledby="focused-language-name"
    >
      <DetailsHeader
        className="finder-detail__header"
        identityClassName="finder-detail__heading"
        closeClassName="finder-detail__close"
        titleId="focused-language-name"
        title={detail?.name ?? sourceLanguage?.name ?? ''}
        subtitle={
          <>
            {detail?.id ?? sourceCode}
            {detail?.iso6393 ? ` · ${detail.iso6393}` : ''}
          </>
        }
        action={
          <button
            type="button"
            className="details-header__icon"
            aria-label={placementLabel}
            title={placementLabel}
            onClick={sourceCode ? toggleAdministrativePlacement : togglePlacement}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d={placement === 'cover' ? 'M12 8H4m0 0 3-3M4 8l3 3' : 'M4 8h8m0 0-3-3M12 8l-3 3'}
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        }
        closeLabel="Close language details"
        onClose={() => {
          if (sourceCode) {
            const restoreFocus = document.querySelector<HTMLElement>(
              '.administrative-results button[aria-current="true"]',
            )
            selectAdministrative(null)
            restoreFocus?.focus({ preventScroll: true })
            return
          }
          const restoreFocus =
            panel.detailOrigin === 'map'
              ? document.querySelector<HTMLElement>('.map-shell .maplibregl-canvas')
              : (document.querySelector<HTMLElement>(
                  `#language-panel-${panel.view} [data-inspected="true"] :is(.language-row__identity, .on-map-row__identity)`,
                ) ?? document.getElementById(`language-tab-${panel.view}`))
          closeDetails()
          restoreFocus?.focus({ preventScroll: true })
        }}
      />
      {detail && !sourceCode && (
        <div className="details-map-action">
          <button
            type="button"
            className="details-map-action__button"
            disabled={!isolationVariantIds.length}
            onClick={() => {
              if (isIsolated) {
                clearIsolation()
                return
              }
              const cameraRequest = focusLanguage(profileTarget, isolationVariantIds)
              setIsolation({
                kind: 'language',
                label: detail.name,
                variantIds: isolationVariantIds,
                color: '#df7546',
                cameraRequest,
              })
            }}
          >
            {isIsolated ? 'End isolation' : 'Isolate language'}
          </button>
        </div>
      )}
      <div
        id="focused-language-body"
        className="finder-detail__body"
        key={`${detail?.id ?? sourceCode}/${sourceCode ?? ''}/${panel.detailGroupId ?? ''}/${panel.detailEntryId ?? ''}`}
      >
        <LanguageSummarySection section="genealogy">
          {detail ? (
            <>
              <nav className="finder-detail__path" aria-label="Classification ancestors">
                {languageAncestors(hierarchy, detail).map((ancestor) => (
                  <button type="button" key={ancestor.id} onClick={() => inspectAtlas(ancestor.id)}>
                    {ancestor.name}
                    <span aria-hidden="true"> ›</span>
                  </button>
                ))}
              </nav>
              {classification?.kind === 'source' && (
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
              <button
                type="button"
                className="finder-detail__reveal"
                onClick={() => {
                  reveal(detail.id)
                  if (sourceCode) dispatch({ type: 'map-mode', mode: 'language' })
                }}
              >
                Show in classification
              </button>
            </>
          ) : (
            <p>
              CLDR language code {sourceCode}. No reviewed Glottocode links this record to the atlas
              classification.
            </p>
          )}
        </LanguageSummarySection>
        <LanguageSummarySection section="regions">
          <LanguageRegions
            glottocode={detail?.classification.kind === 'glottolog' ? detail.id : null}
            sourceCode={sourceCode}
          />
        </LanguageSummarySection>
        <LanguageSummarySection section="map">
          {detail ? (
            <>
              {focusedGroup ? (
                <div className="focused-map-entry" data-group-id={focusedGroup.group.id}>
                  <div>
                    <strong>
                      {focusedGroup.entries[0] &&
                        mapEntryDescription(focusedGroup.entries[0], data)}
                    </strong>
                    <small>
                      {focusedGroup.entries.length.toLocaleString()} mapped areas ·{' '}
                      {focusedGroup.group.coverage === 'branch'
                        ? 'Entry and descendants'
                        : 'Own area'}
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
                        areas.find(({ id }) => id === focusedEntry.id)?.color ??
                        colors.get(detail.id),
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
              ) : null}
              {!canFocusMap && (
                <p className="finder-detail__context" role="status">
                  {!sourceCode &&
                  ((panel.detailEntryId && !focusedEntry) || (panel.detailGroupId && !focusedGroup))
                    ? 'This map entry has been removed.'
                    : 'No mapped area for this representation.'}
                </p>
              )}
              <PinnedMapEntries
                languageId={detail.id}
                focusedEntryId={sourceCode ? null : panel.detailEntryId}
              />
              {mappedBranch && mappedBranch.languageIds.length > 0 && (
                <details className="finder-detail__aggregation">
                  <summary>
                    Available mapped areas ({mappedBranch.languageIds.length.toLocaleString()})
                  </summary>
                  <p>
                    Descendants refine overlapping ancestor areas. Missing areas are not inferred.
                  </p>
                  <ul>
                    {mappedBranch.languageIds.map((id) => {
                      const variant = availability.get(id)?.own
                      return (
                        <li key={id}>
                          <button type="button" onClick={() => inspectAtlas(id)}>
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
            </>
          ) : (
            <p>No atlas map record is linked to this CLDR language.</p>
          )}
        </LanguageSummarySection>
        <LanguageSummarySection section="features">
          {detail ? (
            <LanguageFeatures profileId={detail.id} />
          ) : (
            <p>No linked atlas feature record.</p>
          )}
        </LanguageSummarySection>
        <LanguageSummarySection section="etymology">
          {detail ? (
            <LanguageWordsButton language={detail} />
          ) : (
            <p>No linked atlas word history.</p>
          )}
        </LanguageSummarySection>
      </div>
    </section>
  )
}
