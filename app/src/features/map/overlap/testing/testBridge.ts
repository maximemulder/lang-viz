import type { ErrorEvent, Map as MapLibreMap } from 'maplibre-gl'
import { featureVariantIds, visibleVariantIds } from '../../inspection'
import {
  browserMessages,
  failNextPublication,
  overlapDiagnostics,
  setTileDelay,
} from '../diagnostics'
import { BUFFERS, coverageSourceId, fallbackLayerId, stripeLayerId } from '../layerIds'
import { serviceDiagnostics } from '../serviceDiagnostics'
import { parseOverlapSelection } from '../types.ts'
import type { OverlapTestApi } from './api'

/** Test controls and observers use public MapLibre APIs only. */
export const installOverlapTestApi = (
  map: MapLibreMap,
  configure: OverlapTestApi['configure'],
  recompute: () => void,
  selectionKey: () => string,
) => {
  const selectedIds = () => {
    const selection = parseOverlapSelection(selectionKey())
    return selection.variantGroups
      ? [...new Set(Object.values(selection.variantGroups).flat())]
      : selection.variantIds
  }
  const errors: string[] = []
  const frames: number[] = []
  let previousFrame = 0
  let blankLayerFrames = 0
  let styleReloading = false
  let styleReloadBlankFrames = 0
  let renderedFrames = 0
  let areaProbes: [number, number][] | null = null
  const areaFrames: {
    zoom: number
    missing: [number, number][]
    disappeared: [number, number][]
    samples: number
  }[] = []
  let filledAreas = new Set<string>()
  let stripeProbe: [number, number] | null = null
  const stripeFrames: { zoom: number; shared: boolean; colors: number; snapshot: string | null }[] =
    []
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
    if (stripeProbe && stripeFrames.length < 600) {
      const point = map.project(stripeProbe)
      const layers = BUFFERS.map(stripeLayerId).filter(
        (id) => map.getLayer(id) && Number(map.getPaintProperty(id, 'fill-layer-opacity')) > 0,
      )
      const canvas = map.getCanvas()
      const gl = canvas.getContext('webgl2')
      const pixels = new Uint8Array(8 * 8 * 4)
      const ratio = canvas.width / canvas.clientWidth
      gl?.readPixels(
        Math.round(point.x * ratio) - 4,
        canvas.height - Math.round(point.y * ratio) - 4,
        8,
        8,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixels,
      )
      const colors = new Set<number>()
      for (let i = 0; i < pixels.length; i += 4)
        colors.add(((pixels[i] ?? 0) << 16) | ((pixels[i + 1] ?? 0) << 8) | (pixels[i + 2] ?? 0))
      stripeFrames.push({
        zoom: map.getZoom(),
        shared: layers.length > 0 && map.queryRenderedFeatures(point, { layers }).length > 0,
        colors: colors.size,
        snapshot:
          BUFFERS.flatMap((buffer) => {
            if (!layers.includes(stripeLayerId(buffer))) return []
            const source = map.getSource(coverageSourceId(buffer))
            return source ? [(source.serialize() as { tiles?: string[] }).tiles?.[0] ?? null] : []
          })[0] ?? null,
      })
    }
    if (areaProbes && areaFrames.length < 1000) {
      const canvas = map.getCanvas()
      const visible = areaProbes.filter((coordinate) => {
        const p = map.project(coordinate)
        return p.x > 8 && p.y > 8 && p.x < canvas.clientWidth - 8 && p.y < canvas.clientHeight - 8
      })
      const gl = canvas.getContext('webgl2')
      const ratio = canvas.width / canvas.clientWidth
      const backgroundColor = map.getPaintProperty('ocean-background', 'background-color')
      const background =
        typeof backgroundColor === 'string' && /^#[0-9a-f]{6}$/i.test(backgroundColor)
          ? Number.parseInt(backgroundColor.slice(1), 16)
          : null
      const missing = visible.filter((coordinate) => {
        const point = map.project(coordinate)
        if (!visibleVariantIds(map, point).length) return true
        if (!gl || background === null) return false
        const pixel = new Uint8Array(4)
        gl.readPixels(
          Math.round(point.x * ratio),
          canvas.height - Math.round(point.y * ratio) - 1,
          1,
          1,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          pixel,
        )
        return (((pixel[0] ?? 0) << 16) | ((pixel[1] ?? 0) << 8) | (pixel[2] ?? 0)) === background
      })
      areaFrames.push({
        zoom: map.getZoom(),
        missing,
        disappeared: missing.filter((p) => filledAreas.has(JSON.stringify(p))),
        samples: visible.length,
      })
      // Newly exposed locations can still be loading. Only call it a disappearance
      // after observing a fill, and reset that history when a point leaves view.
      const inView = new Set(visible.map((p) => JSON.stringify(p)))
      filledAreas = new Set([...filledAreas].filter((p) => inView.has(p)))
      for (const p of visible) if (!missing.includes(p)) filledAreas.add(JSON.stringify(p))
    }
    const original = map.getLayer('selected-language-areas')
      ? Number(map.getPaintProperty('selected-language-areas', 'fill-opacity'))
      : 0
    const active = BUFFERS.some((buffer) =>
      map.getLayer(stripeLayerId(buffer))
        ? Number(map.getPaintProperty(stripeLayerId(buffer), 'fill-layer-opacity')) > 0
        : false,
    )
    if (selectedIds().length > 1 && !original && !active) {
      if (styleReloading) styleReloadBlankFrames++
      else blankLayerFrames++
    }
    for (const report of overlapDiagnostics.reports) {
      if (
        (report.outcome === 'pending' || report.outcome === 'ready') &&
        report.firstCoverageRenderMs === undefined &&
        report.buffer !== undefined &&
        map.getLayer(stripeLayerId(report.buffer)) &&
        Number(map.getPaintProperty(stripeLayerId(report.buffer), 'fill-layer-opacity')) > 0
      )
        overlapDiagnostics.update(report.requestId, {
          firstCoverageRenderMs: now - report.startedAt,
        })
      if (
        report.outcome === 'ready' &&
        report.firstRenderMs === undefined &&
        report.buffer !== undefined &&
        map.getLayer(stripeLayerId(report.buffer)) &&
        Number(map.getPaintProperty(stripeLayerId(report.buffer), 'fill-layer-opacity')) > 0
      ) {
        overlapDiagnostics.update(report.requestId, { firstRenderMs: now - report.startedAt })
      }
    }
  }
  map.on('error', onError)
  map.on('render', onRender)
  const onIdle = () => {
    styleReloading = false
  }
  map.on('idle', onIdle)
  const api = {
    configure,
    camera: (center: [number, number], zoom: number, duration = 0) =>
      map.easeTo({ center, zoom, duration }),
    recompute,
    failNextPublication,
    setTileDelay,
    watchAreas: (points: [number, number][] | null) => {
      areaProbes = points
      if (points) {
        areaFrames.length = 0
        filledAreas.clear()
      }
    },
    watchStripes: (center: [number, number] | null) => {
      stripeProbe = center
      if (center) stripeFrames.length = 0
    },
    inspect: (center: [number, number]) => {
      const point = map.project(center)
      const bounds = map.getCanvas().getBoundingClientRect()
      return {
        variantIds: visibleVariantIds(map, point),
        point: [Math.round(point.x + bounds.left), Math.round(point.y + bounds.top)] as [
          number,
          number,
        ],
      }
    },
    reloadStyle: () => {
      styleReloading = true
      map.setStyle(map.getStyle(), { diff: false })
    },
    samplePixels: (center: [number, number], radius: number): Promise<number[]> =>
      new Promise((resolve, reject) => {
        map.once('render', () => {
          const canvas = map.getCanvas()
          const gl = canvas.getContext('webgl2')
          if (!gl) {
            reject(new Error('WebGL2 unavailable'))
            return
          }
          const point = map.project(center)
          const ratio = canvas.width / canvas.clientWidth
          const size = radius * 2
          const pixels = new Uint8Array(size * size * 4)
          gl.readPixels(
            Math.round(point.x * ratio) - radius,
            canvas.height - Math.round(point.y * ratio) - radius,
            size,
            size,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            pixels,
          )
          resolve([...pixels])
        })
        map.triggerRepaint()
      }),
    probeTileSeams: () => import('./tileSeamProbe').then(({ probeTileSeams }) => probeTileSeams()),
    unexpectedMemberships: () => {
      const selected = new Set<string>([
        ...selectedIds(),
        ...parseOverlapSelection(selectionKey()).variantIds,
      ])
      return [
        ...new Set(
          BUFFERS.flatMap((buffer) => {
            const layer = stripeLayerId(buffer)
            if (!map.getLayer(layer) || !Number(map.getPaintProperty(layer, 'fill-layer-opacity')))
              return []
            return map
              .querySourceFeatures(coverageSourceId(buffer), {
                sourceLayer: 'overlap_coverage',
              })
              .flatMap(({ properties }) => featureVariantIds(properties))
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
        selectedCount: selectedIds().length,
        camera: { center: map.getCenter().toArray(), zoom: map.getZoom() },
        moving: map.isMoving(),
        tilesLoaded: map.areTilesLoaded(),
        mapLoaded: map.loaded(),
        viewport: { width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio },
        projection: map.getProjection(),
        reports: overlapDiagnostics.reports,
        tileServices: serviceDiagnostics,
        styleLoaded: map.isStyleLoaded(),
        patternImages: map.isStyleLoaded()
          ? map.listImages().filter((id) => id.startsWith('overlap:')).length
          : 0,
        missingVisiblePatterns: BUFFERS.flatMap((buffer) => {
          const id = stripeLayerId(buffer)
          if (!map.getLayer(id) || !Number(map.getPaintProperty(id, 'fill-layer-opacity')))
            return []
          return [
            ...new Set(
              map
                .queryRenderedFeatures({ layers: [id] })
                .map(({ properties }) => String(properties.pattern)),
            ),
          ].filter((pattern) => !map.hasImage(pattern))
        }),
        errors,
        browserMessages,
        renderedFrames,
        blankLayerFrames,
        styleReloading,
        styleReloadBlankFrames,
        // Render event intervals include idle gaps; these are not FPS measurements.
        renderIntervalsMs: frames,
        stripeFrames,
        areaFrames,
        renderer:
          debug && gl
            ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
            : gl?.getParameter(gl.RENDERER),
        activeBuffers: BUFFERS.filter(
          (buffer) =>
            map.getLayer(stripeLayerId(buffer)) &&
            Number(map.getPaintProperty(stripeLayerId(buffer), 'fill-layer-opacity')) > 0,
        ),
        coverageSourceTypes: BUFFERS.flatMap((buffer) => {
          const source = map.getSource(coverageSourceId(buffer))
          return source ? [source.type] : []
        }),
        coverageUrls: BUFFERS.flatMap((buffer) => {
          const source = map.getSource(coverageSourceId(buffer))
          return source ? [(source.serialize() as { tiles?: string[] }).tiles?.[0]] : []
        }),
        fallbackFeatures: BUFFERS.reduce<number>(
          (count, buffer) =>
            count +
            (map.getLayer(fallbackLayerId(buffer)) &&
            Number(map.getPaintProperty(fallbackLayerId(buffer), 'fill-layer-opacity')) > 0
              ? map.queryRenderedFeatures({ layers: [fallbackLayerId(buffer)] }).length
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
    map.off('idle', onIdle)
    if (window.overlapTest === api) delete window.overlapTest
  }
}
