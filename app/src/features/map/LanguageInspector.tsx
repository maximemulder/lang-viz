import { useAtomValue } from 'jotai'
import { Popup } from 'react-map-gl/maplibre'
import { inspectedMapAreaIds } from '../../domain/aggregation'
import { temporalQualityLabel } from '../../domain/temporal'
import { atlasDataAtom, languageColorsAtom, selectedMapAreasAtom } from '../../state/atlasState'

export interface MapInspection {
  readonly longitude: number
  readonly latitude: number
  readonly variantIds: readonly string[]
  readonly pinned: boolean
}

interface LanguageInspectorProps {
  readonly inspection: MapInspection
  readonly onClose: () => void
}

export const LanguageInspector = ({ inspection, onClose }: LanguageInspectorProps) => {
  const data = useAtomValue(atlasDataAtom)
  const areas = useAtomValue(selectedMapAreasAtom)
  const colors = useAtomValue(languageColorsAtom)
  const datasetsById = new Map(data.datasets.map((dataset) => [dataset.id, dataset]))
  const entries = inspectedMapAreaIds(inspection.variantIds, areas).flatMap((variantId) => {
    const area = areas.find(({ id }) => id === variantId)
    const variant = data.variantById.get(variantId) ?? area?.variants[0]
    const language = variant
      ? data.languageById.get(area?.languageId ?? variant.languageId)
      : undefined
    if (!variant || !language) return []

    return [{ language, variant, area, dataset: datasetsById.get(variant.datasetId) }]
  })

  if (entries.length === 0) return null

  return (
    <Popup
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
      <section aria-label="Languages at this location">
        <header className="language-inspector__header">
          <strong>
            {entries.length === 1 ? entries[0]?.language.name : `${entries.length} entries here`}
          </strong>
          {!inspection.pinned && <small>Click to keep open</small>}
        </header>

        <div className="language-inspector__entries">
          {entries.map(({ language, variant, area, dataset }) => (
            <article className="language-inspector__entry" key={area?.id ?? variant.id}>
              <span
                className="language-inspector__swatch"
                style={{ backgroundColor: area?.color ?? colors.get(language.id) }}
                aria-hidden="true"
              />
              <div>
                {entries.length > 1 && <strong>{language.name}</strong>}
                <p>
                  {language.level}
                  {language.familyName ? ` · ${language.familyName}` : ''}
                </p>
                <small>
                  {language.iso6393 ? `${language.iso6393} · ` : ''}
                  {language.id}
                </small>
                {area?.mode === 'descendants' ? (
                  <>
                    <small>Descendant areas · {area.variants.length} contributing entries</small>
                    <small>
                      {[
                        ...new Set(
                          area.variants.map(
                            (item) => datasetsById.get(item.datasetId)?.shortName ?? item.datasetId,
                          ),
                        ),
                      ].join(', ')}{' '}
                      ·{' '}
                      {[...new Set(area.variants.map((item) => item.temporalCoverage.label))].join(
                        ', ',
                      )}
                    </small>
                    <small>Combined available branches; coverage may be incomplete.</small>
                  </>
                ) : (
                  <>
                    <small>
                      {dataset?.shortName ?? variant.datasetId} · {variant.temporalCoverage.label} ·{' '}
                      {temporalQualityLabel(variant.temporalCoverage.quality)}
                    </small>
                    <small>
                      {variant.geometryKind === 'source'
                        ? 'Original source areas'
                        : 'Area supplied by the dataset'}
                    </small>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>
    </Popup>
  )
}
