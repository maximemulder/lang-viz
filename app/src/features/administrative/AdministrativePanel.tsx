import { useAtomValue, useSetAtom } from 'jotai'
import { type CSSProperties, useEffect, useMemo } from 'react'
import { DetailsHeader } from '../../components/DetailsHeader.tsx'
import { DetailsMapAction } from '../../components/DetailsMapAction.tsx'
import { SidebarTabs } from '../../components/SidebarTabs.tsx'
import type { AdministrativeRepository, Observation } from './model.ts'
import {
  type ReportedObservation,
  searchFamilies,
  searchLanguages,
  searchTerritories,
  selectFamily,
  selectLanguage,
  selectTerritory,
} from './selectors.ts'
import {
  type AdministrativeSelection,
  administrativeLoadStateAtom,
  administrativeRepositoryAtom,
  administrativeSessionAtom,
  boundaryIndexAtom,
  focusAdministrativeTerritoryAtom,
  loadAdministrativeAtom,
  selectAdministrativeAtom,
  setAdministrativeMetricAtom,
  setAdministrativeQueryAtom,
  setAdministrativeSearchKindAtom,
} from './state.ts'
import './administrative.css'

const number = (value: number) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value)
const percent = (value: string) =>
  `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`
const statusLabel: Record<Observation['officialStatus'], string> = {
  unspecified: '',
  official: 'Official',
  official_regional: 'Official regionally',
  de_facto_official: 'De facto official',
  official_minority: 'Official minority',
}

/** Display names are a browser-locale convenience; source territory codes remain visible. */
const regionLabel = (code: string, names: Intl.DisplayNames): string => {
  try {
    return names.of(code) || code
  } catch {
    return code
  }
}

const ObservationList = ({
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

const Details = ({
  repository,
  selection,
  onSelect,
  names,
}: {
  readonly repository: AdministrativeRepository
  readonly selection: AdministrativeSelection
  readonly onSelect: (selection: AdministrativeSelection) => void
  readonly names: Intl.DisplayNames
}) => {
  if (selection.kind === 'territory') {
    const detail = selectTerritory(repository, selection.id)
    if (!detail) return null
    return (
      <section className="administrative-detail" aria-label="Territory details">
        <p className="administrative-muted">
          CLDR statistical area. This code is independent of any displayed polygon.
        </p>
        <dl className="administrative-facts">
          <div>
            <dt>Reported population</dt>
            <dd>{number(Number(detail.territory.population))}</dd>
          </div>
          <div>
            <dt>Territory literacy</dt>
            <dd>{percent(detail.territory.literacyPercent)}</dd>
          </div>
          <div>
            <dt>Language observations</dt>
            <dd>{number(detail.observations.length)}</dd>
          </div>
        </dl>
        {detail.overlappingPercentages && (
          <p className="administrative-note">
            Reported language percentages total more than 100% here. They overlap and must not be
            read as exclusive population shares.
          </p>
        )}
        <ObservationList
          rows={detail.observations}
          heading="Reported language estimates"
          destination="language"
          onSelect={onSelect}
          names={names}
        />
      </section>
    )
  }
  if (selection.kind === 'language') {
    const detail = selectLanguage(repository, selection.id)
    if (!detail) return null
    const { language } = detail
    return (
      <section className="administrative-detail" aria-label="Language details">
        <p className="administrative-muted">
          Source language code {language.sourceLanguageCode}; Glottolog {language.glottocode}. This
          association does not identify an atlas speaker polygon.
        </p>
        <dl className="administrative-facts">
          <div>
            <dt>Reported areas</dt>
            <dd>{number(detail.observations.length)}</dd>
          </div>
          <div>
            <dt>Sum of estimates</dt>
            <dd>{number(detail.sumOfReportedEstimates)}</dd>
          </div>
          {language.iso6393 && (
            <div>
              <dt>ISO 639-3</dt>
              <dd>{language.iso6393}</dd>
            </div>
          )}
        </dl>
        <p className="administrative-note">
          This sum adds reported territory estimates. It is not a count of distinct people; script
          variants and language categories can overlap.
        </p>
        {language.familyId && (
          <p>
            Glottolog family:{' '}
            <button
              className="administrative-link"
              type="button"
              onClick={() =>
                language.familyId && onSelect({ kind: 'family', id: language.familyId })
              }
            >
              {repository.familyById.get(language.familyId)?.name ?? language.familyId}
            </button>
          </p>
        )}
        <ObservationList
          rows={detail.observations}
          heading="Reported area estimates"
          destination="territory"
          onSelect={onSelect}
          names={names}
        />
      </section>
    )
  }
  const detail = selectFamily(repository, selection.id)
  if (!detail) return null
  return (
    <section className="administrative-detail" aria-label="Family details">
      <p className="administrative-muted">
        Glottolog family assigned to source language associations.
      </p>
      <dl className="administrative-facts">
        <div>
          <dt>Observed languages</dt>
          <dd>{number(detail.languages.length)}</dd>
        </div>
        <div>
          <dt>Reported rows</dt>
          <dd>{number(detail.observations.length)}</dd>
        </div>
        <div>
          <dt>Sum of estimates</dt>
          <dd>{number(detail.sumOfReportedEstimates)}</dd>
        </div>
      </dl>
      <p className="administrative-note">
        This is a sum of reported estimates, not unique speakers. Rows can overlap within a
        territory and across script variants.
      </p>
      <h4>Languages in this supplement</h4>
      <ul className="administrative-family-languages">
        {detail.languages.map((language) => (
          <li key={language.sourceLanguageCode}>
            <button
              type="button"
              onClick={() => onSelect({ kind: 'language', id: language.sourceLanguageCode })}
            >
              {language.name}{' '}
              <span className="administrative-code">{language.sourceLanguageCode}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

export const AdministrativeDetails = () => {
  const repository = useAtomValue(administrativeRepositoryAtom)
  const session = useAtomValue(administrativeSessionAtom)
  const boundaryIndex = useAtomValue(boundaryIndexAtom)
  const select = useSetAtom(selectAdministrativeAtom)
  const focus = useSetAtom(focusAdministrativeTerritoryAtom)
  const names = useMemo(() => new Intl.DisplayNames(undefined, { type: 'region' }), [])
  if (!repository || !session.selection) return null
  const selection = session.selection
  const title =
    selection.kind === 'territory'
      ? regionLabel(selection.id, names)
      : selection.kind === 'language'
        ? repository.languageByCode.get(selection.id)?.name
        : repository.familyById.get(selection.id)?.name
  if (!title) return null
  const canFocusMap = boundaryIndex?.associations.get(selection.id)?.status === 'matched'
  return (
    <div className="administrative-detail-scroll">
      <DetailsHeader
        className="administrative-inspector-header"
        title={title}
        subtitle={
          <>
            <span className="administrative-code">{selection.id}</span> ·{' '}
            {selection.kind === 'family' ? 'Glottolog' : 'CLDR'}
          </>
        }
        closeLabel={`Close ${title} details`}
        onClose={() => {
          const origin = document.querySelector<HTMLElement>(
            '.administrative-results button[aria-current="true"]',
          )
          const restoreFocus =
            origin ?? document.querySelector<HTMLElement>('.administrative-search-field input')
          select(null)
          restoreFocus?.focus({ preventScroll: true })
        }}
      />
      {selection.kind === 'territory' && (
        <DetailsMapAction disabled={!canFocusMap} onFocus={() => focus(selection.id)} />
      )}
      {selection.kind === 'territory' && boundaryIndex && !canFocusMap && (
        <p className="administrative-note">
          No matched polygon or representative point in this boundary view. The CLDR observations
          remain available below.
        </p>
      )}
      <Details
        repository={repository}
        selection={session.selection}
        onSelect={select}
        names={names}
      />
    </div>
  )
}

export default function AdministrativePanel() {
  const repository = useAtomValue(administrativeRepositoryAtom)
  const loadState = useAtomValue(administrativeLoadStateAtom)
  const session = useAtomValue(administrativeSessionAtom)
  const load = useSetAtom(loadAdministrativeAtom)
  const setQuery = useSetAtom(setAdministrativeQueryAtom)
  const setKind = useSetAtom(setAdministrativeSearchKindAtom)
  const select = useSetAtom(selectAdministrativeAtom)
  const setMetric = useSetAtom(setAdministrativeMetricAtom)
  const names = useMemo(() => new Intl.DisplayNames(undefined, { type: 'region' }), [])
  useEffect(() => {
    void load()
  }, [load])

  const results = useMemo(() => {
    if (!repository) return []
    if (session.searchKind === 'territory')
      return [
        ...searchTerritories(repository, session.query, (territory) =>
          regionLabel(territory.code, names),
        ),
      ]
        .sort((a, b) => regionLabel(a.code, names).localeCompare(regionLabel(b.code, names)))
        .map((item) => ({
          kind: 'territory' as const,
          id: item.code,
          label: regionLabel(item.code, names),
        }))
    if (session.searchKind === 'language')
      return [...searchLanguages(repository, session.query)]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((item) => ({
          kind: 'language' as const,
          id: item.sourceLanguageCode,
          label: item.name,
        }))
    return [...searchFamilies(repository, session.query)]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((item) => ({ kind: 'family' as const, id: item.id, label: item.name }))
  }, [repository, session.searchKind, session.query, names])
  const visibleResults = results.slice(0, 60)

  return (
    <aside className="administrative-panel" aria-label="Administrative language statistics">
      {!repository ? (
        <div
          className="administrative-panel__status"
          role={loadState.status === 'error' ? 'alert' : 'status'}
        >
          {loadState.status === 'error' ? (
            <>
              <p>Administrative data is unavailable: {loadState.message}</p>
              <button type="button" onClick={() => void load()}>
                Retry data load
              </button>
            </>
          ) : (
            <p>Loading administrative observations…</p>
          )}
        </div>
      ) : (
        <>
          <SidebarTabs
            className="administrative-search-kind"
            idPrefix="administrative"
            label="Search by"
            selected={session.searchKind}
            onSelect={setKind}
            tabs={[
              { value: 'territory', label: 'Areas' },
              { value: 'language', label: 'Languages' },
              { value: 'family', label: 'Families' },
            ]}
          />
          <section
            className="administrative-search-panel"
            id={`administrative-panel-${session.searchKind}`}
            role="tabpanel"
            aria-labelledby={`administrative-tab-${session.searchKind}`}
          >
            <fieldset className="administrative-metrics">
              <legend>Map color</legend>
              <label>
                <input
                  type="radio"
                  name="administrative-metric"
                  checked={!session.metric}
                  onChange={() => setMetric(null)}
                />
                None
              </label>
              <label>
                <input
                  type="radio"
                  name="administrative-metric"
                  checked={session.metric?.kind === 'territory-population'}
                  onChange={() => setMetric({ kind: 'territory-population' })}
                />
                Reported population
              </label>
              <label>
                <input
                  type="radio"
                  name="administrative-metric"
                  checked={session.metric?.kind === 'territory-literacy'}
                  onChange={() => setMetric({ kind: 'territory-literacy' })}
                />
                Territory literacy
              </label>
              {session.selection?.kind === 'language' && (
                <label>
                  <input
                    type="radio"
                    name="administrative-metric"
                    checked={
                      session.metric?.kind === 'language-estimate' &&
                      session.metric.sourceLanguageCode === session.selection.id
                    }
                    onChange={() => {
                      if (session.selection?.kind === 'language')
                        setMetric({
                          kind: 'language-estimate',
                          sourceLanguageCode: session.selection.id,
                        })
                    }}
                  />
                  Selected language estimate
                </label>
              )}
              {session.selection?.kind === 'family' && (
                <label>
                  <input
                    type="radio"
                    name="administrative-metric"
                    checked={
                      session.metric?.kind === 'family-estimate' &&
                      session.metric.familyId === session.selection.id
                    }
                    onChange={() => {
                      if (session.selection?.kind === 'family')
                        setMetric({ kind: 'family-estimate', familyId: session.selection.id })
                    }}
                  />
                  Selected family estimate sum
                </label>
              )}
              <p>
                Color appears only for matched polygons when Borders is on. No value means no fill.
              </p>
            </fieldset>
            <label className="administrative-search-field">
              Find {session.searchKind === 'territory' ? 'an area' : `a ${session.searchKind}`}
              <input
                type="search"
                value={session.query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Name or source code"
              />
            </label>
            <section className="administrative-results" aria-label="Search results">
              <p>
                {number(results.length)}{' '}
                {session.searchKind === 'territory' ? 'areas' : `${session.searchKind}s`}
                {results.length > visibleResults.length
                  ? ` · first ${visibleResults.length} shown`
                  : ''}
              </p>
              {results.length === 0 && <p>No matches.</p>}
              <ul>
                {visibleResults.map((item) => (
                  <li key={`${item.kind}:${item.id}`}>
                    <button
                      type="button"
                      aria-current={
                        session.selection?.kind === item.kind && session.selection.id === item.id
                          ? 'true'
                          : undefined
                      }
                      onClick={() => select({ kind: item.kind, id: item.id })}
                    >
                      {item.label} <span className="administrative-code">{item.id}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
            <details className="administrative-source">
              <summary>About these estimates</summary>
              <p>
                Approximate functional speaker estimates may include first and later-language
                speakers. The source count is derived from territory population and reported
                percentage. Coverage is incomplete.
              </p>
              <p>
                The joined file’s original CLDR release and preprocessing are unverified. Its source
                codes are independent of map borders; browser-localized area names are display
                labels only.
              </p>
              <p>
                Snapshot: {number(repository.data.manifest.coverage.territoryCount)} areas,{' '}
                {number(repository.data.manifest.coverage.observationCount)} observations. CLDR
                release: {repository.data.manifest.cldrRelease ?? 'unknown'}.
              </p>
              <p>
                Sources:{' '}
                <a href="https://cldr.unicode.org/" target="_blank" rel="noreferrer">
                  Unicode CLDR
                </a>{' '}
                and{' '}
                <a href="https://glottolog.org/" target="_blank" rel="noreferrer">
                  Glottolog
                </a>
                .
              </p>
            </details>
          </section>
        </>
      )}
    </aside>
  )
}
