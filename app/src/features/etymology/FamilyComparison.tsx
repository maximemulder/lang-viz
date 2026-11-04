import { useState } from 'react'
import type { EtymologyRepository, WordTrail } from '../../domain/etymology'
import { RELATIONSHIP_COLORS } from '../../domain/etymology'

interface Props {
  readonly repository: EtymologyRepository
  readonly conceptId: string
  readonly trail: WordTrail
  readonly placeholders: boolean
  readonly selected: string
  readonly onWord: (id: string) => void
}

export const FamilyComparison = ({
  repository: { data, index },
  conceptId,
  trail,
  placeholders,
  selected,
  onWord,
}: Props) => {
  const [family, setFamily] = useState('all')
  const [missing, setMissing] = useState(false)
  const concept = data.concepts[conceptId]
  const groups = new Map<string, string[]>()
  for (const id of concept?.lexemes ?? trail.ids) {
    const word = data.lexemes[id]
    if (!word || (!placeholders && word.stub)) continue
    const language = data.languages[word.l]
    if (!language || (family !== 'all' && language.family !== family)) continue
    groups.set(word.l, [...(groups.get(word.l) ?? []), id])
  }
  if (missing)
    for (const [id, language] of Object.entries(data.languages)) {
      if ((family === 'all' || language.family === family) && !groups.has(id)) groups.set(id, [])
    }
  const branchLabel = (id: string) => {
    const language = data.languages[id]
    return language
      ? [language.family, language.path.length > 2 ? language.path[1] : null]
          .filter(Boolean)
          .join(' / ')
      : ''
  }
  const rows = [...groups].sort(
    ([a], [b]) =>
      branchLabel(a).localeCompare(branchLabel(b)) ||
      (data.languages[a]?.name ?? '').localeCompare(data.languages[b]?.name ?? ''),
  )
  return (
    <>
      <div className="word-controls">
        <label>
          Family{' '}
          <select value={family} onChange={(event) => setFamily(event.target.value)}>
            <option value="all">All represented families</option>
            {[...new Set(Object.values(data.languages).map((language) => language.family))]
              .sort()
              .map((name) => (
                <option key={name}>{name}</option>
              ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={missing}
            onChange={(event) => setMissing(event.target.checked)}
          />{' '}
          Include languages with no entry
        </label>
      </div>
      <p className="word-note">
        {concept
          ? `Expressions for “${concept.name}”`
          : 'This entry has no concept assignment; showing its displayed history.'}{' '}
        · {rows.reduce((count, [, forms]) => count + forms.length, 0)} forms · {rows.length}{' '}
        languages. A shared concept does not establish cognacy.
      </p>
      <div className="word-table-scroll">
        <table className="word-table">
          <thead>
            <tr>
              <th>Language / family</th>
              <th>Recorded word forms</th>
              <th>Incoming relationships</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([languageId, forms]) => {
              const language = data.languages[languageId]
              const types = new Map<number, number>()
              for (const id of forms)
                for (const edge of index.incoming.get(id) ?? [])
                  types.set(edge.t, (types.get(edge.t) ?? 0) + 1)
              return (
                <tr key={languageId}>
                  <td>
                    <strong>{language?.name}</strong>
                    <small>{branchLabel(languageId)}</small>
                  </td>
                  <td>
                    {forms.length ? (
                      forms.map((id) => (
                        <button
                          type="button"
                          key={id}
                          aria-pressed={selected === id}
                          onClick={() => onWord(id)}
                        >
                          {data.lexemes[id]?.f}
                        </button>
                      ))
                    ) : (
                      <small>No concept entry recorded</small>
                    )}
                  </td>
                  <td>
                    {[...types].map(([type, count]) => (
                      <small key={type} style={{ color: RELATIONSHIP_COLORS[type] }}>
                        {data.types[type]} ({count})
                      </small>
                    ))}
                    {types.size === 0 && <small>No incoming relationship recorded</small>}
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={3}>
                  No word entries in this scope. Choose another family or concept.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="word-note">
        Counts describe recorded links for these forms, not language-level borrowing rates. Missing
        entries do not establish historical absence.
      </p>
    </>
  )
}
