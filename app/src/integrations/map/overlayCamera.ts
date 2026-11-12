import type { Map as MapLibreMap } from 'maplibre-gl'
import type { GeographicBounds } from '../../domain/languageFocus.ts'

interface OverlayCameraMap {
  isStyleLoaded: MapLibreMap['isStyleLoaded']
  on(type: 'style.load' | 'idle' | 'moveend', listener: () => void): unknown
  off(type: 'style.load' | 'idle' | 'moveend', listener: () => void): unknown
  resize(): unknown
  stop(): unknown
  getCanvas(): { clientWidth: number; clientHeight: number }
  fitBounds(
    bounds: [[number, number], [number, number]],
    options: { padding: number; maxZoom: number; duration: number },
  ): unknown
}

/** A one-shot explicit focus, guarded again after style readiness and the next frame. */
export const startOverlayCamera = ({
  map,
  bounds,
  isCurrent,
  canStop,
  reducedMotion,
  frames,
}: {
  readonly map: OverlayCameraMap
  readonly bounds: GeographicBounds | null | (() => GeographicBounds | null)
  readonly isCurrent: () => boolean
  readonly canStop: () => boolean
  readonly reducedMotion: boolean
  readonly frames: { request: (callback: () => void) => number; cancel: (id: number) => void }
}) => {
  let frame: number | null = null
  let disposed = false
  let moved = false
  let animating = false
  const settled = () => {
    animating = false
  }
  const ready = () => {
    if (disposed || moved || frame !== null || !bounds || !isCurrent() || !map.isStyleLoaded())
      return
    frame = frames.request(() => {
      frame = null
      if (disposed || moved || !isCurrent() || !map.isStyleLoaded()) return
      const currentBounds = typeof bounds === 'function' ? bounds() : bounds
      if (!currentBounds || !isCurrent()) return
      map.resize()
      const canvas = map.getCanvas()
      if (!canvas.clientWidth || !canvas.clientHeight) return
      moved = true
      map.stop()
      animating = !reducedMotion
      map.fitBounds(
        [
          [currentBounds[0], currentBounds[1]],
          [currentBounds[2], currentBounds[3]],
        ],
        {
          padding: Math.min(64, canvas.clientWidth / 8, canvas.clientHeight / 8),
          maxZoom: 3.2,
          duration: reducedMotion ? 0 : 450,
        },
      )
    })
  }
  if (isCurrent()) map.stop()
  map.on('moveend', settled)
  map.on('style.load', ready)
  map.on('idle', ready)
  ready()
  return () => {
    disposed = true
    map.off('style.load', ready)
    map.off('idle', ready)
    if (frame !== null) frames.cancel(frame)
    map.off('moveend', settled)
    if (animating && canStop()) map.stop()
  }
}
