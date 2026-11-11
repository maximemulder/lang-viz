import type { EtymologyRepository, SourceReference } from '../../domain/etymology.ts'
import { RELATIONSHIP_COLORS } from '../../domain/wordTrailGeography.ts'

interface Props {
  readonly repository: EtymologyRepository
  readonly selected: string
  readonly edgeId: string | null
  readonly onWord: (id: string) => void
  readonly onEdge: (id: string) => void
  readonly onTrace: (id: string) => void
  readonly onExpand: (id: string) => void
}

export const WordDetails = ({
  repository: { data, index },
  selected,
  edgeId,
  onWord,
  onEdge,
  onTrace,
  onExpand,
}: Props) => {
  const sources = (refs: readonly SourceReference[]) =>
    refs.length === 0 ? (
      <p>No source reference recorded.</p>
    ) : (
      <ol className="word-sources">
        {[...new Map(refs.map((ref) => [JSON.stringify(ref), ref])).values()].map((ref) => {
          const source = data.sources[ref.FkSourceId]
          return (
            <li key={JSON.stringify(ref)}>
              <strong>{source?.CitationKey ?? `Source ${ref.FkSourceId}`}</strong>
              <p>{source?.FullCitation ?? 'Source record unavailable'}</p>
              {ref.LocationWithinSource && <p>Location: {ref.LocationWithinSource}</p>}
              {ref.Note && <p>{ref.Note}</p>}
              {source?.Note && <p>{source.Note}</p>}
            </li>
          )
        })}
      </ol>
    )
  const wordLabel = (id: string) =>
    `${data.lexemes[id]?.f} · ${data.languages[data.lexemes[id]?.l ?? '']?.name}`
  const edge = edgeId ? data.edges.find((entry) => entry.id === edgeId) : undefined
  const word = data.lexemes[selected]
  const language = word ? data.languages[word.l] : undefined
  if (!edge && (!word || !language))
    return (
      <aside className="word-details">Select a word or connection to inspect its evidence.</aside>
    )
  const incoming = index.incoming.get(selected) ?? [],
    outgoing = index.outgoing.get(selected) ?? []
  const connections = [
    ...new Map([...incoming, ...outgoing].map((entry) => [entry.id, entry])).values(),
  ]
  return (
    <aside
      className="word-details"
      aria-label="Selected word or relationship details"
      aria-live="polite"
    >
      <p className="eyebrow">{edge ? 'Selected relationship' : 'Selected word'}</p>
      {edge ? (
        <>
          <h2>
            {data.lexemes[edge.p]?.f} → {data.lexemes[edge.c]?.f}
          </h2>
          <p>
            {data.languages[data.lexemes[edge.p]?.l ?? '']?.name} →{' '}
            {data.languages[data.lexemes[edge.c]?.l ?? '']?.name}
          </p>
          <span className="word-badge" style={{ color: RELATIONSHIP_COLORS[edge.t] }}>
            {data.types[edge.t]}
          </span>
          <p>
            {edge.t === 0
              ? 'This connection has no relationship category recorded. It is distinct from “Uncertain origin”.'
              : 'DiACL records this relationship with the label above. Read the cited evidence for its supporting argument.'}
          </p>
          {edge.note && <p>{edge.note}</p>}
          <div className="word-detail-block">
            <h3>Inspect the entries</h3>
            {[...new Set([edge.p, edge.c])].map((id) => (
              <button className="word-link" type="button" key={id} onClick={() => onWord(id)}>
                {wordLabel(id)}
              </button>
            ))}
          </div>
          <div className="word-detail-block">
            <h3>Relationship evidence</h3>
            {sources(edge.refs)}
            <small>Relationship #{edge.id}</small>
          </div>
        </>
      ) : word && language ? (
        <>
          <h2>{word.f}</h2>
          <p>
            {language.name}
            {language.iso && ` · ${language.iso}`}
          </p>
          <span className="word-badge">{language.status}</span>
          {(word.f.startsWith('*') || language.status === 'Reconstructed language') && (
            <span className="word-badge">Reconstructed form</span>
          )}
          {word.stub && <span className="word-badge">Placeholder</span>}
          <div className="word-detail-actions">
            <button type="button" onClick={() => onTrace(selected)}>
              Trace this word ↗
            </button>
            <button type="button" onClick={() => onExpand(selected)}>
              Expand connections ({connections.length})
            </button>
          </div>
          <div className="word-detail-block">
            <h3>Meaning</h3>
            <p>{word.m || 'Not recorded'}</p>
            {word.meaningNote && <p>{word.meaningNote}</p>}
            {word.note && <p>{word.note}</p>}
            {word.ipa && <p>IPA: {word.ipa}</p>}
            {word.script && <p>Script: {word.script}</p>}
            {word.grammar && <p>Grammar: {word.grammar}</p>}
          </div>
          <div className="word-detail-block">
            <h3>Language context</h3>
            <p>{language.path.join(' › ') || 'Unmapped in the supplied tree'}</p>
            {(language.time.From !== undefined || language.time.Until !== undefined) && (
              <p>
                Recorded language period: {language.time.From ?? '?'} to{' '}
                {language.time.Until ?? '?'} (years)
              </p>
            )}
            <small>Language family is distinct from word transmission.</small>
          </div>
          <div className="word-detail-block">
            <h3>Recorded connections</h3>
            {connections.slice(0, 12).map((entry) => (
              <button
                className="word-link"
                type="button"
                key={entry.id}
                onClick={() => onEdge(entry.id)}
              >
                <span style={{ color: RELATIONSHIP_COLORS[entry.t] }}>{data.types[entry.t]}</span>
                <small>
                  {entry.c === selected ? '←' : '→'}{' '}
                  {wordLabel(entry.c === selected ? entry.p : entry.c)}
                </small>
              </button>
            ))}
            {connections.length === 0 && <p>No etymological links recorded for this entry.</p>}
            {connections.length > 12 && (
              <small>
                Showing 12 of {connections.length} relationships. Expand connections to explore
                more.
              </small>
            )}
          </div>
          <div className="word-detail-block">
            <h3>Word-entry evidence</h3>
            <details>
              <summary>{word.refs.length} source references</summary>
              {sources(word.refs)}
            </details>
            <small>
              Lexeme #{selected} · DiACL language #{word.l}
            </small>
          </div>
        </>
      ) : null}
    </aside>
  )
}
