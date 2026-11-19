import { useAtomValue, useSetAtom } from 'jotai'
import { DetailsHeader } from '../../components/DetailsHeader'
import { LanguageSummarySection } from '../../components/LanguageSummarySection'
import { languageAncestors } from '../../domain/hierarchy'
import {
  atlasDataAtom,
  geographyAvailabilityAtom,
  languageHierarchyAtom,
} from '../../state/atlasState'
import { explorerActionAtom } from '../../state/explorerState.ts'
import {
  closeLanguageDetailsAtom,
  languagePanelAtom,
  openLanguageDetailsAtom,
  revealLanguageAtom,
  toggleLanguageDetailPlacementAtom,
} from '../../state/languageControls'
import { clearMapIsolationAtom, mapIsolationAtom } from '../../state/mapInteraction.ts'
import { useLanguageIsolation } from '../map/useLanguageIsolation.ts'
import '../../components/detailsMapAction.css'
import { LanguageRegions } from '../administrative/LanguageRegions.tsx'
import {
  administrativeLanguagePlacementAtom,
  administrativeRepositoryAtom,
  selectAdministrativeAtom,
  toggleAdministrativeLanguagePlacementAtom,
} from '../administrative/state.ts'
import { LanguageFeatures } from '../wals/LanguageFeatures.tsx'
import { useLanguagePreview } from './LanguagePreview'
import { LanguageWordsButton } from './LanguageWordsButton.tsx'

export const LanguageDetails = ({ sourceCode }: { readonly sourceCode?: string }) => {
  const panel = useAtomValue(languagePanelAtom)
  const isolation = useAtomValue(mapIsolationAtom)
  const isolateLanguage = useLanguageIsolation()
  const clearIsolation = useSetAtom(clearMapIsolationAtom)
  const administrativePlacement = useAtomValue(administrativeLanguagePlacementAtom)
  const data = useAtomValue(atlasDataAtom)
  const availability = useAtomValue(geographyAvailabilityAtom)
  const administrativeRepository = useAtomValue(administrativeRepositoryAtom)
  const selectAdministrative = useSetAtom(selectAdministrativeAtom)
  const dispatch = useSetAtom(explorerActionAtom)
  const hierarchy = useAtomValue(languageHierarchyAtom)
  const openDetails = useSetAtom(openLanguageDetailsAtom)
  const closeDetails = useSetAtom(closeLanguageDetailsAtom)
  const togglePlacement = useSetAtom(toggleLanguageDetailPlacementAtom)
  const toggleAdministrativePlacement = useSetAtom(toggleAdministrativeLanguagePlacementAtom)
  const reveal = useSetAtom(revealLanguageAtom)
  const sourceLanguage = sourceCode
    ? administrativeRepository?.languageByCode.get(sourceCode)
    : null
  const detailId = sourceCode
    ? sourceLanguage?.glottocode && data.languageById.has(sourceLanguage.glottocode)
      ? sourceLanguage.glottocode
      : null
    : panel.detailId
  const profileTarget = {
    languageId: detailId ?? '',
    ...(!sourceCode && panel.detailEntryId ? { entryId: panel.detailEntryId } : {}),
    ...(!sourceCode && panel.detailGroupId ? { groupId: panel.detailGroupId } : {}),
  }
  const preview = useLanguagePreview(profileTarget, Boolean(detailId))
  const detail = detailId ? data.languageById.get(detailId) : undefined
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
      <div
        id="focused-language-body"
        className="finder-detail__body"
        key={`${detail?.id ?? sourceCode}/${sourceCode ?? ''}/${panel.detailGroupId ?? ''}/${panel.detailEntryId ?? ''}`}
      >
        {detail && (
          <div className="details-map-action">
            <button
              type="button"
              className="details-map-action__button"
              disabled={!availability.get(detail.id)?.hasAnyAreas}
              onClick={() =>
                isolation?.kind === 'language' && isolation.id === detail.id
                  ? clearIsolation()
                  : isolateLanguage(detail.id)
              }
            >
              {isolation?.kind === 'language' && isolation.id === detail.id
                ? 'Show all languages'
                : 'Isolate language'}
            </button>
          </div>
        )}
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
