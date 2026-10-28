import type { ErrorEvent, Map as MapLibreMap } from 'maplibre-gl'
import { browserMessages, type OverlapTestApi, overlapDiagnostics } from './diagnostics'

import { serviceDiagnostics } from './serviceDiagnostics'

const BUFFERS = [0, 1] as const
const OVERLAP_LAYER = 'language-overlap-hatching'
const FALLBACK_SOURCE = 'language-overlap-fallback'

/** Test controls and observers use public MapLibre APIs only. */
export const installOverlapTestApi = (
  map: MapLibreMap,
  configure: OverlapTestApi['configure'],
  recompute: () => void,
  selectionKey: () => string,
) => {
  const errors: string[] = []
  const frames: number[] = []
  let previousFrame = 0
  let blankLayerFrames = 0
  let renderedFrames = 0
  const onError = (event: ErrorEvent) => {
    errors.push(String(event.error))
  }
  const onRender = () => {
    const now = performance.now()
    if (previousFrame) {
      frames.push(now - previousFrame)
      if (frames.length > 600) frames.shift()
    }
    previousFrame = now
    renderedFrames++
    const original = map.getLayer('selected-language-areas')
      ? Number(map.getPaintProperty('selected-language-areas', 'fill-opacity'))
      : 0
    const active = BUFFERS.some((buffer) =>
      map.getLayer(`${OVERLAP_LAYER}-${buffer}`)
        ? Number(map.getPaintProperty(`${OVERLAP_LAYER}-${buffer}`, 'fill-layer-opacity')) > 0
        : false,
    )
    if (JSON.parse(selectionKey()).length > 1 && !original && !active) blankLayerFrames++
    for (const report of overlapDiagnostics.reports) {
      if (
        (report.outcome === 'pending' || report.outcome === 'ready') &&
        report.firstCoverageRenderMs === undefined &&
        report.buffer !== undefined &&
        map.getLayer(`${OVERLAP_LAYER}-${report.buffer}`) &&
        Number(map.getPaintProperty(`${OVERLAP_LAYER}-${report.buffer}`, 'fill-layer-opacity')) > 0
      )
        overlapDiagnostics.update(report.requestId, {
          firstCoverageRenderMs: now - report.startedAt,
        })
      if (
        report.outcome === 'ready' &&
        report.firstRenderMs === undefined &&
        report.buffer !== undefined &&
        map.getLayer(`${OVERLAP_LAYER}-${report.buffer}`) &&
        Number(map.getPaintProperty(`${OVERLAP_LAYER}-${report.buffer}`, 'fill-layer-opacity')) > 0
      ) {
        overlapDiagnostics.update(report.requestId, { firstRenderMs: now - report.startedAt })
      }
    }
  }
  map.on('error', onError)
  map.on('render', onRender)
  const api = {
    configure,
    camera: (center: [number, number], zoom: number, duration = 0) =>
      map.easeTo({ center, zoom, duration }),
    recompute,
    unexpectedMemberships: () => {
      const selected = new Set<string>(JSON.parse(selectionKey()))
      return [
        ...new Set(
          BUFFERS.flatMap((buffer) => {
            const layer = `${OVERLAP_LAYER}-${buffer}`
            if (!map.getLayer(layer) || !Number(map.getPaintProperty(layer, 'fill-layer-opacity')))
              return []
            return map
              .querySourceFeatures(`language-overlap-regions-${buffer}`, {
                sourceLayer: 'overlap_coverage',
              })
              .flatMap(({ properties }) =>
                String(properties.pattern).slice('overlap:'.length).split('|'),
              )
              .filter((id) => !selected.has(id))
          }),
        ),
      ]
    },
    snapshot: () => {
      const status = document.querySelector('[data-overlap-status]')
      const gl = map.getCanvas().getContext('webgl2')
      const debug = gl?.getExtension('WEBGL_debug_renderer_info')
      return {
        status: status?.getAttribute('data-overlap-status'),
        message: status?.textContent,
        selectedCount: JSON.parse(selectionKey()).length,
        camera: { center: map.getCenter().toArray(), zoom: map.getZoom() },
        moving: map.isMoving(),
        tilesLoaded: map.areTilesLoaded(),
        viewport: { width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio },
        projection: map.getProjection(),
        reports: overlapDiagnostics.reports,
        tileServices: serviceDiagnostics,
        patternImages: map.listImages().filter((id) => id.startsWith('overlap:')).length,
        errors,
        browserMessages,
        renderedFrames,
        blankLayerFrames,
        // Render event intervals include idle gaps; these are not FPS measurements.
        renderIntervalsMs: frames,
        renderer:
          debug && gl
            ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
            : gl?.getParameter(gl.RENDERER),
        activeBuffers: BUFFERS.filter(
          (buffer) =>
            map.getLayer(`${OVERLAP_LAYER}-${buffer}`) &&
            Number(map.getPaintProperty(`${OVERLAP_LAYER}-${buffer}`, 'fill-layer-opacity')) > 0,
        ),
        coverageSourceTypes: BUFFERS.flatMap((buffer) => {
          const source = map.getSource(`language-overlap-regions-${buffer}`)
          return source ? [source.type] : []
        }),
        fallbackFeatures: BUFFERS.reduce<number>(
          (count, buffer) =>
            count +
            (map.getLayer(`${FALLBACK_SOURCE}-${buffer}`) &&
            Number(map.getPaintProperty(`${FALLBACK_SOURCE}-${buffer}`, 'fill-layer-opacity')) > 0
              ? map.queryRenderedFeatures({ layers: [`${FALLBACK_SOURCE}-${buffer}`] }).length
              : 0),
          0,
        ),
      }
    },
  }
  window.overlapTest = api
  return () => {
    map.off('error', onError)
    map.off('render', onRender)
    if (window.overlapTest === api) delete window.overlapTest
  }
}
