import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import type { GeoJSONSource, Map as MapLibreMap, VectorSourceSpecification } from 'maplibre-gl'
import { Fragment, useEffect, useRef, useState } from 'react'
import { Layer, Source, useMap } from 'react-map-gl/maplibre'
import { languageArchiveUrl } from '../../../data/atlasRepository'
import type { GeometryVariant } from '../../../domain/atlas'
import {
  atlasDataAtom,
  geographyDatasetFilterAtom,
  languageOpacityAtom,
  overlapModeAtom,
  temporalViewAtom,
  visibleLanguageIdsAtom,
} from '../../../state/atlasState'
import { fallbackTilesUrl } from './fallbackProtocol'
import { stripeImage } from './patterns'
import { coverageTilesKey, retainCoverageTiles, tilesForBounds } from './tiles'
import type { OverlapCollection, OverlapRequest, OverlapResponse, TileCoordinate } from './types'
import { EMPTY_OVERLAPS } from './types'

const OVERLAP_SOURCE = 'language-overlap-regions'
const OVERLAP_LAYER = 'language-overlap-hatching'
const FALLBACK_SOURCE = 'language-overlap-fallback'
const BUFFERS = [0, 1] as const
const INSPECTION_LAYER = 'inspected-language-areas'
const EXAMPLE_LANGUAGE_IDS = ['stan1293', 'wels1247', 'scot1245', 'iris1253']

interface HatchingState {
  readonly collections: readonly [OverlapCollection, OverlapCollection]
  readonly activeBuffer: number | null
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  readonly message: string
}

const installPatterns = (
  map: MapLibreMap,
  collection: OverlapCollection,
  colors: ReadonlyMap<string, string>,
  ownedPatterns: Set<string>,
) => {
  const uniquePatterns = new Map(
    collection.features.map(({ properties }) => [properties.pattern, properties]),
  )
  if ([...uniquePatterns.values()].filter(({ variantIds }) => variantIds.length > 1).length > 128) {
    throw new Error(
      'Too many overlap combinations for this preview. Zoom in or select fewer languages.',
    )
  }
  const patterns = new Set<string>()
  for (const properties of uniquePatterns.values()) {
    patterns.add(properties.pattern)
    if (map.hasImage(properties.pattern)) continue
    const memberColors = properties.variantIds.map((id) => {
      const color = colors.get(id)
      if (!color) throw new Error(`Missing language color for ${id}`)
      return color
    })
    map.addImage(properties.pattern, stripeImage(memberColors), { pixelRatio: 2 })
    ownedPatterns.add(properties.pattern)
  }
  return patterns
}

export const OverlapHatching = ({
  variants,
  selectionKey,
  coverageReady,
  onCoverageReady,
}: {
  readonly variants: readonly GeometryVariant[]
  readonly selectionKey: string
  readonly coverageReady: boolean
  readonly onCoverageReady: (key: string | null) => void
}) => {
  const { current } = useMap()
  const map = current?.getMap()
  const data = useAtomValue(atlasDataAtom)
  const [mode, setMode] = useAtom(overlapModeAtom)
  const [opacity, setOpacity] = useAtom(languageOpacityAtom)
  const setVisibleIds = useSetAtom(visibleLanguageIdsAtom)
  const setPeriod = useSetAtom(temporalViewAtom)
  const setDatasetFilter = useSetAtom(geographyDatasetFilterAtom)
  const [state, setState] = useState<HatchingState>({
    collections: [EMPTY_OVERLAPS, EMPTY_OVERLAPS],
    activeBuffer: null,
    status: 'idle',
    message: '',
  })
  const configRef = useRef({ selectionKey, mode })
  const refreshRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!map) return
    const syncLayerOrder = () => {
      // The two sources mount independently. Insert normally, then order the
      // layers once both exist, without passing a missing target to addLayer.
      const layers = map.getLayersOrder()
      for (const buffer of BUFFERS) {
        for (const id of [`${OVERLAP_LAYER}-${buffer}`, `${FALLBACK_SOURCE}-${buffer}`]) {
          const overlapIndex = layers.indexOf(id)
          const inspectionIndex = layers.indexOf(INSPECTION_LAYER)
          if (overlapIndex >= 0 && inspectionIndex >= 0 && overlapIndex > inspectionIndex) {
            map.moveLayer(id, INSPECTION_LAYER)
          }
        }
      }
    }
    map.on('styledata', syncLayerOrder)
    syncLayerOrder()
    return () => {
      map.off('styledata', syncLayerOrder)
    }
  }, [map])

  useEffect(() => {
    if (!map) return
    const worker = new Worker(new URL('./overlap.worker.ts', import.meta.url), { type: 'module' })
    const colors = new Map(data.variants.map(({ id, color }) => [id, color]))
    let requestId = 0
    let previousKey = ''
    let timer: ReturnType<typeof setTimeout> | undefined
    let activePatterns = new Set<string>()
    const ownedPatterns = new Set<string>()
    let requestHasTiles = false
    let retainedTiles: TileCoordinate[] = []
    let activeBuffer: number | null = null
    let pendingResult: {
      readonly requestId: number
      readonly selectionKey: string
      readonly collection: OverlapCollection
      readonly buffer: 0 | 1
    } | null = null

    const publishCoverage = () => {
      const result = pendingResult
      const sourceId = `${OVERLAP_SOURCE}-${result?.buffer}`
      const source = map.getSource(sourceId) as GeoJSONSource | undefined
      const fallbackId = `${FALLBACK_SOURCE}-${result?.buffer}`
      const fallback = map.getSource(fallbackId)?.serialize() as
        | VectorSourceSpecification
        | undefined
      if (
        result &&
        result.requestId === requestId &&
        source &&
        source.serialize().data === result.collection &&
        map.isSourceLoaded(sourceId) &&
        fallback?.tiles?.[0] ===
          fallbackTilesUrl(languageArchiveUrl(), result.collection.coverageTiles ?? []) &&
        map.isSourceLoaded(fallbackId)
      ) {
        activeBuffer = result.buffer
        activePatterns = new Set(
          result.collection.features.map(({ properties }) => properties.pattern),
        )
        pendingResult = null
        setState((previous) => ({
          ...previous,
          activeBuffer: result.buffer,
          status: 'ready',
          collections:
            result.buffer === 0
              ? [result.collection, EMPTY_OVERLAPS]
              : [EMPTY_OVERLAPS, result.collection],
        }))
        onCoverageReady(result.selectionKey)
      }
    }

    const suspendCoverage = () => {
      requestId++
      previousKey = ''
      pendingResult = null
      retainedTiles = []
      activeBuffer = null
      activePatterns.clear()
      onCoverageReady(null)
    }

    const refresh = () => {
      if (!map.getLayer('selected-language-areas')) return
      const config = configRef.current
      const variantIds: string[] = config.mode === 'hatching' ? JSON.parse(config.selectionKey) : []
      const bounds = map.getBounds()
      const viewportTiles =
        variantIds.length > 1
          ? tilesForBounds(
              {
                west: bounds.getWest(),
                east: bounds.getEast(),
                south: bounds.getSouth(),
                north: bounds.getNorth(),
              },
              map.getZoom(),
            )
          : []
      const tiles = retainCoverageTiles(viewportTiles, retainedTiles)
      const key = JSON.stringify([variantIds, coverageTilesKey(tiles)])
      retainedTiles = tiles
      if (key === previousKey) return
      previousKey = key
      pendingResult = null
      requestHasTiles = tiles.length > 0
      const request: OverlapRequest = {
        requestId: ++requestId,
        archiveUrl: languageArchiveUrl().replace(/^pmtiles:\/\//, ''),
        sourceLayer: data.manifest.vectorLayer,
        variantIds,
        tiles,
      }
      worker.postMessage(request)
      if (tiles.length === 0) {
        activePatterns.clear()
        setState({
          collections: [EMPTY_OVERLAPS, EMPTY_OVERLAPS],
          activeBuffer: null,
          status: 'idle',
          message: '',
        })
      } else {
        setState((previous) => ({
          ...previous,
          status: 'loading',
          message: 'Updating overlap stripes…',
        }))
      }
    }
    const schedule = () => {
      clearTimeout(timer)
      timer = setTimeout(refresh, 120)
    }
    refreshRef.current = () => {
      // Remove old memberships immediately when selection/source/period changes.
      suspendCoverage()
      setState({
        collections: [EMPTY_OVERLAPS, EMPTY_OVERLAPS],
        activeBuffer: null,
        status: 'idle',
        message: '',
      })
      schedule()
    }
    worker.onmessage = ({ data: response }: MessageEvent<OverlapResponse>) => {
      if (response.requestId !== requestId || !requestHasTiles) return
      if ('error' in response) {
        setState((previous) => ({
          ...previous,
          status: 'error',
          message: `${response.error}${activeBuffer !== null ? ' Keeping previous stripes; solid colors show other areas.' : ''}`,
        }))
        return
      }
      try {
        const nextPatterns = installPatterns(map, response.collection, colors, ownedPatterns)
        // Protect images used by either buffer until the source swap completes.
        activePatterns = new Set([...activePatterns, ...nextPatterns])
        const buffer = activeBuffer === 0 ? 1 : 0
        pendingResult = {
          requestId: response.requestId,
          selectionKey: configRef.current.selectionKey,
          collection: response.collection,
          buffer,
        }
        setState((previous) => ({
          ...previous,
          collections:
            buffer === 0
              ? [response.collection, previous.collections[1]]
              : [previous.collections[0], response.collection],
          status: 'loading',
          message: response.collection.features.some(
            ({ properties }) => properties.variantIds.length > 1,
          )
            ? 'Shared areas alternate language colors'
            : 'No overlaps in this view',
        }))
      } catch (error) {
        setState((previous) => ({
          ...previous,
          status: 'error',
          message: error instanceof Error ? error.message : 'Could not draw overlap stripes.',
        }))
      }
    }
    worker.onerror = () =>
      setState((previous) => ({
        ...previous,
        status: 'error',
        message: 'Could not calculate overlap stripes. Try reloading the map.',
      }))
    const prunePatterns = () => {
      const sources = BUFFERS.map((buffer) => `${OVERLAP_SOURCE}-${buffer}`)
      if (sources.some((id) => !map.getSource(id) || !map.isSourceLoaded(id))) return
      const referencedPatterns = new Set(
        sources.flatMap((id) =>
          map.querySourceFeatures(id).map(({ properties }) => properties.pattern),
        ),
      )
      for (const id of ownedPatterns) {
        if (activePatterns.has(id) || referencedPatterns.has(id)) continue
        if (map.hasImage(id)) map.removeImage(id)
        ownedPatterns.delete(id)
      }
    }
    map.on('load', schedule)
    map.on('moveend', schedule)
    map.on('resize', schedule)
    map.on('idle', prunePatterns)
    map.on('idle', schedule)
    map.on('sourcedata', publishCoverage)
    map.on('idle', publishCoverage)
    schedule()
    return () => {
      clearTimeout(timer)
      refreshRef.current = null
      worker.terminate()
      map.off('load', schedule)
      map.off('moveend', schedule)
      map.off('resize', schedule)
      map.off('idle', prunePatterns)
      map.off('idle', schedule)
      map.off('sourcedata', publishCoverage)
      map.off('idle', publishCoverage)
      for (const id of ownedPatterns) if (map.hasImage(id)) map.removeImage(id)
    }
  }, [map, data, onCoverageReady])

  useEffect(() => {
    configRef.current = { selectionKey, mode }
    refreshRef.current?.()
  }, [selectionKey, mode])

  const showExample = () => {
    setPeriod('contemporary')
    setDatasetFilter(['asher2007world'])
    setVisibleIds(EXAMPLE_LANGUAGE_IDS)
    setMode('hatching')
    map?.flyTo({ center: [-4.5, 54.2], zoom: 4.4, duration: 900 })
  }

  return (
    <>
      {BUFFERS.map((buffer) => (
        <Fragment key={buffer}>
          <Source
            key={buffer}
            id={`${OVERLAP_SOURCE}-${buffer}`}
            type="geojson"
            data={state.collections[buffer]}
            tolerance={0}
            maxzoom={8}
          >
            <Layer
              id={`${OVERLAP_LAYER}-${buffer}`}
              type="fill"
              paint={{
                'fill-pattern': ['get', 'pattern'],
                'fill-opacity': 1,
                // Keep the staging layer enabled so MapLibre prepares its tiles.
                'fill-layer-opacity': coverageReady && state.activeBuffer === buffer ? opacity : 0,
                'fill-layer-opacity-transition': { duration: 0 },
                'fill-antialias': true,
              }}
            />
          </Source>
          {state.collections[buffer].coverageTiles && (
            <Source
              id={`${FALLBACK_SOURCE}-${buffer}`}
              type="vector"
              tiles={[
                fallbackTilesUrl(
                  languageArchiveUrl(),
                  state.collections[buffer].coverageTiles ?? [],
                ),
              ]}
              minzoom={0}
              maxzoom={8}
            >
              <Layer
                id={`${FALLBACK_SOURCE}-${buffer}`}
                source-layer={data.manifest.vectorLayer}
                type="fill"
                filter={['in', ['get', 'variant_id'], ['literal', variants.map(({ id }) => id)]]}
                paint={{
                  'fill-color': ['get', 'color'],
                  'fill-opacity': 1,
                  'fill-layer-opacity':
                    coverageReady && state.activeBuffer === buffer ? opacity : 0,
                  'fill-layer-opacity-transition': { duration: 0 },
                  'fill-antialias': false,
                }}
              />
            </Source>
          )}
        </Fragment>
      ))}
      <div className="map-overlap-control">
        <label>
          <span>Overlapping languages</span>
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
        {mode === 'hatching' && (
          <label className="map-opacity-control" htmlFor="language-opacity">
            <span>
              Color strength{' '}
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
        )}
        <button type="button" onClick={showExample}>
          Try Britain example
        </button>
        <p role="status" data-overlap-status={state.status}>
          {mode === 'blending'
            ? 'Overlapping colors are blended'
            : variants.length < 2
              ? 'Select two or more languages, or try the example'
              : state.message || 'Preparing overlap stripes…'}
        </p>
      </div>
    </>
  )
}
