import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useEffect, useMemo } from 'react'
import { DetailsHeader } from '../../components/DetailsHeader.tsx'
import { SidebarTabs } from '../../components/SidebarTabs.tsx'
import type { AdministrativeRepository } from './model.ts'
import {
  navigateAdministrativeAtom,
  showCheckedTerritoriesAtom,
  zoomAdministrativeAtom,
} from './navigation.ts'
import { number, ObservationList, percent, regionLabel } from './ObservationList.tsx'
import {
  searchFamilies,
  searchLanguages,
  searchTerritories,
  selectFamily,
  selectTerritory,
} from './selectors.ts'
import {
  type AdministrativeSelection,
  administrativeLoadStateAtom,
  administrativeRepositoryAtom,
  administrativeSessionAtom,
  boundaryIndexAtom,
  checkedTerritoriesAtom,
  loadAdministrativeAtom,
  selectAdministrativeAtom,
  selectCheckedTerritoriesAtom,
  setAdministrativeMetricAtom,
  setAdministrativeQueryAtom,
  setAdministrativeSearchKindAtom,
  toggleCheckedTerritoryAtom,
} from './state.ts'
import './administrative.css'

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
  if (selection.kind === 'language') return null
  const detail = selectFamily(repository, selection.id)
  if (!detail) return null
  return (
    <section className="administrative-detail" aria-label="Family details">
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
  const navigate = useSetAtom(navigateAdministrativeAtom)
  const names = useMemo(() => new Intl.DisplayNames(undefined, { type: 'region' }), [])
  if (!session.selection) return null
  const selection = session.selection
  if (selection.kind === 'source-shape') {
    const shape = boundaryIndex?.features.find((feature) => feature.featureId === selection.id)
    if (!shape) return null
    return (
      <div className="administrative-detail-scroll">
        <DetailsHeader
          className="administrative-inspector-header"
          title={shape.sourceName}
          subtitle="Natural Earth administrative shape"
          closeLabel={`Close ${shape.sourceName} details`}
          onClose={() => select(null)}
        />
        <p className="administrative-note">No language estimates available.</p>
      </div>
    )
  }
  if (!repository || selection.kind === 'language') return null
  const title =
    selection.kind === 'territory'
      ? regionLabel(selection.id, names)
      : repository.familyById.get(selection.id)?.name
  if (!title) return null

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
      <Details
        repository={repository}
        selection={session.selection}
        onSelect={(selection) => void navigate(selection)}
        names={names}
      />
    </div>
  )
}

export default function AdministrativePanel() {
  const [checked, setChecked] = useAtom(checkedTerritoriesAtom)
  const toggleChecked = useSetAtom(toggleCheckedTerritoryAtom)
  const selectChecked = useSetAtom(selectCheckedTerritoriesAtom)
  const showChecked = useSetAtom(showCheckedTerritoriesAtom)
  const zoomRegion = useSetAtom(zoomAdministrativeAtom)
  const boundaries = useAtomValue(boundaryIndexAtom)
  const repository = useAtomValue(administrativeRepositoryAtom)
  const loadState = useAtomValue(administrativeLoadStateAtom)
  const session = useAtomValue(administrativeSessionAtom)
  const load = useSetAtom(loadAdministrativeAtom)
  const setQuery = useSetAtom(setAdministrativeQueryAtom)
  const setKind = useSetAtom(setAdministrativeSearchKindAtom)
  const navigate = useSetAtom(navigateAdministrativeAtom)
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
  const visibleResults = session.searchKind === 'territory' ? results : results.slice(0, 60)

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
              { value: 'territory', label: 'Regions' },
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
            </fieldset>
            <label className="administrative-search-field">
              Find {session.searchKind === 'territory' ? 'a region' : `a ${session.searchKind}`}
              <input
                type="search"
                value={session.query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Name or source code"
              />
            </label>
            {session.searchKind === 'territory' && (
              <div className="administrative-selection-actions">
                <button type="button" onClick={() => selectChecked(results.map(({ id }) => id))}>
                  Select all
                </button>
                <button type="button" disabled={!checked.length} onClick={() => setChecked([])}>
                  Clear selection
                </button>
              </div>
            )}
            <section className="administrative-results" aria-label="Search results">
              <p>
                {number(results.length)}{' '}
                {session.searchKind === 'territory' ? 'regions' : `${session.searchKind}s`}
                {results.length > visibleResults.length
                  ? ` · first ${visibleResults.length} shown`
                  : ''}
              </p>
              {results.length === 0 && <p>No matches.</p>}
              <ul>
                {visibleResults.map((item) => (
                  <li className="administrative-result-row" key={`${item.kind}:${item.id}`}>
                    <button
                      type="button"
                      aria-current={
                        session.selection?.kind === item.kind && session.selection.id === item.id
                          ? 'true'
                          : undefined
                      }
                      onDoubleClick={() => {
                        void zoomRegion({ kind: item.kind, id: item.id })
                      }}
                      onClick={() => void navigate({ kind: item.kind, id: item.id })}
                    >
                      {item.label} <span className="administrative-code">{item.id}</span>
                    </button>
                    {item.kind === 'territory' && (
                      <input
                        type="checkbox"
                        aria-label={`Select ${item.label}`}
                        checked={checked.includes(item.id)}
                        disabled={boundaries?.associations.get(item.id)?.status !== 'matched'}
                        onChange={() => toggleChecked(item.id)}
                      />
                    )}
                  </li>
                ))}
              </ul>
            </section>
            {session.searchKind === 'territory' && (
              <footer className="administrative-selection-footer">
                <strong>{checked.length} selected</strong>
                <button
                  type="button"
                  className="finder-add"
                  disabled={!checked.length}
                  onClick={() => showChecked()}
                >
                  Show selected on map
                </button>
              </footer>
            )}
            <details className="administrative-source">
              <summary>Sources</summary>
              <p>
                CLDR {repository.data.manifest.cldrRelease} ·{' '}
                <a href="https://cldr.unicode.org/" target="_blank" rel="noreferrer">
                  Unicode CLDR
                </a>{' '}
                ·{' '}
                <a href="https://glottolog.org/" target="_blank" rel="noreferrer">
                  Glottolog
                </a>
              </p>
            </details>
          </section>
        </>
      )}
    </aside>
  )
}
