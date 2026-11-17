import type { CSSProperties } from 'react'
import type { Observation } from './model.ts'
import type { ReportedObservation } from './selectors.ts'
import type { AdministrativeSelection } from './state.ts'

export const number = (value: number) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value)
export const percent = (value: string) =>
  `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`
const statusLabel: Record<Observation['officialStatus'], string> = {
  unspecified: '',
  official: 'Official',
  official_regional: 'Official regionally',
  de_facto_official: 'De facto official',
  official_minority: 'Official minority',
}

/** Display names are a browser-locale convenience; source territory codes remain visible. */
export const regionLabel = (code: string, names: Intl.DisplayNames): string => {
  try {
    return names.of(code) || code
  } catch {
    return code
  }
}

export const ObservationList = ({
  rows,
  heading,
  destination,
  onSelect,
  names,
}: {
  readonly rows: readonly ReportedObservation[]
  readonly heading: string
  readonly destination: 'language' | 'territory'
  readonly onSelect: (selection: AdministrativeSelection) => void
  readonly names: Intl.DisplayNames
}) => {
  const max = Math.max(...rows.map((row) => row.estimatedSpeakers), 1)
  return (
    <section className="administrative-observations" aria-label={heading}>
      <h4>{heading}</h4>
      <p className="administrative-observations__definition">
        Approximate functional speakers, including later-language speakers. Each count is derived
        from territory population and the reported percentage; rows may overlap.
      </p>
      <ol>
        {rows.map((row) => {
          const id =
            destination === 'language'
              ? row.observation.sourceLanguageCode
              : row.observation.territoryCode
          const title = destination === 'language' ? row.language.name : regionLabel(id, names)
          return (
            <li key={`${row.observation.territoryCode}:${row.observation.sourceLanguageCode}`}>
              <div className="administrative-observation__top">
                <button type="button" onClick={() => onSelect({ kind: destination, id })}>
                  {title} <span className="administrative-code">{id}</span>
                </button>
                <strong>{number(row.estimatedSpeakers)}</strong>
              </div>
              <div
                className="administrative-observation__bar"
                aria-hidden="true"
                style={
                  { '--bar-width': `${(row.estimatedSpeakers / max) * 100}%` } as CSSProperties
                }
              />
              <p>
                {percent(row.observation.populationPercent)} of reported territory population
                {row.observation.officialStatus !== 'unspecified' &&
                  ` · ${statusLabel[row.observation.officialStatus]}`}
              </p>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
