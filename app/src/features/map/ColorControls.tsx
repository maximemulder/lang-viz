import { useAtom, useAtomValue } from 'jotai'
import { useId, useState } from 'react'
import { DEFAULT_COLOR_CONFIGURATION } from '../../domain/colors'
import {
  colorConfigurationAtom,
  languageColorsAtom,
  languageHierarchyAtom,
  visibleLanguageIdsAtom,
} from '../../state/atlasState'

/** Temporary testing controls; palette logic stays behind the configuration atom. */
export const ColorControls = () => {
  const [config, setConfig] = useAtom(colorConfigurationAtom)
  const hierarchy = useAtomValue(languageHierarchyAtom)
  const selectedIds = useAtomValue(visibleLanguageIdsAtom)
  const colors = useAtomValue(languageColorsAtom)
  const listId = useId()
  const [target, setTarget] = useState<string | null>(null)
  const [color, setColor] = useState('#287cb8')
  const [roots, setRoots] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const id = (target ?? selectedIds[0] ?? '').trim()
  const language = hierarchy.languageById.get(id)

  const applyColor = (kind: 'anchors' | 'overrides', remove = false) => {
    if (!language) return
    const entries = { ...config[kind] }
    if (remove) delete entries[id]
    else entries[id] = color
    try {
      setConfig({ ...config, [kind]: entries })
      setError(null)
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    }
  }

  const applyRoots = () => {
    const rootIds = (roots ?? config.rootIds.join(', ')).split(/[\s,]+/).filter(Boolean)
    const unknown = rootIds.filter((id) => !hierarchy.languageById.has(id))
    if (unknown.length) {
      setError(`Unknown languoid IDs: ${unknown.join(', ')}`)
      return
    }
    setConfig({ ...config, rootIds })
    setRoots(null)
    setError(null)
  }

  return (
    <fieldset className="map-settings__group color-controls">
      <legend>Language colors</legend>
      <label>
        Coloring strategy
        <select
          value={config.strategy}
          onChange={(event) =>
            setConfig({ ...config, strategy: event.currentTarget.value as typeof config.strategy })
          }
        >
          <option value="semantic">Semantic (genealogy)</option>
          <option value="categorical">Categorical (original colors)</option>
        </select>
      </label>
      <details className="color-controls__custom">
        <summary>Custom colors and groups</summary>
        <label>
          Languoid ID
          <input
            type="text"
            list={listId}
            placeholder="e.g. stan1293"
            value={target ?? selectedIds[0] ?? ''}
            onChange={(event) => {
              setTarget(event.currentTarget.value)
              setError(null)
            }}
          />
        </label>
        <datalist id={listId}>
          {selectedIds.slice(0, 100).map((id) => (
            <option key={id} value={id}>
              {hierarchy.languageById.get(id)?.name}
            </option>
          ))}
        </datalist>
        <p>
          {language ? (
            <>
              <span
                className="color-controls__swatch"
                style={{ backgroundColor: colors.get(id) }}
              />{' '}
              {language.name} · {colors.get(id)}
            </>
          ) : (
            'Enter an ID from the finder. Selected entries are suggested.'
          )}
        </p>
        <label>
          Custom color
          <span className="color-controls__value">
            <input
              type="color"
              aria-label="Pick custom color"
              value={/^#[0-9a-f]{6}$/i.test(color) ? color : '#287cb8'}
              onChange={(event) => setColor(event.currentTarget.value)}
            />
            <input
              type="text"
              aria-label="Custom color value"
              value={color}
              onChange={(event) => setColor(event.currentTarget.value)}
            />
          </span>
        </label>
        <div className="color-controls__actions">
          <button type="button" disabled={!language} onClick={() => applyColor('overrides')}>
            Set exact color
          </button>
          <button
            type="button"
            disabled={!language || config.strategy !== 'semantic'}
            onClick={() => applyColor('anchors')}
          >
            Set subtree color
          </button>
          <button
            type="button"
            disabled={!config.overrides[id]}
            onClick={() => applyColor('overrides', true)}
          >
            Remove exact color
          </button>
          <button
            type="button"
            disabled={!config.anchors[id]}
            onClick={() => applyColor('anchors', true)}
          >
            Remove subtree color
          </button>
        </div>
        <p>Exact colors affect one entry. Subtree colors guide its descendants.</p>
        {language && (config.overrides[id] || config.anchors[id]) && (
          <p>
            Exact: {config.overrides[id] ?? 'automatic'} · Subtree:{' '}
            {config.anchors[id] ?? 'automatic'}
          </p>
        )}
        <label>
          Comparison root IDs
          <textarea
            rows={2}
            placeholder="germ1287, roma1334, slav1255"
            value={roots ?? config.rootIds.join(', ')}
            onChange={(event) => setRoots(event.currentTarget.value)}
          />
        </label>
        <button type="button" disabled={config.strategy !== 'semantic'} onClick={applyRoots}>
          Apply comparison roots
        </button>
        <p>
          Comma-separated IDs. These start separate palettes; selected families and mapped-leaf
          groups are also included.
        </p>
      </details>
      {error && (
        <p className="color-controls__error" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={() => {
          setConfig(DEFAULT_COLOR_CONFIGURATION)
          setRoots(null)
          setColor('#287cb8')
          setError(null)
        }}
      >
        Reset color settings
      </button>
    </fieldset>
  )
}
