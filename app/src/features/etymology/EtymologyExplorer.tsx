import { useAtomValue, useSetAtom } from 'jotai'
import { useEffect, useMemo, useState } from 'react'
import { loadEtymology } from '../../data/etymologyRepository.ts'
import type { EtymologyRepository } from '../../domain/etymology.ts'
import { RELATIONSHIP_COLORS } from '../../domain/wordTrailGeography.ts'
import { etymologyRepositoryAtom } from '../../state/etymologyData.ts'
import {
  explorerActionAtom,
  explorerRouteIssuesAtom,
  explorerSessionAtom,
  resolvedExplorerAtom,
  wordTrailAtom,
} from '../../state/explorerState.ts'
import { FamilyComparison } from './FamilyComparison.tsx'
import { WordDetails } from './WordDetails.tsx'
import { WordDiscovery } from './WordDiscovery.tsx'
import { WordHistoryGraph } from './WordHistoryGraph.tsx'
import './etymology.css'

export default function EtymologyExplorer() {
  const repository = useAtomValue(etymologyRepositoryAtom)
  const publish = useSetAtom(etymologyRepositoryAtom)
  const [attempt, setAttempt] = useState(0)
  return repository ? (
    <Explorer repository={repository} />
  ) : (
    <RepositoryRequest
      key={attempt}
      onReady={publish}
      onRetry={() => setAttempt((value) => value + 1)}
    />
  )
}

const RepositoryRequest = ({
  onReady,
  onRetry,
}: {
  readonly onReady: (repository: EtymologyRepository) => void
  readonly onRetry: () => void
}) => {
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    // Start requests in the committed lifecycle, attaching rejection handling
    // immediately even when React abandons or replays a workspace render.
    loadEtymology()
      .then((repository) => {
        if (active) onReady(repository)
      })
      .catch((reason: unknown) => {
        if (active)
          setError(reason instanceof Error ? reason.message : 'Could not load word histories.')
      })
    return () => {
      active = false
    }
  }, [onReady])
  return (
    <section className="word-loading" aria-live="polite" aria-busy={!error}>
      <p className="eyebrow">Word Trails · DiACL</p>
      <h2>{error ? 'Word histories unavailable' : 'Loading word histories…'}</h2>
      <p>
        {error ||
          'The lexical dataset loads on your first visit. Preparing recorded entries and relationships…'}
      </p>
      {error && (
        <button type="button" onClick={onRetry}>
          Retry word histories
        </button>
      )}
    </section>
  )
}

const Explorer = ({ repository }: { readonly repository: EtymologyRepository }) => {
  const { data } = repository
  const session = useAtomValue(explorerSessionAtom)
  const resolved = useAtomValue(resolvedExplorerAtom)
  const derivedTrail = useAtomValue(wordTrailAtom)
  const routeIssues = useAtomValue(explorerRouteIssuesAtom)
  const dispatch = useSetAtom(explorerActionAtom)
  const root = session.trail.root ?? ''
  const { depth, branches, placeholders } = session.trail
  const { view } = session
  const conceptId = resolved?.conceptId ?? ''
  const listId = resolved?.collectionId ?? ''
  const edgeId = session.selection?.kind === 'edge' ? session.selection.id : null
  const selected = session.selection?.kind === 'word' ? session.selection.id : root
  const trail = derivedTrail ?? { ids: [], edges: [], hiddenPlaceholders: 0, omitted: 0 }
  const [about, setAbout] = useState(false)
  const concepts = useMemo(
    () =>
      Object.values(data.concepts)
        .filter((concept) => concept.groups.some((group) => group.list === listId))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [data, listId],
  )
  const selectWord = (id: string) => dispatch({ type: 'select', selection: { kind: 'word', id } })
  const setEdgeId = (id: string) => dispatch({ type: 'select', selection: { kind: 'edge', id } })
  const trace = (id: string) => {
    if (data.lexemes[id]) dispatch({ type: 'trace', id })
  }
  const setView = (view: 'history' | 'family') => dispatch({ type: 'view', view })
  const setDepth = (depth: number) => dispatch({ type: 'trail-options', depth })
  const setBranches = (branches: boolean) => dispatch({ type: 'trail-options', branches })
  const setPlaceholders = (placeholders: boolean) =>
    dispatch({ type: 'trail-options', placeholders })
  if (!resolved) return null
  const rootWord = data.lexemes[root]
  return (
    <section className="etymology-workspace" aria-label="Word histories">
      <div className="word-explorer-heading">
        <div>
          <p className="eyebrow">Word Trails · DiACL</p>
          <h2>
            {view === 'family' && data.concepts[conceptId]
              ? `How do languages express “${data.concepts[conceptId]?.name}”?`
              : rootWord
                ? `Where does “${rootWord.f}” come from?`
                : 'Explore recorded word histories'}
          </h2>
          <p>
            {rootWord
              ? `${data.languages[rootWord.l]?.name} · ${rootWord.m || 'Meaning not recorded'}`
              : 'Search for a word or choose an example to begin.'}
          </p>
        </div>
        <button type="button" onClick={() => setAbout(!about)} aria-expanded={about}>
          About the data
        </button>
      </div>
      {about && (
        <div className="word-about">
          <p>
            {data.provenance.attribution}{' '}
            <a href="https://diacl.uni-frankfurt.de/" target="_blank" rel="noreferrer">
              Diachronic Atlas of Comparative Linguistics Online
            </a>
            . Snapshot: {data.provenance.snapshot ?? 'Unpinned local build'}.{' '}
            {Object.keys(data.lexemes).length.toLocaleString()} words ·{' '}
            {data.edges.length.toLocaleString()} relationships ·{' '}
            {Object.keys(data.languages).length} language records.
          </p>
          <p>
            Arrows connect recorded word forms; depth counts links, not years. Reconstructed forms
            and placeholders are marked. Source references for words and relationships remain
            separate. A shared concept does not establish cognacy. All processing happens in your
            browser.
          </p>
        </div>
      )}
      <WordDiscovery repository={repository} />
      {[...routeIssues, ...resolved.issues].length > 0 && (
        <div className="word-notice" role="alert">
          {[...routeIssues, ...resolved.issues].map((issue) => (
            <p key={issue}>{issue}</p>
          ))}
        </div>
      )}
      <div className="word-toolbar">
        <nav className="workspace-nav" aria-label="Word visualization">
          <button
            type="button"
            aria-pressed={view === 'history'}
            onClick={() => setView('history')}
          >
            Word history
          </button>
          <button type="button" aria-pressed={view === 'family'} onClick={() => setView('family')}>
            Family comparison
          </button>
        </nav>
        <div className="word-concept-controls">
          <label>
            Collection{' '}
            <select
              value={listId}
              onChange={(event) => {
                dispatch({ type: 'comparison', collectionId: event.target.value || null })
              }}
            >
              {!data.lists.some((list) => list.id === listId) && (
                <option value={listId}>
                  {listId ? `Unknown collection: ${listId}` : 'Choose a collection'}
                </option>
              )}
              {data.lists.map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Concept{' '}
            <select
              value={conceptId}
              onChange={(event) => {
                dispatch({ type: 'comparison', conceptId: event.target.value || null })
              }}
            >
              {!concepts.some((concept) => concept.id === conceptId) && (
                <option value={conceptId}>
                  {conceptId
                    ? (data.concepts[conceptId]?.name ?? `Unknown concept: ${conceptId}`)
                    : 'Choose a concept'}
                </option>
              )}
              {concepts.map((concept) => (
                <option key={concept.id} value={concept.id}>
                  {concept.name} · {concept.groups.find((group) => group.list === listId)?.category}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <div className="word-workspace-grid">
        <section className="word-visual-panel" aria-label="Word visualization">
          <div className="word-controls">
            <label>
              <input
                type="checkbox"
                checked={placeholders}
                onChange={(event) => setPlaceholders(event.target.checked)}
              />{' '}
              Placeholders
            </label>
            {view === 'history' && (
              <>
                <label>
                  Earlier steps{' '}
                  <select value={depth} onChange={(event) => setDepth(Number(event.target.value))}>
                    {[2, 3, 4, 6].map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={branches}
                    onChange={(event) => setBranches(event.target.checked)}
                  />{' '}
                  Nearby branches
                </label>
                <span>
                  {trail.ids.length} forms · {trail.edges.length} links
                </span>
              </>
            )}
          </div>
          {view === 'history' && rootWord ? (
            <>
              <WordHistoryGraph
                key={root}
                data={data}
                trail={trail}
                root={root}
                selected={selected}
                edgeId={edgeId}
                onWord={selectWord}
                onEdge={setEdgeId}
              />
              <div className="word-legend">
                {Object.entries(data.types).map(([type, label]) => (
                  <span key={type}>
                    <i style={{ background: RELATIONSHIP_COLORS[Number(type)] }} />
                    {label}
                  </span>
                ))}
              </div>
              <p className="word-note">
                Spacing ≠ elapsed time. Drag empty space to pan.
                {trail.hiddenPlaceholders > 0 &&
                  ` ${trail.hiddenPlaceholders} placeholders hidden; paths may stop here.`}
                {trail.omitted > 0 &&
                  ' More connections available: select a word and expand (60-form limit).'}
              </p>
            </>
          ) : view === 'history' ? (
            <p className="word-note">Choose a recorded word to display its history.</p>
          ) : (
            <FamilyComparison
              repository={repository}
              conceptId={conceptId}
              trail={trail}
              placeholders={placeholders}
              selected={selected}
              onWord={selectWord}
              family={session.comparison.family}
              missing={session.comparison.includeMissing}
              onFamily={(family) => dispatch({ type: 'comparison-filter', family })}
              onMissing={(includeMissing) =>
                dispatch({ type: 'comparison-filter', includeMissing })
              }
            />
          )}
        </section>
        <WordDetails
          repository={repository}
          selected={selected}
          edgeId={edgeId}
          onWord={selectWord}
          onEdge={setEdgeId}
          onTrace={trace}
          onExpand={(id) => dispatch({ type: 'expand', id })}
        />
      </div>
    </section>
  )
}
