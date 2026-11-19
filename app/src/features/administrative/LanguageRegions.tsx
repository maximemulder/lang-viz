import { useAtomValue, useSetAtom } from 'jotai'
import { useEffect, useMemo } from 'react'
import { explorerActionAtom } from '../../state/explorerState.ts'
import { navigateAdministrativeAtom } from './navigation.ts'
import { ObservationList } from './ObservationList.tsx'
import { selectLanguage } from './selectors.ts'
import {
  administrativeLoadStateAtom,
  administrativeRepositoryAtom,
  loadAdministrativeAtom,
} from './state.ts'
import './administrative.css'

/** Exact Glottocode identity, after the CLDR source join has been validated. */
export function LanguageRegions({
  glottocode,
  sourceCode,
}: {
  readonly glottocode: string | null
  readonly sourceCode?: string | undefined
}) {
  const repository = useAtomValue(administrativeRepositoryAtom)
  const loadState = useAtomValue(administrativeLoadStateAtom)
  const load = useSetAtom(loadAdministrativeAtom)
  const select = useSetAtom(navigateAdministrativeAtom)
  const dispatch = useSetAtom(explorerActionAtom)
  const names = useMemo(() => new Intl.DisplayNames(undefined, { type: 'region' }), [])
  useEffect(() => {
    if (!repository && loadState.status === 'idle') void load()
  }, [repository, loadState.status, load])

  if (!repository)
    return loadState.status === 'error' ? (
      <div className="administrative-panel__status" role="alert">
        <p>Region estimates could not be loaded. {loadState.message}</p>
        <button type="button" onClick={() => void load()}>
          Retry region estimates
        </button>
      </div>
    ) : (
      <p role="status">Loading CLDR region estimates…</p>
    )

  const codes = glottocode
    ? repository.data.languageAssociations
        .filter((language) => language.glottocode === glottocode)
        .map((language) => language.sourceLanguageCode)
    : sourceCode && repository.languageByCode.has(sourceCode)
      ? [sourceCode]
      : []
  if (!codes.length) return <p>No regional estimates available.</p>
  return (
    <div className="language-cldr-regions">
      {codes.map((code) => {
        const detail = selectLanguage(repository, code)
        if (!detail) return null
        return (
          <div key={code} className="language-cldr-regions__code">
            <ObservationList
              rows={detail.observations}
              heading={
                codes.length > 1
                  ? `${detail.language.name} · ${code}`
                  : `Reported regions · ${code}`
              }
              destination="territory"
              onSelect={(selection) => {
                void select(selection)
                dispatch({ type: 'map-mode', mode: 'region' })
              }}
              names={names}
            />
          </div>
        )
      })}
    </div>
  )
}
