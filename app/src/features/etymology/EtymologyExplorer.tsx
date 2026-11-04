import { useAtom, useSetAtom } from 'jotai'
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { loadEtymology } from '../../data/etymologyRepository'
import {
  buildWordTrail,
  type EtymologyRepository,
  matchAtlasLanguage,
  RELATIONSHIP_COLORS,
  searchLexemes,
} from '../../domain/etymology'
import {
  atlasWordTrailAtom,
  lexicalLanguageRequestAtom,
  wordFocusAtom,
  wordViewAtom,
  workspaceAtom,
} from '../../state/explorerState'
import { FamilyComparison } from './FamilyComparison'
import { WordDetails } from './WordDetails'
import { WordHistoryGraph } from './WordHistoryGraph'
import './etymology.css'

export default function EtymologyExplorer() {
  const [repository, setRepository] = useState<EtymologyRepository | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(() => loadEtymology())
  useEffect(() => {
    let active = true
    loading
      .then((result) => {
        if (active) setRepository(result)
      })
      .catch((reason: unknown) => {
        if (active)
          setError(reason instanceof Error ? reason.message : 'Could not load Word Trails.')
      })
    return () => {
      active = false
    }
  }, [loading])
  if (!repository)
    return (
      <section className="word-loading" aria-live="polite" aria-busy={!error}>
        <p className="eyebrow">Word Trails · DiACL</p>
        <h2>{error ? 'Word histories unavailable' : 'Loading word histories…'}</h2>
        <p>
          {error ||
            'Preparing 74,635 entries and their recorded relationships. The lexical dataset loads on your first visit.'}
        </p>
        {error && (
          <>
            <p>Run npm run data:etymology in app/ if the data has not been generated.</p>
            <button
              type="button"
              onClick={() => {
                setError('')
                setLoading(loadEtymology())
              }}
            >
              Retry
            </button>
          </>
        )}
      </section>
    )
  return <Explorer repository={repository} />
}

const Explorer = ({ repository }: { readonly repository: EtymologyRepository }) => {
  const { data, index } = repository
  const [focus, setFocus] = useAtom(wordFocusAtom)
  const root = data.lexemes[focus] ? focus : '69562'
  const [view, setView] = useAtom(wordViewAtom)
  const [request, setRequest] = useAtom(lexicalLanguageRequestAtom)
  const setWorkspace = useSetAtom(workspaceAtom)
  const setAtlasTrail = useSetAtom(atlasWordTrailAtom)
  const [selected, setSelected] = useState(root)
  const [edgeId, setEdgeId] = useState<string | null>(null)
  const [depth, setDepth] = useState(4)
  const [branches, setBranches] = useState(true)
  const [placeholders, setPlaceholders] = useState(false)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [query, setQuery] = useState('')
  const [languageScope, setLanguageScope] = useState('')
  const [notice, setNotice] = useState('')
  const [conceptId, setConceptId] = useState(index.wordConcepts.get(root)?.[0] ?? '')
  const [listId, setListId] = useState(data.concepts[conceptId]?.groups[0]?.list ?? '3')
  const [about, setAbout] = useState(false)
  const searchInput = useRef<HTMLInputElement>(null)
  const deferredQuery = useDeferredValue(query)
  const results = useMemo(
    () => searchLexemes(repository, deferredQuery, placeholders, languageScope),
    [repository, deferredQuery, placeholders, languageScope],
  )
  const trail = useMemo(
    () => buildWordTrail(repository, root, { depth, branches, placeholders, expanded }),
    [repository, root, depth, branches, placeholders, expanded],
  )
  const concepts = Object.values(data.concepts)
    .filter((concept) => concept.groups.some((group) => group.list === listId))
    .sort((a, b) => a.name.localeCompare(b.name))
  useEffect(() => {
    if (!request) return
    const matches = Object.keys(data.languages).filter((id) =>
      matchAtlasLanguage(id, data.languages, [request]),
    )
    // An ISO-only reverse join also needs uniqueness in the full atlas. The
    // finder supplies a Glottocode, so require it for this direction.
    const exact = matches.filter((id) => data.languages[id]?.glottocode === request.id)
    setLanguageScope(exact.length === 1 ? (exact[0] ?? '') : '')
    setQuery('')
    setNotice(
      exact.length === 1
        ? `Browsing DiACL entries for ${request.name}. Choose a form to trace.`
        : exact.length > 1
          ? `Several lexical language records share the Glottocode for ${request.name}. Choose a language record or search below.`
          : `No exact Glottocode match for ${request.name} in this lexical snapshot. Search the full dataset below.`,
    )
    setRequest(null)
    searchInput.current?.focus()
  }, [request, data, setRequest])
  useEffect(() => {
    const params = new URLSearchParams({ word: root, view })
    window.history.replaceState(null, '', `#${params}`)
  }, [root, view])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.key === '/' &&
        !(
          event.target instanceof HTMLElement &&
          event.target.closest('input, select, textarea, [contenteditable="true"]')
        )
      ) {
        event.preventDefault()
        searchInput.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  const selectWord = (id: string) => {
    setSelected(id)
    setEdgeId(null)
  }
  const trace = (id: string) => {
    if (!data.lexemes[id]) return
    setFocus(id)
    selectWord(id)
    setExpanded(new Set())
    setQuery('')
    setLanguageScope('')
    setNotice('')
    setView('history')
    const nextConcept = index.wordConcepts.get(id)?.[0] ?? ''
    setConceptId(nextConcept)
    const nextList = data.concepts[nextConcept]?.groups[0]?.list
    if (nextList) setListId(nextList)
  }
  const showMap = () => {
    setAtlasTrail({ data, trail, root })
    setWorkspace('geography')
  }
  const rootWord = data.lexemes[root]
  return (
    <section className="etymology-workspace" aria-label="Word histories">
      <div className="word-explorer-heading">
        <div>
          <p className="eyebrow">Word Trails · DiACL</p>
          <h2>
            {view === 'family' && data.concepts[conceptId]
              ? `How do languages express “${data.concepts[conceptId]?.name}”?`
              : `Where does “${rootWord?.f}” come from?`}
          </h2>
          <p>
            {data.languages[rootWord?.l ?? '']?.name} · {rootWord?.m || 'Meaning not recorded'}
          </p>
        </div>
        <button type="button" onClick={() => setAbout(!about)} aria-expanded={about}>
          About the data
        </button>
      </div>
      {about && (
        <div className="word-about">
          <p>
            Carling, Gerd (ed.),{' '}
            <a href="https://diacl.uni-frankfurt.de/" target="_blank" rel="noreferrer">
              Diachronic Atlas of Comparative Linguistics Online
            </a>
            . Lexical export: 24 October 2026; tree: 23 October 2026.{' '}
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
      <div className="word-discovery">
        <label className="search-field">
          <span className="visually-hidden">Search word forms, meanings, or languages</span>
          <input
            ref={searchInput}
            type="search"
            placeholder="Search a word, meaning, or language… (/)"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setQuery('')
                setLanguageScope('')
              }
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                document.querySelector<HTMLButtonElement>('.word-search-results button')?.focus()
              }
              if (event.key === 'Enter' && results[0]) trace(results[0].id)
            }}
          />
        </label>
        <label className="word-language-scope">
          <span>Language</span>
          <select value={languageScope} onChange={(event) => setLanguageScope(event.target.value)}>
            <option value="">All lexical languages</option>
            {Object.entries(data.languages)
              .sort(([, a], [, b]) => a.name.localeCompare(b.name))
              .map(([id, language]) => (
                <option key={id} value={id}>
                  {language.name}
                </option>
              ))}
          </select>
        </label>
        <div className="word-examples">
          <span>Try</span>
          {[
            ['69562', 'wine'],
            ['38213', 'water'],
            ['38208', 'tooth'],
          ].map(([id, name]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                if (id) trace(id)
              }}
            >
              {name} ↗
            </button>
          ))}
        </div>
      </div>
      {notice && (
        <p className="word-notice" role="status">
          {notice}
        </p>
      )}
      {(query.trim() || languageScope) && (
        <section
          className="word-search-results"
          aria-label="Word search results"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setQuery('')
              setLanguageScope('')
              searchInput.current?.focus()
            }
            const buttons = [...event.currentTarget.querySelectorAll('button')]
            const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              buttons[i + 1]?.focus()
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              if (i <= 0) searchInput.current?.focus()
              else buttons[i - 1]?.focus()
            }
          }}
        >
          <p aria-live="polite">
            {results.length.toLocaleString()} matching entries
            {results.length > 30 ? ' · showing the first 30' : ''}
            {results.length === 0 ? ' · Try another form, meaning, or language.' : ''}
          </p>
          {results.slice(0, 30).map(({ id }) => (
            <button type="button" key={id} onClick={() => trace(id)}>
              <strong>{data.lexemes[id]?.f}</strong>
              <small>
                {data.languages[data.lexemes[id]?.l ?? '']?.name} ·{' '}
                {data.lexemes[id]?.m || 'Meaning not recorded'} · #{id}
              </small>
            </button>
          ))}
        </section>
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
          <button type="button" onClick={showMap}>
            Show on atlas ↗
          </button>
        </nav>
        <div className="word-concept-controls">
          <label>
            Collection{' '}
            <select
              value={listId}
              onChange={(event) => {
                const id = event.target.value
                setListId(id)
                setConceptId(
                  Object.values(data.concepts).find((concept) =>
                    concept.groups.some((group) => group.list === id),
                  )?.id ?? '',
                )
                setView('family')
              }}
            >
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
                setConceptId(event.target.value)
                setView('family')
              }}
            >
              {!conceptId && <option value="">No concept assigned</option>}
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
          {view === 'history' ? (
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
          ) : (
            <FamilyComparison
              repository={repository}
              conceptId={conceptId}
              trail={trail}
              placeholders={placeholders}
              selected={selected}
              onWord={selectWord}
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
          onExpand={(id) => {
            setExpanded((current) => new Set([...current, id]))
            setView('history')
          }}
          onMap={showMap}
        />
      </div>
    </section>
  )
}
