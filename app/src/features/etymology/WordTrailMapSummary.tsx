import { useAtom, useSetAtom } from 'jotai'
import { useState } from 'react'
import { loadAtlasData } from '../../data/atlasRepository'
import { matchAtlasLanguage } from '../../domain/etymology'
import { geographyVariantsForLanguage } from '../../domain/geography'
import {
  geographyDatasetFilterAtom,
  showLanguagesAtom,
  temporalViewAtom,
} from '../../state/atlasState'
import {
  atlasWordTrailAtom,
  wordFocusAtom,
  wordViewAtom,
  workspaceAtom,
} from '../../state/explorerState'
import { trailLocations } from './trailGeography'

export const WordTrailMapSummary = () => {
  const [selection, setSelection] = useAtom(atlasWordTrailAtom)
  const setWorkspace = useSetAtom(workspaceAtom)
  const setFocus = useSetAtom(wordFocusAtom)
  const setView = useSetAtom(wordViewAtom)
  const showLanguages = useSetAtom(showLanguagesAtom)
  const [temporalSelection] = useAtom(temporalViewAtom)
  const [datasetSelection] = useAtom(geographyDatasetFilterAtom)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  if (!selection) return null
  const { data, trail, root } = selection
  const points = trailLocations(data, trail)
  const languageCount = new Set(trail.ids.map((id) => data.lexemes[id]?.l)).size
  const addAreas = async () => {
    setBusy(true)
    try {
      const atlas = await loadAtlasData()
      const matches = [...new Set(trail.ids.map((id) => data.lexemes[id]?.l))].flatMap((id) => {
        const match = id ? matchAtlasLanguage(id, data.languages, atlas.languages) : undefined
        return match &&
          geographyVariantsForLanguage(atlas, match, temporalSelection, datasetSelection).length
          ? [match.id]
          : []
      })
      const unique = [...new Set(matches)]
      showLanguages(unique)
      setMessage(
        `${unique.length} matched language areas added for the current period and source filters. Other languages remain as focal points.`,
      )
    } catch {
      setMessage(
        'Atlas polygons are unavailable. Generate the atlas data to add language areas; DiACL focal points remain visible.',
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <aside className="word-map-summary" aria-label="Word trail on atlas">
      <p className="eyebrow">Word history on the atlas</p>
      <h2>
        {data.lexemes[root]?.f} · {trail.ids.length} forms
      </h2>
      <p>
        {points.length} of {languageCount} language records have focal points. Lines connect
        representative locations; they are not historical routes. Direction and relationship
        evidence are available in Word History.
      </p>
      <div className="word-map-summary-actions">
        <button
          type="button"
          onClick={() => {
            setFocus(root)
            setWorkspace('etymology')
          }}
        >
          Return to word history
        </button>
        <button type="button" disabled={busy} onClick={addAreas}>
          {busy ? 'Loading areas…' : 'Add matched language areas'}
        </button>
        <button type="button" onClick={() => setSelection(null)}>
          Clear word overlay
        </button>
      </div>
      {message && <p role="status">{message}</p>}
      <details>
        <summary>Language locations (including overlapping stages)</summary>
        <div className="word-location-list">
          {points.map(({ languageId, language, ids }) => (
            <button
              type="button"
              key={languageId}
              onClick={() => {
                setFocus(ids[0] ?? root)
                setView('history')
                setWorkspace('etymology')
              }}
            >
              {language?.name} · {ids.map((id) => data.lexemes[id]?.f).join(', ')}
            </button>
          ))}
          {points.length < languageCount && (
            <p>
              {languageCount - points.length} language records have no focal point; their forms
              remain available in the graph.
            </p>
          )}
        </div>
      </details>
    </aside>
  )
}
