import { useAtom } from 'jotai'
import { useEffect, useId, useRef, useState } from 'react'
import { languageOpacityAtom, overlapModeAtom, stripeThicknessAtom } from '../../state/atlasState'

import { BIOMES } from './biomes'
import { BACKGROUND_OPTIONS, type BackgroundMode } from './geographicBasemap'
import { globeLandPath, mercatorLandPath } from './projectionIcons'
import type { AreaInteraction } from './WorldMap.tsx'

export type ProjectionMode = 'globe' | 'mercator'

const SettingIcon = ({ kind }: { readonly kind: ProjectionMode | 'hatching' | 'blending' }) => {
  const id = useId()
  return (
    <svg className="map-settings__icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {kind === 'globe' ? (
        <>
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.25" />
          <path d={globeLandPath} fill="currentColor" />
        </>
      ) : kind === 'mercator' ? (
        <>
          <rect
            x="1.5"
            y="4"
            width="21"
            height="16"
            rx="1.5"
            stroke="currentColor"
            strokeWidth="1.25"
          />
          <path d={mercatorLandPath} fill="currentColor" />
        </>
      ) : (
        <>
          <defs>
            <pattern
              id={id}
              width="4"
              height="4"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(35)"
            >
              <path fill="#c77b60" d="M0 0h2v4H0z" />
              <path fill="#7e9e92" d="M2 0h2v4H2z" />
            </pattern>
          </defs>
          <rect x="2" y="4" width="13" height="14" rx="2" fill="#c77b60" />
          <rect x="9" y="6" width="13" height="14" rx="2" fill="#7e9e92" />
          <path
            d="M11 6h4v10a2 2 0 0 1-2 2H9V8a2 2 0 0 1 2-2Z"
            fill={kind === 'hatching' ? `url(#${id})` : '#a28d79'}
          />
        </>
      )}
    </svg>
  )
}

export const MapSettings = ({
  projectionMode,
  onProjectionChange,
  backgroundMode,
  onBackgroundChange,
  areaInteraction,
}: {
  readonly backgroundMode: BackgroundMode
  readonly onBackgroundChange: (mode: BackgroundMode) => void
  readonly projectionMode: ProjectionMode
  readonly onProjectionChange: (mode: ProjectionMode) => void
  readonly areaInteraction: AreaInteraction
}) => {
  const tooltipId = useId()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const [mode, setMode] = useAtom(overlapModeAtom)
  const [opacity, setOpacity] = useAtom(languageOpacityAtom)
  const [stripeThickness, setStripeThickness] = useAtom(stripeThicknessAtom)
  const thicknessPercent = Math.round(stripeThickness * 100)

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

  return (
    <div className="map-settings" ref={containerRef}>
      <div className="map-settings__toolbar">
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
        {areaInteraction && (
          <div className="map-area-controls">
            <button
              className="map-settings__toggle map-area-controls__borders"
              type="button"
              aria-label="Administrative borders"
              title={
                areaInteraction.enabled
                  ? 'Borders are always shown in Areas'
                  : areaInteraction.borders
                    ? 'Hide borders'
                    : 'Show borders'
              }
              aria-pressed={areaInteraction.borders}
              disabled={areaInteraction.enabled}
              onClick={() => areaInteraction.onBordersChange(!areaInteraction.borders)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M3 5.5 9 3l6 2 6-2v15.5L15 21l-6-2-6 2V5.5Z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
                <path
                  d="m9 3 1.5 5-2 4 2 3L9 19m6-14-1 4 2 3v6"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <fieldset className="map-area-controls__inspect">
              <legend className="visually-hidden">Inspect on map</legend>
              <button
                className="map-area-controls__inspect-button"
                type="button"
                title="Inspect languages on map"
                aria-label="Inspect languages on map"
                aria-pressed={!areaInteraction.enabled}
                onClick={() => areaInteraction.onHoverModeChange('language')}
              >
                Languages
              </button>
              <button
                className="map-area-controls__inspect-button"
                type="button"
                title="Inspect administrative areas on map"
                aria-label="Inspect administrative areas on map"
                aria-pressed={areaInteraction.enabled}
                onClick={() => areaInteraction.onHoverModeChange('area')}
              >
                Areas
              </button>
            </fieldset>
          </div>
        )}
      </div>
      <section
        id="map-settings-panel"
        className="map-settings__panel"
        aria-label="Map settings"
        hidden={!open}
      >
        <fieldset className="map-settings__group">
          <legend>Background</legend>
          <div className="map-settings__choices">
            {BACKGROUND_OPTIONS.map(({ value, label, preview }) => (
              <label className="map-settings__choice" key={value}>
                <input
                  type="radio"
                  name="map-background"
                  value={value}
                  aria-label={label}
                  aria-describedby={`${tooltipId}-${value}`}
                  checked={backgroundMode === value}
                  onChange={() => onBackgroundChange(value)}
                />
                <span className="map-settings__tile">
                  <img
                    className="map-settings__icon map-settings__thumbnail"
                    src={preview}
                    alt=""
                    draggable={false}
                  />
                </span>
                <span className="map-settings__tooltip" id={`${tooltipId}-${value}`} role="tooltip">
                  {label}
                </span>
              </label>
            ))}
          </div>
          {backgroundMode === 'biomes' && (
            <details className="map-settings__biome-legend">
              <summary>Biome legend</summary>
              <ul>
                {BIOMES.map(({ id, label, color }) => (
                  <li key={id}>
                    <span style={{ backgroundColor: color }} aria-hidden="true" />
                    {label}
                  </li>
                ))}
              </ul>
              <p>RESOLVE 2017 ecological reference</p>
            </details>
          )}
        </fieldset>
        <fieldset className="map-settings__group">
          <legend>Projection</legend>
          <div className="map-settings__choices">
            {(['globe', 'mercator'] as const).map((projection) => (
              <label className="map-settings__choice" key={projection}>
                <input
                  type="radio"
                  name="map-projection"
                  value={projection}
                  aria-label={projection === 'globe' ? 'Globe' : 'Mercator'}
                  aria-describedby={`${tooltipId}-${projection}`}
                  checked={projectionMode === projection}
                  onChange={() => onProjectionChange(projection)}
                />
                <span className="map-settings__tile">
                  <SettingIcon kind={projection} />
                </span>
                <span
                  className="map-settings__tooltip"
                  id={`${tooltipId}-${projection}`}
                  role="tooltip"
                >
                  {projection === 'globe' ? 'Globe' : 'Mercator'}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="map-settings__group">
          <legend>Overlap style</legend>
          <div className="map-settings__choices">
            {(['hatching', 'blending'] as const).map((style) => (
              <label className="map-settings__choice" key={style}>
                <input
                  type="radio"
                  name="map-overlap"
                  value={style}
                  aria-label={style === 'hatching' ? 'Alternating stripes' : 'Color blending'}
                  aria-describedby={`${tooltipId}-${style}`}
                  checked={mode === style}
                  onChange={() => setMode(style)}
                />
                <span className="map-settings__tile">
                  <SettingIcon kind={style} />
                </span>
                <span className="map-settings__tooltip" id={`${tooltipId}-${style}`} role="tooltip">
                  {style === 'hatching' ? 'Alternating stripes' : 'Color blending'}
                </span>
              </label>
            ))}
          </div>
          {mode === 'hatching' && (
            <div className="map-range-control map-stripe-control">
              <label htmlFor="stripe-thickness">
                Stripe thickness
                <output htmlFor="stripe-thickness">{thicknessPercent}%</output>
              </label>
              <input
                id="stripe-thickness"
                type="range"
                min="25"
                max="200"
                step="5"
                value={thicknessPercent}
                aria-valuetext={`${thicknessPercent}%${thicknessPercent === 100 ? ', default' : ''}`}
                onChange={(event) => setStripeThickness(Number(event.currentTarget.value) / 100)}
              />
            </div>
          )}
        </fieldset>
        <label className="map-range-control map-opacity-control" htmlFor="language-opacity">
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
      </section>
    </div>
  )
}
