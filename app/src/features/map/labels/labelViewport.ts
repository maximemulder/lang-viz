import { LngLat, type Map as MapLibreMap, MercatorCoordinate, type Point } from 'maplibre-gl'
import type { LanguageLabelAnchor } from '../../../data/languageLabels.ts'
import type { LabelBox } from './languageLabelSelection.ts'
import { LABEL_FONT, LABEL_MARGIN, LABEL_SIZE } from './MapLabelLayer.tsx'

export function labelViewport(map: MapLibreMap, context: CanvasRenderingContext2D) {
  const { clientWidth: width, clientHeight: height } = map.getCanvas()
  const globe = map.getProjection().type === 'vertical-perspective'
  const flat = !globe && map.getPitch() === 0
  const bounds = flat ? map.getBounds() : undefined
  const west = bounds?.getWest() ?? -Infinity
  const east = bounds?.getEast() ?? Infinity
  const south = bounds?.getSouth() ?? -Infinity
  const north = bounds?.getNorth() ?? Infinity
  const scale = 512 * 2 ** map.getZoom()
  const points = new Map<LanguageLabelAnchor, Point | null>()
  const widths = new Map<string, number>()
  const halfHeight = LABEL_SIZE / 2 + LABEL_MARGIN
  context.font = `${LABEL_SIZE}px ${LABEL_FONT.join(', ')}`

  return (anchor: LanguageLabelAnchor, name: string, overview: boolean): LabelBox | null => {
    let point = points.get(anchor)
    if (point === undefined) {
      const [lng, lat] = anchor
      const wrapped = bounds ? lng + 360 * Math.round(((west + east) / 2 - lng) / 360) : lng
      if (wrapped < west || wrapped > east || lat < south || lat > north) {
        points.set(anchor, null)
        return null
      }
      point = map.project([lng, lat])
      if (
        point.x < 0 ||
        point.x > width ||
        point.y < 0 ||
        point.y > height ||
        (globe && map.unproject(point).distanceTo(new LngLat(lng, lat)) > 100)
      )
        point = null
      points.set(anchor, point)
    }
    if (!point) return null

    let textWidth = widths.get(name)
    if (textWidth === undefined) {
      textWidth = context.measureText(name).width
      widths.set(name, textWidth)
    }
    const halfWidth = textWidth / 2 + LABEL_MARGIN
    if (
      point.x < halfWidth ||
      point.x > width - halfWidth ||
      point.y < halfHeight ||
      point.y > height - halfHeight
    )
      return null

    // A family name can span several areas. A language name needs room around its anchor.
    const dx = overview ? Math.max(4, textWidth / 10) : halfWidth
    const dy = overview ? 0 : halfHeight
    if (flat) {
      if (Math.hypot(dx, dy) > anchor[2] * scale) return null
    } else {
      const center = MercatorCoordinate.fromLngLat([anchor[0], anchor[1]])
      for (const [x, y] of [
        [point.x - dx, point.y - dy],
        [point.x + dx, point.y - dy],
        [point.x - dx, point.y + dy],
        [point.x + dx, point.y + dy],
      ] as const) {
        const corner = map.unproject([x, y])
        if (globe) {
          const roundTrip = map.project(corner)
          if (Math.hypot(roundTrip.x - x, roundTrip.y - y) > 1) return null
        }
        const projected = MercatorCoordinate.fromLngLat(corner)
        const offset = projected.x - center.x
        if (!(Math.hypot(offset - Math.round(offset), projected.y - center.y) <= anchor[2])) {
          return null
        }
      }
    }
    const { x, y } = point
    const gap = 3
    return {
      x,
      y,
      minX: x - textWidth / 2 - gap,
      minY: y - LABEL_SIZE / 2 - gap,
      maxX: x + textWidth / 2 + gap,
      maxY: y + LABEL_SIZE / 2 + gap,
    }
  }
}
