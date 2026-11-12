import { useAtomValue, useSetAtom } from 'jotai'
import { useDeferredValue, useEffect, useMemo, useRef } from 'react'
import { type EtymologyRepository, searchLexemes } from '../../domain/etymology.ts'
import { explorerActionAtom, explorerSessionAtom } from '../../state/explorerState.ts'
import { resolvedExplorerAtom } from './state.ts'

export const WordDiscovery = ({ repository }: { readonly repository: EtymologyRepository }) => {
  const { data } = repository
  const session = useAtomValue(explorerSessionAtom)
  const resolved = useAtomValue(resolvedExplorerAtom)
  const dispatch = useSetAtom(explorerActionAtom)
  const query = session.search.query
  const placeholders = session.trail.placeholders
  const languageScope = resolved?.languageId ?? ''
  const searchInput = useRef<HTMLInputElement>(null)
  const resultsPanel = useRef<HTMLElement>(null)
  const deferredQuery = useDeferredValue(query)
  const results = useMemo(
    () => searchLexemes(repository, deferredQuery, placeholders, languageScope),
    [repository, deferredQuery, placeholders, languageScope],
  )
  const languages = useMemo(
    () => Object.entries(data.languages).sort(([, a], [, b]) => a.name.localeCompare(b.name)),
    [data],
  )
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.key === '/' &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
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
  const trace = (id: string) => {
    if (data.lexemes[id]) dispatch({ type: 'trace', id })
  }
  const setQuery = (query: string) => dispatch({ type: 'search', query })
  const setLanguageScope = (languageId: string) =>
    dispatch({ type: 'search', languageId: languageId || null })
  const target = session.search.atlasTarget
  const notice = !target
    ? ''
    : resolved?.languageMatch === 'exact'
      ? `Browsing entries for ${target.name}. Choose a form to trace.`
      : resolved?.languageMatch === 'ambiguous'
        ? `Several lexical records match ${target.name}. Choose a language record or search below.`
        : `No exact lexical match for ${target.name}. Search the full dataset below.`
  return (
    <>
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
                resultsPanel.current?.querySelector<HTMLButtonElement>('button')?.focus()
              }
              if (event.key === 'Enter') {
                const first = searchLexemes(repository, query, placeholders, languageScope)[0]
                if (first) trace(first.id)
              }
            }}
          />
        </label>
        <label className="word-language-scope">
          <span>Language</span>
          <select value={languageScope} onChange={(event) => setLanguageScope(event.target.value)}>
            <option value="">All lexical languages</option>
            {languages.map(([id, language]) => (
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
          ]
            .filter(([id]) => id && data.lexemes[id])
            .map(([id, name]) => (
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
          ref={resultsPanel}
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
    </>
  )
}
