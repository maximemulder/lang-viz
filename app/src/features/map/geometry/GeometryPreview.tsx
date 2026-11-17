import { useAtomValue } from 'jotai'
import type { VectorSourceSpecification } from 'maplibre-gl'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Source } from 'react-map-gl/maplibre'
import { languageArchiveUrl } from '../../../data/atlasRepository'
import { selectGeometryArchives } from '../../../data/geometryArchives'
import { atlasDataAtom } from '../../../state/atlasState'
import { GeometryHighlight } from '../GeometryHighlight'
import {
  createOverlapController,
  type HatchingState,
  idleHatchingState,
} from '../overlap/controller'
import { createPartsResolver } from '../overlap/coverageParts'
import {
  type CoverageSnapshot,
  registerCoverage,
  releaseCoverage,
} from '../overlap/deliveryProtocol'
import type { TileCoordinate } from '../overlap/types'
import { useGeometryDisplay } from './display'
import { GeometryCoverageClient } from './geometryService'

const PREVIEW_MEMBER = 'geometry-preview'
const sourceId = (id: string, zoom: number, buffer: number) => `${id}-${zoom}-${buffer}`

/** An absent representation is another consumer of the same composition/cache
 * service. Displayed representations use GeometryHighlight directly instead.
 */
const PreviewLevel = ({
  id,
  ids,
  zoom,
  tiles,
  visible,
  fillOpacity,
  ready,
}: {
  readonly id: string
  readonly ids: readonly string[]
  readonly zoom: number
  readonly tiles: readonly TileCoordinate[]
  readonly visible: boolean
  readonly fillOpacity: number
  readonly ready: (zoom: number, value: boolean) => void
}) => {
  const data = useAtomValue(atlasDataAtom)
  const { map } = useGeometryDisplay()
  const [state, setState] = useState<HatchingState>(idleHatchingState)
  const controllerRef = useRef<ReturnType<typeof createOverlapController> | null>(null)
  const tilesRef = useRef(tiles)
  const archiveUrl = languageArchiveUrl(
    selectGeometryArchives(data.manifest, data.variants, [], 'all', ids),
  ).replace(/^pmtiles:\/\//, '')
  const selectionKey = JSON.stringify({
    variantIds: ids,
    variantGroups: Object.fromEntries(ids.map((id) => [id, [PREVIEW_MEMBER]])),
  })

  useEffect(() => {
    if (!map) return
    const worker = new GeometryCoverageClient()
    const owned = new Map<
      number,
      { snapshot: CoverageSnapshot; buffer: number; retired: boolean }
    >()
    const collect = () => {
      for (const [snapshotId, item] of owned) {
        if (!item.retired) continue
        const source = map.getSource(sourceId(id, zoom, item.buffer))?.serialize() as
          | VectorSourceSpecification
          | undefined
        if (source?.tiles?.[0] === item.snapshot.url) continue
        releaseCoverage(item.snapshot)
        owned.delete(snapshotId)
      }
    }
    const controller = createOverlapController({
      worker,
      archiveUrl,
      sourceLayer: data.manifest.vectorLayer,
      parts: createPartsResolver(data.manifest.coverageParts, data.variants),
      onCoverageReady: () => {},
      onChange: (state) => {
        setState(state)
        ready(zoom, state.status === 'ready' || state.status === 'error')
      },
      resources: {
        stage: (tiles, buffer) => {
          const snapshot = registerCoverage(tiles, archiveUrl)
          owned.set(snapshot.id, { snapshot, buffer, retired: false })
          return { snapshot, pixels: 0 }
        },
        isReady: (snapshot, buffer) => {
          const source = map.getSource(sourceId(id, zoom, buffer))?.serialize() as
            | VectorSourceSpecification
            | undefined
          return (
            !map.isMoving() &&
            source?.tiles?.[0] === snapshot.url &&
            map.isSourceLoaded(sourceId(id, zoom, buffer))
          )
        },
        release: (snapshot) => {
          const item = owned.get(snapshot.id)
          if (item) item.retired = true
          collect()
        },
      },
    })
    controllerRef.current = controller
    worker.onmessage = ({ data }) => controller.receive(data)
    worker.onerror = () => controller.workerFailed()
    map.on('sourcedata', controller.publish)
    map.on('idle', controller.publish)
    map.on('styledata', collect)
    controller.configure(selectionKey, true)
    controller.refresh(tilesRef.current)
    return () => {
      controllerRef.current = null
      controller.dispose()
      ready(zoom, false)
      map.off('sourcedata', controller.publish)
      map.off('idle', controller.publish)
      map.off('styledata', collect)
      for (const item of owned.values()) releaseCoverage(item.snapshot)
    }
  }, [map, data, archiveUrl, selectionKey, zoom, ready, id])

  useEffect(() => {
    tilesRef.current = tiles
    controllerRef.current?.refresh(tiles)
  }, [tiles])

  return (
    <>
      {visible && state.status === 'error' && (
        <div className="overlap-feedback" data-status="error" role="status">
          <span>Could not load this outline.</span>
          <button
            type="button"
            onClick={() => {
              controllerRef.current?.retry()
              controllerRef.current?.refresh(tilesRef.current)
            }}
          >
            Retry
          </button>
        </div>
      )}
      {state.snapshots.map(
        (snapshot, buffer) =>
          snapshot && (
            <Source
              key={sourceId(id, zoom, buffer)}
              id={sourceId(id, zoom, buffer)}
              type="vector"
              tiles={[snapshot.url]}
              minzoom={0}
              maxzoom={zoom}
            >
              <GeometryHighlight
                id={sourceId(id, zoom, buffer)}
                source={sourceId(id, zoom, buffer)}
                groups={[[PREVIEW_MEMBER]]}
                variants={ids}
                fillOpacity={fillOpacity}
                visible={visible && state.activeBuffer === buffer}
              />
            </Source>
          ),
      )}
    </>
  )
}

export const GeometryPreview = ({
  id,
  ids,
  fillOpacity,
  coordinateDisplay,
}: {
  readonly id: string
  readonly ids: readonly string[]
  readonly fillOpacity: number
  readonly coordinateDisplay: boolean
}) => {
  const { state, display } = useGeometryDisplay()
  const readiness = useRef(new Map<number, boolean>())
  const ready = useCallback(
    (zoom: number, value: boolean) => {
      readiness.current.set(zoom, value)
      if (value && coordinateDisplay) display.previewReady(zoom)
    },
    [display, coordinateDisplay],
  )
  useLayoutEffect(() => {
    if (coordinateDisplay)
      return display.previewBarrier((zoom) => readiness.current.get(zoom) === true)
  }, [display, coordinateDisplay])
  const levels = useMemo(() => {
    const levels = new Map<number, readonly TileCoordinate[]>()
    if (state.committedTiles.length) levels.set(state.zoom, state.committedTiles)
    const targetZoom = state.target[0]?.z
    if (targetZoom !== undefined) levels.set(targetZoom, state.target)
    return [...levels]
  }, [state])
  return (
    <>
      {levels.map(([zoom, tiles]) => (
        <PreviewLevel
          key={`${id}-${zoom}`}
          id={id}
          ids={ids}
          zoom={zoom}
          tiles={tiles}
          visible={zoom === state.zoom}
          fillOpacity={fillOpacity}
          ready={ready}
        />
      ))}
    </>
  )
}
