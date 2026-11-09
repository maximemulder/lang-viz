import type { ColorTopology } from './colors.ts'
import {
  type ColorSample,
  colorDistance,
  type FamilyColorPlane,
  type FamilyColorSpace,
  gamutSample,
} from './familyColors.ts'

type Range = readonly [number, number]
export type ColorBox = readonly [Range, Range, Range]
type Vector = readonly [number, number, number]
export type ColorAxes = readonly [Vector, Vector, Vector]
export interface ColorFrame {
  readonly axes: ColorAxes
  readonly box: ColorBox
}
export interface ColorPosition {
  readonly coordinates: readonly number[]
  readonly box: ColorBox
  readonly path: readonly number[]
}
const center = (box: ColorBox) => box.map(([low, high]) => (low + high) / 2)
const dot = (a: Vector, b: Vector) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/** Subdivide a normalized family region. A viewport supplies only its visible
 * weights; absent branches consume no slots. They still inherit a subdivision
 * inside their parent's box, so the frozen palette covers the whole family.
 * Without weights this is the stable full-tree layout used by default colors.
 */
export const familyLayout = (
  topology: ColorTopology,
  owners: ReadonlyMap<string, string>,
  root: string,
  visible?: ReadonlyMap<string, number>,
  box: ColorBox = [
    [-1, 1],
    [-0.55, 0.55],
    [-0.55, 0.55],
  ],
): ReadonlyMap<string, ColorPosition> => {
  const counts = new Map<string, number>()
  for (const id of [...topology.order].reverse()) {
    if (owners.get(id) !== root) continue
    const children = (topology.childrenById.get(id) ?? []).filter((id) => owners.get(id) === root)
    counts.set(
      id,
      visible
        ? (visible.get(id) ?? 0) +
            children.reduce((sum, child) => sum + (counts.get(child) ?? 0), 0)
        : Math.max(1, topology.mappedLeafCount.get(id) ?? 0),
    )
  }
  const positions = new Map<string, ColorPosition>()
  const stack: { id: string; box: ColorBox; path: readonly number[] }[] = [
    {
      id: root,
      box,
      path: [],
    },
  ]
  while (stack.length) {
    const node = stack.pop()
    if (!node) continue
    positions.set(node.id, {
      coordinates: node.path.length ? center(node.box) : [0, 0, 0],
      box: node.box,
      path: node.path,
    })
    const children = (topology.childrenById.get(node.id) ?? []).filter(
      (id) => owners.get(id) === root,
    )
    if (!children.length) continue
    const active = children.filter((id) => (counts.get(id) ?? 0) > 0)
    const participating = active.length ? active : children
    const slots: { id: string; weight: number; own?: boolean }[] = participating.map((id) => ({
      id,
      weight:
        visible && active.length
          ? Math.max(1e-9, counts.get(id) ?? 0) ** 0.75
          : Math.sqrt(Math.max(1, counts.get(id) || topology.mappedLeafCount.get(id) || 1)),
    }))
    if (visible?.has(node.id) && active.length)
      slots.splice(Math.floor(slots.length / 2), 0, {
        id: node.id,
        weight: Math.max(1e-9, visible.get(node.id) ?? 0) ** 0.75,
        own: true,
      })
    const widths = node.box.map(([low, high]) => high - low)
    const axis = widths.indexOf(Math.max(...widths))
    const [low, high] = node.box[axis] ?? [0, 0]
    const total = slots.reduce((sum, slot) => sum + slot.weight, 0)
    let cursor = low
    slots.forEach((slot, i) => {
      const width = ((high - low) * slot.weight) / total
      const gap = slots.length > 1 ? width * 0.06 : 0
      const box = [...node.box] as [Range, Range, Range]
      box[axis] = [cursor + gap, cursor + width - gap]
      const path = slots.length > 1 ? [...node.path, i] : node.path
      if (slot.own) positions.set(slot.id, { coordinates: center(box), box, path })
      else stack.push({ id: slot.id, box, path })
      cursor += width
    })
    // Hidden siblings reserve no space in the visible layout. Use the stable
    // subdivision of their parent's box to give them coherent fallback colors.
    const hidden = children.filter((id) => !participating.includes(id))
    if (hidden.length) {
      const weights = children.map((id) =>
        Math.sqrt(Math.max(1, topology.mappedLeafCount.get(id) ?? 0)),
      )
      const total = weights.reduce((sum, weight) => sum + weight, 0)
      let cursor = low
      children.forEach((id, i) => {
        const width = ((high - low) * (weights[i] ?? 1)) / total
        if (hidden.includes(id)) {
          const box = [...node.box] as [Range, Range, Range]
          box[axis] = [cursor + width * 0.06, cursor + width * 0.94]
          stack.push({ id, box, path: [...node.path, i] })
        }
        cursor += width
      })
    }
  }
  // The family anchor always represents the family itself, even if both an
  // ancestor aggregate and its descendants contribute displayed geometry.
  const position = positions.get(root)
  if (position) positions.set(root, { ...position, coordinates: [0, 0, 0] })
  return positions
}

/** Fit the hierarchy to the usable directions around an anchor. The broadest
 * splits can use lightness when competing families leave little hue room.
 */
export const familyColorFrame = (
  anchor: ColorSample,
  radius: number,
  planes: readonly FamilyColorPlane[],
): ColorFrame => {
  const points: Vector[] = [[0, 0, 0]]
  if (radius)
    for (const h of [-1, 0, 1])
      for (const l of [-1, 0, 1])
        for (const c of [-1, 0, 1]) {
          if (!h && !l && !c) continue
          const sample = familyShade(anchor, [h, l, c], radius, planes)
          points.push([
            ((sample.l - anchor.l) * 0.65) / radius,
            (sample.a - anchor.a) / radius,
            (sample.b - anchor.b) / radius,
          ])
        }
  const longest = (points: readonly Vector[], fallback: Vector): Vector => {
    let best = fallback
    let distance = 1e-10
    for (let i = 0; i < points.length; i++)
      for (let j = i + 1; j < points.length; j++) {
        const a = points[i]
        const b = points[j]
        if (!a || !b) continue
        const delta: Vector = [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
        const squared = dot(delta, delta)
        if (squared > distance) {
          best = delta
          distance = squared
        }
      }
    const length = Math.hypot(...best)
    const major = [...best].sort((a, b) => Math.abs(b) - Math.abs(a))[0] ?? 1
    const scale = (major < 0 ? -1 : 1) / length
    return [best[0] * scale, best[1] * scale, best[2] * scale]
  }
  const first = longest(points, [1, 0, 0])
  const fallback: Vector = Math.abs(first[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0]
  const residual = (point: Vector): Vector => {
    const projection = dot(point, first)
    return [
      point[0] - projection * first[0],
      point[1] - projection * first[1],
      point[2] - projection * first[2],
    ]
  }
  const second = longest(points.map(residual), residual(fallback))
  const third: Vector = [
    first[1] * second[2] - first[2] * second[1],
    first[2] * second[0] - first[0] * second[2],
    first[0] * second[1] - first[1] * second[0],
  ]
  const axes: ColorAxes = [first, second, third]
  const range = (axis: Vector): Range => {
    const values = points.map((point) => dot(point, axis))
    return [Math.min(...values), Math.max(...values)]
  }
  return { axes, box: [range(first), range(second), range(third)] }
}

// Plane geometry is invariant throughout shade search. Weak keys let completed
// view constraints be collected with their optimizer inputs.
const preparedPlanes = new WeakMap<
  readonly FamilyColorPlane[],
  readonly {
    plane: FamilyColorPlane
    nl: number
    norm: number
  }[]
>()
const preparePlanes = (planes: readonly FamilyColorPlane[]) => {
  let prepared = preparedPlanes.get(planes)
  if (!prepared) {
    prepared = planes.map((plane) => {
      const nl = plane.l / 0.65
      return { plane, nl, norm: nl ** 2 + plane.a ** 2 + plane.b ** 2 }
    })
    preparedPlanes.set(planes, prepared)
  }
  return prepared
}

/** Map hue-like, lightness, and chroma-like offsets into a perceptual ball.
 * Project only the component crossing a separating plane, preserving orthogonal
 * detail. Remeasure gamut-mapped RGB and keep every shade in the family region.
 */
export const familyShade = (
  anchor: ColorSample,
  coordinates: readonly number[],
  radius: number,
  planes: readonly FamilyColorPlane[] = [],
  axes?: ColorAxes,
): ColorSample => {
  if (radius < 0.0005 || coordinates.every((value) => Math.abs(value) < 1e-12)) return anchor
  const [h = 0, l = 0, c = 0] = coordinates
  const length = Math.max(1, Math.hypot(h, l, c))
  const chroma = Math.hypot(anchor.a, anchor.b)
  const cosine = chroma > 0.001 ? anchor.a / chroma : 1
  const sine = chroma > 0.001 ? anchor.b / chroma : 0
  const amount = radius / length
  const delta = axes
    ? [0, 1, 2].map(
        (axis) =>
          coordinates.reduce((sum, value, i) => sum + value * (axes[i]?.[axis] ?? 0), 0) * amount,
      )
    : [l * amount, (c * cosine - h * sine) * amount, (c * sine + h * cosine) * amount]
  let result = gamutSample(
    Math.max(0, Math.min(1, anchor.l + (delta[0] ?? 0) / 0.65)),
    anchor.a + (delta[1] ?? 0),
    anchor.b + (delta[2] ?? 0),
  )
  const prepared = preparePlanes(planes)
  for (let pass = 0; pass < 4; pass++) {
    const distance = colorDistance(anchor, result)
    let dl = (result.l - anchor.l) * 0.65
    let da = result.a - anchor.a
    let db = result.b - anchor.b
    let changed = false
    for (let iteration = 0; iteration < 8; iteration++) {
      let movement = 0
      for (const { plane, nl, norm } of prepared) {
        const excess = dl * nl + da * plane.a + db * plane.b - plane.limit
        if (excess <= 0.00001 * plane.distance || norm < 1e-15) continue
        const amount = excess / norm
        dl -= amount * nl
        da -= amount * plane.a
        db -= amount * plane.b
        movement += excess
        changed = true
      }
      const length = Math.hypot(dl, da, db)
      if (length > radius + 0.0015) {
        const scale = radius / length
        dl *= scale
        da *= scale
        db *= scale
        changed = true
      }
      if (movement < 1e-10) break
    }
    if (!changed && distance <= radius + 0.0015) return result
    result = gamutSample(anchor.l + dl / 0.65, anchor.a + da, anchor.b + db)
    // A final contraction handles RGB rounding and any residual intersection
    // error. Usually the orthogonal projection already satisfies every bound.
    const projectedDistance = colorDistance(anchor, result)
    let scale = projectedDistance > radius + 0.0015 ? radius / projectedDistance : 1
    for (const plane of planes) {
      const projection =
        (result.l - anchor.l) * plane.l +
        (result.a - anchor.a) * plane.a +
        (result.b - anchor.b) * plane.b
      if (projection > plane.limit + 0.0015 * plane.distance)
        scale = Math.min(scale, plane.limit / projection)
    }
    if (scale >= 1) return result
    if (scale < 1e-12) return anchor
    scale *= 0.985
    result = gamutSample(
      anchor.l + (result.l - anchor.l) * scale,
      anchor.a + (result.a - anchor.a) * scale,
      anchor.b + (result.b - anchor.b) * scale,
    )
  }
  const valid =
    colorDistance(anchor, result) <= radius + 0.0015 &&
    planes.every(
      (plane) =>
        (result.l - anchor.l) * plane.l +
          (result.a - anchor.a) * plane.a +
          (result.b - anchor.b) * plane.b <=
        plane.limit + 0.0015 * plane.distance,
    )
  return valid ? result : anchor
}

/** Shared allocation for stable catalog palettes and explicit view palettes.
 * Only evidence changes: full-tree counts or visible weights, and the bounds
 * applicable to each languoid. All paths use the same frame and RGB projection.
 */
export const buildFamilyPalette = (
  topology: ColorTopology,
  owners: ReadonlyMap<string, string>,
  root: string,
  anchor: ColorSample,
  space: FamilyColorSpace,
  weights?: ReadonlyMap<string, number>,
  localPlanes: ReadonlyMap<string, readonly FamilyColorPlane[]> = new Map(),
) => {
  const frame = familyColorFrame(anchor, space.radius, space.planes)
  const positions = familyLayout(topology, owners, root, weights, frame.box)
  const colors = new Map<string, ColorSample>()
  for (const [id, position] of positions)
    colors.set(
      id,
      id === root
        ? anchor
        : familyShade(
            anchor,
            position.coordinates,
            space.radius,
            localPlanes.get(id) ?? space.planes,
            frame.axes,
          ),
    )
  return { positions, axes: frame.axes, colors }
}
