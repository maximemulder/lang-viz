import { useAtomValue, useSetAtom } from 'jotai'
import { useEffect, useMemo } from 'react'
import { explorerActionAtom } from '../../state/explorerState.ts'
import { ObservationList } from './ObservationList.tsx'
import { selectLanguage } from './selectors.ts'
import {
  administrativeLoadStateAtom,
  administrativeRepositoryAtom,
  loadAdministrativeAtom,
  selectAdministrativeAtom,
} from './state.ts'
import './administrative.css'

/** Exact Glottocode identity, after the CLDR source join has been validated. */
export function LanguageAreas({
  glottocode,
  sourceCode,
}: {
  readonly glottocode: string | null
  readonly sourceCode?: string | undefined
}) {
  const repository = useAtomValue(administrativeRepositoryAtom)
  const loadState = useAtomValue(administrativeLoadStateAtom)
  const load = useSetAtom(loadAdministrativeAtom)
  const select = useSetAtom(selectAdministrativeAtom)
  const dispatch = useSetAtom(explorerActionAtom)
  const names = useMemo(() => new Intl.DisplayNames(undefined, { type: 'region' }), [])
  useEffect(() => {
    if (!repository && loadState.status === 'idle') void load()
  }, [repository, loadState.status, load])

  if (!repository)
    return loadState.status === 'error' ? (
      <div className="administrative-panel__status" role="alert">
        <p>Area estimates could not be loaded. {loadState.message}</p>
        <button type="button" onClick={() => void load()}>
          Retry area estimates
        </button>
      </div>
    ) : (
      <p role="status">Loading CLDR area estimates…</p>
    )

  const codes = glottocode
    ? repository.data.languageAssociations
        .filter((language) => language.glottocode === glottocode)
        .map((language) => language.sourceLanguageCode)
    : sourceCode && repository.languageByCode.has(sourceCode)
      ? [sourceCode]
      : []
  if (!codes.length) return <p>No CLDR area estimates are linked to this language.</p>
  return (
    <div className="language-cldr-areas">
      <p className="administrative-muted">
        CLDR territory estimates describe reported language use, not atlas speaker polygons. Script
        variants may overlap; their estimates are shown separately.
      </p>
      {codes.map((code) => {
        const detail = selectLanguage(repository, code)
        if (!detail) return null
        return (
          <div key={code} className="language-cldr-areas__code">
            <ObservationList
              rows={detail.observations}
              heading={
                codes.length > 1 ? `${detail.language.name} · ${code}` : `Reported areas · ${code}`
              }
              destination="territory"
              onSelect={(selection) => {
                select(selection)
                dispatch({ type: 'map-mode', mode: 'area' })
              }}
              names={names}
            />
          </div>
        )
      })}
    </div>
  )
}
