import { useAtomValue, useSetAtom } from 'jotai'
import { Popup } from 'react-map-gl/maplibre'
import { walsAreaMatchesAtom } from '../../integrations/wals/areaState'
import { atlasDataAtom, languageColorsAtom, selectedMapAreasAtom } from '../../state/atlasState'
import { inspectLanguageFromMapAtom } from '../../state/languageControls'
import { readableWalsValue, WALS_TITLES } from '../wals/cards'
import { walsRepositoryAtom } from '../wals/state'

export interface MapInspection {
  readonly longitude: number
  readonly latitude: number
  readonly variantIds: readonly string[]
  readonly pinned: boolean
}
export const LanguageInspector = ({
  inspection,
  onClose,
  onSelect,
}: {
  readonly inspection: MapInspection
  readonly onClose: () => void
  readonly onSelect?: () => void
}) => {
  const data = useAtomValue(atlasDataAtom),
    areas = useAtomValue(selectedMapAreasAtom),
    colors = useAtomValue(languageColorsAtom)
  const matches = useAtomValue(walsAreaMatchesAtom),
    repository = useAtomValue(walsRepositoryAtom)
  const openDetails = useSetAtom(inspectLanguageFromMapAtom)
  const regionNames = new Intl.DisplayNames(['en'], { type: 'region' })
  const seen = new Set<string>()
  const entries = inspection.variantIds.flatMap((id) => {
    const area = areas.find((area) => area.id === id),
      variant = data.variantById.get(id) ?? area?.variants[0]
    const language = data.languageById.get(area?.languageId ?? variant?.languageId ?? '')
    if (!language || !variant || seen.has(language.id)) return []
    seen.add(language.id)
    const regions = language.countries.map((code) => {
      try {
        return regionNames.of(code) ?? code
      } catch {
        return code
      }
    })
    return [{ language, variant, area, regions }]
  })
  if (!entries.length) return null
  const category = repository?.data.categories[matches?.categoryId ?? '']
  return (
    <Popup
      key={inspection.pinned ? 'pinned' : 'hover'}
      longitude={inspection.longitude}
      latitude={inspection.latitude}
      anchor="bottom"
      offset={12}
      maxWidth="min(20rem, calc(100vw - 2rem))"
      closeButton={inspection.pinned}
      closeOnClick={false}
      className={`language-inspector${inspection.pinned ? ' language-inspector--pinned' : ''}`}
      onClose={onClose}
    >
      <section
        aria-label="Languages at this location"
        onMouseMove={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        {entries.length > 1 && (
          <header className="language-inspector__header">
            <strong>{entries.length} languages here</strong>
          </header>
        )}
        <div className="language-inspector__entries">
          {entries.map(({ language, variant, area, regions }) => (
            <article className="language-inspector__entry" key={language.id}>
              <span
                className="language-inspector__swatch"
                style={{ backgroundColor: area?.color ?? colors.get(language.id) }}
                aria-hidden="true"
              />
              <div>
                <strong>{language.name}</strong>
                <p className="language-inspector__context">
                  {language.familyName ? `${language.familyName} family` : 'Family not recorded'}
                </p>
                <p className="language-inspector__context" title={regions.join(', ')}>
                  {regions.length
                    ? `Regions: ${(inspection.pinned ? regions : regions.slice(0, 3)).join(', ')}${!inspection.pinned && regions.length > 3 ? ` + ${regions.length - 3} more` : ''}`
                    : 'Region information unavailable'}
                </p>
                {matches?.mappedIds.has(language.id) && category && (
                  <p className="language-inspector__context">
                    {WALS_TITLES[matches.featureId]}:{' '}
                    {readableWalsValue(matches.featureId, category.name)}
                  </p>
                )}
                {inspection.pinned ? (
                  <>
                    <button
                      type="button"
                      className="language-inspector__details"
                      aria-label={`Details for ${language.name}`}
                      onClick={() => {
                        onSelect?.()
                        openDetails({
                          languageId: language.id,
                          ...(area ? { entryId: area.id } : {}),
                        })
                        onClose()
                      }}
                    >
                      More details
                    </button>
                    <details>
                      <summary>Map source</summary>
                      <small>
                        {data.datasets.find((d) => d.id === variant.datasetId)?.name} ·{' '}
                        {variant.temporalCoverage.label}. Approximate language area.
                      </small>
                    </details>
                  </>
                ) : (
                  <small>Click for details · double-click to focus</small>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>
    </Popup>
  )
}
