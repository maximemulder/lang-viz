import { useAtomValue, useSetAtom } from 'jotai'
import { hasLanguagePoint } from '../../domain/etymology.ts'
import { atlasWordTrailAtom, etymologyRepositoryAtom } from '../../features/etymology/state.ts'
import { explorerActionAtom, explorerSessionAtom } from '../../state/explorerState.ts'
import { addTrailAreasAtom, trailAreaOperationAtom } from './state.ts'
import { trailLanguageGroups } from './trailAreas.ts'
import { wordTrailVisibleAtom } from './visibility.ts'
import './wordTrailMap.css'

export default function WordTrailMapSummary() {
  const repository = useAtomValue(etymologyRepositoryAtom)
  const trail = useAtomValue(atlasWordTrailAtom)
  const session = useAtomValue(explorerSessionAtom)
  const dispatch = useSetAtom(explorerActionAtom)
  const addAreas = useSetAtom(addTrailAreasAtom)
  const operation = useAtomValue(trailAreaOperationAtom)
  const visible = useAtomValue(wordTrailVisibleAtom)
  const setVisible = useSetAtom(wordTrailVisibleAtom)
  if (!repository || !trail) return null
  const { data } = repository
  const groups = trailLanguageGroups(data, trail)
  const located = groups.filter(({ languageId }) => {
    const language = data.languages[languageId]
    return language && hasLanguagePoint(language)
  }).length
  return (
    <aside className="word-map-summary" aria-label="Current word trail on atlas">
      <p className="eyebrow">Current word trail</p>
      <h2>
        {data.lexemes[session.trail.root ?? '']?.f} · {trail.ids.length} forms
      </h2>
      <p>
        {located} of {groups.length} language records have focal points. Lines connect
        representative locations, not historical routes. Relationship direction and evidence are in
        Word histories.
      </p>
      <p>Matched areas use the current atlas source, period and representation settings.</p>
      <div className="word-map-summary-actions">
        <button type="button" aria-pressed={visible} onClick={() => setVisible(!visible)}>
          {visible ? 'Hide word overlay' : 'Show word overlay'}
        </button>
        <button
          type="button"
          onClick={() => dispatch({ type: 'workspace', workspace: 'etymology' })}
        >
          Return to exploration
        </button>
        <button type="button" onClick={() => dispatch({ type: 'show-trail' })}>
          Focus current trail
        </button>
        <button type="button" disabled={operation?.busy} onClick={() => void addAreas()}>
          Add matched language areas
        </button>
        <button type="button" onClick={() => dispatch({ type: 'clear-overlay' })}>
          Clear word overlay
        </button>
      </div>
      {operation?.message && <p role="status">{operation.message}</p>}
      <details>
        <summary>All trail forms and overlapping stages</summary>
        <ul className="word-location-list">
          {groups.map(({ languageId, ids }) => {
            const language = data.languages[languageId]
            return (
              <li key={languageId}>
                <strong>{language?.name}</strong>
                {language && !hasLanguagePoint(language) && (
                  <small> · No focal point; forms remain in the graph</small>
                )}
                {ids.map((id) => (
                  <button
                    type="button"
                    key={id}
                    data-word-id={id}
                    onClick={() => dispatch({ type: 'inspect-trail-word', id })}
                  >
                    Inspect {data.lexemes[id]?.f}
                  </button>
                ))}
              </li>
            )
          })}
        </ul>
      </details>
    </aside>
  )
}
