import { useAtomValue } from 'jotai'
import { Popup } from 'react-map-gl/maplibre'
import { temporalQualityLabel } from '../../domain/temporal'
import { atlasDataAtom } from '../../state/atlasState'

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
  const datasetsById = new Map(data.datasets.map((dataset) => [dataset.id, dataset]))
  const entries = inspection.variantIds.flatMap((variantId) => {
    const variant = data.variantById.get(variantId)
    const language = variant ? data.languageById.get(variant.languageId) : undefined
    if (!variant || !language) return []

    return [{ language, variant, dataset: datasetsById.get(variant.datasetId) }]
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
            {entries.length === 1 ? entries[0]?.language.name : `${entries.length} languages here`}
          </strong>
          {!inspection.pinned && <small>Click to keep open</small>}
        </header>

        <div className="language-inspector__entries">
          {entries.map(({ language, variant, dataset }) => (
            <article className="language-inspector__entry" key={variant.id}>
              <span
                className="language-inspector__swatch"
                style={{ backgroundColor: variant.color }}
                aria-hidden="true"
              />
              <div>
                {entries.length > 1 && <strong>{language.name}</strong>}
                <p>{language.familyName ?? 'Unclassified'}</p>
                <small>
                  {language.iso6393 ? `${language.iso6393} · ` : ''}
                  {language.id}
                </small>
                <small>
                  {dataset?.shortName ?? variant.datasetId} · {variant.temporalCoverage.label} ·{' '}
                  {temporalQualityLabel(variant.temporalCoverage.quality)}
                </small>
              </div>
            </article>
          ))}
        </div>
      </section>
    </Popup>
  )
}
