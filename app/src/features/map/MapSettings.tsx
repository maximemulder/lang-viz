import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useEffect, useRef, useState } from 'react'
import { useMap } from 'react-map-gl/maplibre'
import {
  geographyDatasetFilterAtom,
  languageOpacityAtom,
  overlapModeAtom,
  overlapStatusAtom,
  temporalViewAtom,
  visibleLanguageIdsAtom,
} from '../../state/atlasState'

export type ProjectionMode = 'globe' | 'mercator'

const EXAMPLE_LANGUAGE_IDS = ['stan1293', 'wels1247', 'scot1245', 'iris1253']

export const MapSettings = ({
  projectionMode,
  onProjectionChange,
}: {
  readonly projectionMode: ProjectionMode
  readonly onProjectionChange: (mode: ProjectionMode) => void
}) => {
  const { current: map } = useMap()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const [mode, setMode] = useAtom(overlapModeAtom)
  const [opacity, setOpacity] = useAtom(languageOpacityAtom)
  const { status, message } = useAtomValue(overlapStatusAtom)
  const setVisibleIds = useSetAtom(visibleLanguageIdsAtom)
  const setPeriod = useSetAtom(temporalViewAtom)
  const setDatasetFilter = useSetAtom(geographyDatasetFilterAtom)

  useEffect(() => {
    if (!open) return

    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) {
        setOpen(false)
      }
    }
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      toggleRef.current?.focus()
    }
    document.addEventListener('pointerdown', dismissOutside)
    document.addEventListener('keydown', dismissOnEscape)
    return () => {
      document.removeEventListener('pointerdown', dismissOutside)
      document.removeEventListener('keydown', dismissOnEscape)
    }
  }, [open])

  const showExample = () => {
    setPeriod('contemporary')
    setDatasetFilter(['asher2007world'])
    setVisibleIds(EXAMPLE_LANGUAGE_IDS)
    setMode('hatching')
    map?.flyTo({ center: [-4.5, 54.2], zoom: 4.4, duration: 900 })
  }

  return (
    <div className="map-settings" ref={containerRef}>
      <button
        className="map-settings__toggle"
        type="button"
        ref={toggleRef}
        aria-label="Map settings"
        title="Map settings"
        aria-expanded={open}
        aria-controls="map-settings-panel"
        onClick={() => setOpen(!open)}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M4 7h9m4 0h3M4 17h3m4 0h9M13 4v6M7 14v6"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <section
        id="map-settings-panel"
        className="map-settings__panel"
        aria-label="Map settings"
        hidden={!open}
      >
        <label>
          <span>Projection</span>
          <select
            value={projectionMode}
            onChange={(event) =>
              onProjectionChange(event.currentTarget.value === 'globe' ? 'globe' : 'mercator')
            }
          >
            <option value="globe">Globe</option>
            <option value="mercator">Mercator</option>
          </select>
        </label>
        <label>
          <span>Overlap style</span>
          <select
            value={mode}
            onChange={(event) =>
              setMode(event.currentTarget.value === 'blending' ? 'blending' : 'hatching')
            }
          >
            <option value="hatching">Alternating stripes</option>
            <option value="blending">Color blending</option>
          </select>
        </label>
        <label className="map-opacity-control" htmlFor="language-opacity">
          <span>
            Color intensity
            <output htmlFor="language-opacity">{Math.round(opacity * 100)}%</output>
          </span>
          <input
            id="language-opacity"
            type="range"
            min="40"
            max="100"
            value={Math.round(opacity * 100)}
            onChange={(event) => setOpacity(Number(event.currentTarget.value) / 100)}
          />
        </label>
        <div className="map-settings__example">
          <button type="button" onClick={showExample}>
            Try Britain example
          </button>
          <p role="status" data-overlap-status={status}>
            {mode === 'blending'
              ? 'Overlapping colors are blended'
              : status === 'idle'
                ? 'Select two or more languages, or try the example'
                : message || 'Preparing overlap stripes…'}
          </p>
        </div>
      </section>
    </div>
  )
}
