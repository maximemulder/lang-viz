import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useEffect, useId, useRef, useState } from 'react'
import { useMap } from 'react-map-gl/maplibre'
import { SidebarPane } from '../../components/SidebarPane'
import {
  applyOptimizedColorsAtom,
  canUndoColorsAtom,
  colorConfigurationAtom,
  colorTopologyAtom,
  languageColorsAtom,
  languageHierarchyAtom,
  mapEntriesAtom,
  optimizedColorsAtom,
  overlapStatusAtom,
  preparedPaletteAtom,
  resetColorSettingsAtom,
  restoreDefaultColorsAtom,
  selectedMapAreasAtom,
  semanticPaletteAtom,
  undoColorsAtom,
  visibleLanguageIdsAtom,
} from '../../state/atlasState'
import { captureColorView, optimizeColorView } from './colorView'

export const ColorControls = () => {
  const [config, setConfig] = useAtom(colorConfigurationAtom)
  const hierarchy = useAtomValue(languageHierarchyAtom)
  const selectedIds = useAtomValue(visibleLanguageIdsAtom)
  const colors = useAtomValue(languageColorsAtom)
  const topology = useAtomValue(colorTopologyAtom)
  const reference = useAtomValue(semanticPaletteAtom)
  const areas = useAtomValue(selectedMapAreasAtom)
  const entries = useAtomValue(mapEntriesAtom)
  const optimized = useAtomValue(optimizedColorsAtom)
  const prepared = useAtomValue(preparedPaletteAtom)
  const canUndo = useAtomValue(canUndoColorsAtom)
  const overlap = useAtomValue(overlapStatusAtom)
  const applyOptimized = useSetAtom(applyOptimizedColorsAtom)
  const undo = useSetAtom(undoColorsAtom)
  const restore = useSetAtom(restoreDefaultColorsAtom)
  const reset = useSetAtom(resetColorSettingsAtom)
  const maps = useMap()
  const map = maps['atlas-map']?.getMap()
  const request = useRef<AbortController | null>(null)
  const [busy, setBusy] = useState(false)
  const [mapReady, setMapReady] = useState(false)
  const listId = useId()
  const [target, setTarget] = useState<string | null>(null)
  const [color, setColor] = useState('#287cb8')
  const [roots, setRoots] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const id = (target ?? selectedIds[0] ?? '').trim()
  const language = hierarchy.languageById.get(id)

  // Selection/manual-color changes invalidate an in-flight capture. An applied
  // palette itself survives all ordinary navigation and selection changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Configuration and entries are explicit cancellation boundaries for asynchronous snapshots.
  useEffect(() => () => request.current?.abort(), [config, entries])
  useEffect(() => {
    if (!map) return
    const updateReady = () =>
      setMapReady(Boolean(!map.isMoving() && map.areTilesLoaded() && map.isStyleLoaded()))
    const loading = () => setMapReady(false)
    const cancel = () => {
      request.current?.abort()
      loading()
    }
    updateReady()
    map.on('movestart', cancel)
    map.on('resize', cancel)
    for (const event of ['idle', 'sourcedata', 'styledata', 'moveend'] as const)
      map.on(event, updateReady)
    for (const event of ['sourcedataloading', 'styledataloading'] as const) map.on(event, loading)
    return () => {
      map.off('movestart', cancel)
      map.off('resize', cancel)
      for (const event of ['idle', 'sourcedata', 'styledata', 'moveend'] as const)
        map.off(event, updateReady)
      for (const event of ['sourcedataloading', 'styledataloading'] as const)
        map.off(event, loading)
      cancel()
    }
  }, [map])

  const optimize = async () => {
    if (!map) return
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setError(null)
    try {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      const camera = JSON.stringify([map.getCenter(), map.getZoom(), map.getProjection()])
      const view = await captureColorView(map, areas, entries, controller.signal)
      if (new Set(view.footprints.map(({ languageId }) => languageId)).size < 2) {
        throw new Error('Show at least two languoids in this view to optimize their colors.')
      }
      const result = await optimizeColorView(
        { topology, reference, configuration: config, view },
        controller.signal,
      )
      controller.signal.throwIfAborted()
      if (camera !== JSON.stringify([map.getCenter(), map.getZoom(), map.getProjection()])) {
        throw new Error(
          'The view changed during color optimization. Try again when the map is still.',
        )
      }
      applyOptimized(result)
    } catch (error) {
      if (!controller.signal.aborted)
        setError(error instanceof Error ? error.message : String(error))
    } finally {
      if (request.current === controller) {
        request.current = null
        setBusy(false)
      }
    }
  }

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
    <div className="color-controls">
      <p>
        Set the palette for mapped languages. Use the swatches in Entries for individual group
        colors.
      </p>
      <label>
        Coloring strategy
        <select
          value={config.strategy}
          onChange={(event) =>
            setConfig({
              ...config,
              strategy: event.currentTarget.value as typeof config.strategy,
            })
          }
        >
          <option value="semantic">Semantic (genealogy)</option>
          <option value="categorical">Categorical (original colors)</option>
        </select>
      </label>
      <div className="color-controls__actions">
        <button
          type="button"
          disabled={
            busy ||
            !mapReady ||
            config.strategy !== 'semantic' ||
            selectedIds.length < 2 ||
            overlap.status === 'loading'
          }
          onClick={optimize}
        >
          Optimize colors for this view
        </button>
        {busy && (
          <button type="button" onClick={() => request.current?.abort()}>
            Cancel
          </button>
        )}
        <button type="button" disabled={busy || !canUndo} onClick={() => undo()}>
          Undo colors
        </button>
        <button type="button" disabled={busy || !optimized} onClick={() => restore()}>
          Use default palette
        </button>
      </div>
      <p role="status" aria-live="polite" className="color-controls__status">
        {busy
          ? 'Optimizing visible languoids…'
          : optimized
            ? `Optimized ${optimized.languageCount} visible languoids across ${optimized.rootCount} color groups.`
            : prepared
              ? 'Using prepared dataset colors.'
              : 'Using stable default colors.'}{' '}
        Colors stay fixed while you explore. Optimization also updates offscreen relatives to keep
        families consistent. Custom colors are kept.
      </p>
      <SidebarPane
        className="color-controls__custom"
        title="Advanced palette defaults and overrides"
      >
        <p>
          These defaults apply across the catalog. Group colors and individual area overrides take
          precedence.
        </p>
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
          Comma-separated IDs. These start separate palettes. Selecting families keeps their
          genealogy colors; optimize the view to spread its visible branches apart.
        </p>
        <button
          type="button"
          onClick={() => {
            request.current?.abort()
            reset()
            setRoots(null)
            setColor('#287cb8')
            setError(null)
          }}
        >
          Reset color settings
        </button>
      </SidebarPane>
      {error && (
        <p className="color-controls__error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
