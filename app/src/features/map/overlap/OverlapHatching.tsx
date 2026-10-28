import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'
import { useEffect, useRef, useState } from 'react'
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
import { stripeImage } from './patterns'
import { tilesForBounds } from './tiles'
import type { OverlapCollection, OverlapRequest, OverlapResponse } from './types'
import { EMPTY_OVERLAPS } from './types'

const OVERLAP_SOURCE = 'language-overlap-regions'
const OVERLAP_LAYER = 'language-overlap-hatching'
const INSPECTION_LAYER = 'inspected-language-areas'
const EXAMPLE_LANGUAGE_IDS = ['stan1293', 'wels1247', 'scot1245', 'iris1253']

interface HatchingState {
  readonly collection: OverlapCollection
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
    collection: EMPTY_OVERLAPS,
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
      const overlapIndex = layers.indexOf(OVERLAP_LAYER)
      const inspectionIndex = layers.indexOf(INSPECTION_LAYER)
      if (overlapIndex >= 0 && inspectionIndex >= 0 && overlapIndex + 1 !== inspectionIndex) {
        map.moveLayer(OVERLAP_LAYER, INSPECTION_LAYER)
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
    let pendingResult: {
      readonly requestId: number
      readonly selectionKey: string
      readonly collection: OverlapCollection
    } | null = null

    const publishCoverage = () => {
      const result = pendingResult
      const source = map.getSource(OVERLAP_SOURCE) as GeoJSONSource | undefined
      if (
        result &&
        result.requestId === requestId &&
        source &&
        source.serialize().data === result.collection &&
        map.isSourceLoaded(OVERLAP_SOURCE)
      ) {
        onCoverageReady(result.selectionKey)
      }
    }

    const suspendCoverage = () => {
      requestId++
      previousKey = ''
      pendingResult = null
      onCoverageReady(null)
    }

    const refresh = () => {
      if (!map.getLayer('selected-language-areas')) return
      const config = configRef.current
      const variantIds: string[] = config.mode === 'hatching' ? JSON.parse(config.selectionKey) : []
      const bounds = map.getBounds()
      const tiles =
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
      const key = JSON.stringify([variantIds, tiles])
      if (key === previousKey) return
      previousKey = key
      pendingResult = null
      requestHasTiles = tiles.length > 0
      onCoverageReady(null)
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
        setState({ collection: EMPTY_OVERLAPS, status: 'idle', message: '' })
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
      setState({ collection: EMPTY_OVERLAPS, status: 'idle', message: '' })
      schedule()
    }
    worker.onmessage = ({ data: response }: MessageEvent<OverlapResponse>) => {
      if (response.requestId !== requestId || !requestHasTiles) return
      if ('error' in response) {
        setState({ collection: EMPTY_OVERLAPS, status: 'error', message: response.error })
        return
      }
      try {
        activePatterns = installPatterns(map, response.collection, colors, ownedPatterns)
        pendingResult = {
          requestId: response.requestId,
          selectionKey: configRef.current.selectionKey,
          collection: response.collection,
        }
        setState({
          collection: response.collection,
          status: 'ready',
          message: response.collection.features.some(
            ({ properties }) => properties.variantIds.length > 1,
          )
            ? 'Shared areas alternate language colors'
            : 'No overlaps in this view',
        })
      } catch (error) {
        setState({
          collection: EMPTY_OVERLAPS,
          status: 'error',
          message: error instanceof Error ? error.message : 'Could not draw overlap stripes.',
        })
      }
    }
    worker.onerror = () =>
      setState({
        collection: EMPTY_OVERLAPS,
        status: 'error',
        message: 'Could not calculate overlap stripes. Try reloading the map.',
      })
    const prunePatterns = () => {
      if (!map.getSource(OVERLAP_SOURCE) || !map.isSourceLoaded(OVERLAP_SOURCE)) return
      const referencedPatterns = new Set(
        map.querySourceFeatures(OVERLAP_SOURCE).map(({ properties }) => properties.pattern),
      )
      for (const id of ownedPatterns) {
        if (activePatterns.has(id) || referencedPatterns.has(id)) continue
        if (map.hasImage(id)) map.removeImage(id)
        ownedPatterns.delete(id)
      }
    }
    map.on('load', schedule)
    map.on('movestart', suspendCoverage)
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
      map.off('movestart', suspendCoverage)
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
      <Source id={OVERLAP_SOURCE} type="geojson" data={state.collection} tolerance={0} maxzoom={8}>
        <Layer
          id={OVERLAP_LAYER}
          type="fill"
          layout={{ visibility: coverageReady ? 'visible' : 'none' }}
          paint={{
            'fill-pattern': ['get', 'pattern'],
            'fill-opacity': 1,
            'fill-layer-opacity': opacity,
            'fill-layer-opacity-transition': { duration: 0 },
            'fill-antialias': true,
          }}
        />
      </Source>
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
