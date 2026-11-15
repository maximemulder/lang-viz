import type { FeatureCollection, Geometry } from 'geojson'

type Coordinate = [number, number]

export interface BoundaryFeature {
  readonly featureId: string
  readonly topologyIndex: number
  readonly sourceNumericId: string | null
  readonly sourceName: string
  readonly point: readonly [number, number]
}

export interface BoundaryAssociation {
  readonly code: string
  readonly status: 'matched' | 'ambiguous' | 'unmatched'
  readonly featureIds: readonly string[]
  readonly viewpointSensitive?: boolean
  readonly note?: string
  readonly reason?: string
}

export interface BoundaryIndex {
  readonly viewId: string
  readonly features: readonly BoundaryFeature[]
  readonly associations: ReadonlyMap<string, BoundaryAssociation>
  readonly featureToCode: ReadonlyMap<string, string>
  readonly points: FeatureCollection
}

const base = () => `${import.meta.env?.BASE_URL ?? '/'}administrative/boundaries/`
const read = async (name: string): Promise<unknown> => {
  const response = await fetch(`${base()}${name}`)
  if (!response.ok) throw new Error(`Boundary ${name} unavailable (HTTP ${response.status}).`)
  const body = await response.text()
  if (body.trimStart().startsWith('<')) throw new Error(`Boundary ${name} is not installed.`)
  return JSON.parse(body) as unknown
}
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function indexBoundaries(indexValue: unknown, crosswalkValue: unknown): BoundaryIndex {
  if (!record(indexValue) || !record(crosswalkValue)) throw new Error('Invalid boundary index.')
  const index = indexValue
  const crosswalk = crosswalkValue
  if (
    index.schemaVersion !== 1 ||
    crosswalk.schemaVersion !== 1 ||
    typeof index.viewId !== 'string' ||
    index.viewId !== crosswalk.viewId ||
    !Array.isArray(index.features) ||
    !Array.isArray(crosswalk.territories)
  )
    throw new Error('Incompatible boundary package.')
  const features = index.features as BoundaryFeature[]
  const featureIds = new Set<string>()
  for (const feature of features) {
    if (
      !record(feature) ||
      typeof feature.featureId !== 'string' ||
      !Number.isInteger(feature.topologyIndex) ||
      !Array.isArray(feature.point) ||
      feature.point.length !== 2 ||
      feature.point.some((value) => typeof value !== 'number' || !Number.isFinite(value)) ||
      featureIds.has(feature.featureId)
    )
      throw new Error('Invalid boundary feature index.')
    featureIds.add(feature.featureId)
  }
  const associations = new Map<string, BoundaryAssociation>()
  const featureToCode = new Map<string, string>()
  for (const item of crosswalk.territories as BoundaryAssociation[]) {
    if (
      !record(item) ||
      typeof item.code !== 'string' ||
      !['matched', 'ambiguous', 'unmatched'].includes(item.status) ||
      !Array.isArray(item.featureIds) ||
      associations.has(item.code)
    )
      throw new Error('Invalid boundary crosswalk.')
    associations.set(item.code, item)
    if (item.status !== 'matched') continue
    for (const id of item.featureIds) {
      if (!featureIds.has(id) || featureToCode.has(id))
        throw new Error('Invalid boundary association.')
      featureToCode.set(id, item.code)
    }
  }
  const points: FeatureCollection = {
    type: 'FeatureCollection',
    features: features.flatMap((feature) => {
      const territoryCode = featureToCode.get(feature.featureId)
      return territoryCode
        ? [
            {
              type: 'Feature' as const,
              geometry: { type: 'Point' as const, coordinates: [...feature.point] },
              properties: { territoryCode, featureId: feature.featureId },
            },
          ]
        : []
    }),
  }
  return { viewId: index.viewId, features, associations, featureToCode, points }
}

let indexPromise: Promise<BoundaryIndex> | undefined
export function loadBoundaryIndex(): Promise<BoundaryIndex> {
  indexPromise ??= Promise.all([read('feature-index.json'), read('crosswalk.json')])
    .then(([index, crosswalk]) => indexBoundaries(index, crosswalk))
    .catch((error: unknown) => {
      indexPromise = undefined
      throw error
    })
  return indexPromise
}

interface Topology {
  readonly type: 'Topology'
  readonly objects: {
    readonly countries: {
      readonly geometries: readonly {
        readonly type: 'Polygon' | 'MultiPolygon'
        readonly arcs: number[][] | number[][][]
      }[]
    }
  }
  readonly arcs: readonly (readonly (readonly [number, number])[])[]
  readonly transform: {
    readonly scale: readonly [number, number]
    readonly translate: readonly [number, number]
  }
}

/** Keep a ring on each side of the date line before MapLibre tiles the GeoJSON. */
function splitAtAntimeridian(coordinates: Coordinate[]): Coordinate[][] {
  const first = coordinates[0]
  if (!first || coordinates.length < 4) return [coordinates]
  if (
    !coordinates.some((point, i) => {
      const previous = coordinates[i - 1]
      return previous && Math.abs(point[0] - previous[0]) > 180
    })
  )
    return [coordinates]

  const unwrapped: Coordinate[] = [first]
  for (const [longitude, latitude] of coordinates.slice(1)) {
    const previous = (unwrapped.at(-1) ?? first)[0]
    const shifted = longitude + 360 * Math.round((previous - longitude) / 360)
    unwrapped.push([shifted, latitude])
  }
  // Polar rings may deliberately close along a meridian. Their winding needs
  // different treatment from a ring that briefly crosses the date line.
  if (Math.abs((unwrapped.at(-1) ?? first)[0] - first[0]) > 1e-6) return [coordinates]

  const clip = (points: Coordinate[], boundary: number, keepEast: boolean): Coordinate[] => {
    if (!points.length) return points
    const inside = ([longitude]: Coordinate) =>
      keepEast ? longitude >= boundary : longitude <= boundary
    const output: Coordinate[] = []
    let previous = points.at(-1)
    if (!previous) return output
    for (const current of points) {
      if (inside(previous) !== inside(current)) {
        const fraction = (boundary - previous[0]) / (current[0] - previous[0])
        output.push([boundary, previous[1] + fraction * (current[1] - previous[1])])
      }
      if (inside(current)) output.push(current)
      previous = current
    }
    return output
  }
  const open = unwrapped.slice(0, -1)
  const west = Math.min(...open.map(([longitude]) => longitude))
  const east = Math.max(...open.map(([longitude]) => longitude))
  const rings: Coordinate[][] = []
  for (
    let world = Math.ceil((west - 180) / 360);
    world <= Math.floor((east + 180) / 360);
    world++
  ) {
    const lower = -180 + 360 * world
    const upper = 180 + 360 * world
    const clipped = clip(clip(open, lower, true), upper, false).map(
      ([longitude, latitude]): Coordinate => [
        Math.max(-180, Math.min(180, longitude - 360 * world)),
        latitude,
      ],
    )
    const distinct = clipped.filter((point, i) => {
      const previous = clipped[i - 1]
      return !previous || point[0] !== previous[0] || point[1] !== previous[1]
    })
    const start = distinct[0]
    const last = distinct.at(-1)
    if (start && last && distinct.length > 1 && start[0] === last[0] && start[1] === last[1])
      distinct.pop()
    if (distinct.length < 3) continue
    const area = distinct.reduce((sum, point, i) => {
      const next = distinct[(i + 1) % distinct.length] ?? point
      return sum + point[0] * next[1] - next[0] * point[1]
    }, 0)
    if (Math.abs(area) < 1e-12) continue
    rings.push([...distinct, distinct[0] ?? first])
  }
  return rings.length ? rings : [coordinates]
}

/** Decode only this pinned countries topology. The reviewed crosswalk supplies all IDs. */
export function decodeBoundaryGeometry(value: unknown, index: BoundaryIndex): FeatureCollection {
  if (
    !record(value) ||
    value.type !== 'Topology' ||
    !record(value.objects) ||
    !record(value.objects.countries) ||
    !Array.isArray(value.objects.countries.geometries) ||
    !Array.isArray(value.arcs) ||
    !record(value.transform)
  )
    throw new Error('Invalid boundary topology.')
  const topology = value as unknown as Topology
  if (topology.objects.countries.geometries.length !== index.features.length)
    throw new Error('Boundary topology does not match feature index.')
  const [sx, sy] = topology.transform.scale
  const [tx, ty] = topology.transform.translate
  const decoded = topology.arcs.map((arc) => {
    let x = 0
    let y = 0
    return arc.map(([dx, dy]): Coordinate => {
      x += dx
      y += dy
      return [x * sx + tx, y * sy + ty]
    })
  })
  const ring = (ids: readonly number[]): Coordinate[] => {
    const result: Coordinate[] = []
    for (const id of ids) {
      const arc = decoded[id >= 0 ? id : ~id]
      if (!arc) throw new Error('Boundary topology has an invalid arc.')
      const segment = id >= 0 ? arc : [...arc].reverse()
      result.push(...(result.length ? segment.slice(1) : segment))
    }
    return result
  }
  return {
    type: 'FeatureCollection',
    features: topology.objects.countries.geometries.map((item, position) => {
      const feature = index.features[position]
      if (!feature || feature.topologyIndex !== position)
        throw new Error('Boundary feature order mismatch.')
      const territoryCode = index.featureToCode.get(feature.featureId) ?? null
      const sourceParts =
        item.type === 'Polygon' ? [item.arcs as number[][]] : (item.arcs as number[][][])
      const parts = sourceParts.flatMap((part) => {
        const rings = part.map(ring)
        return rings.length === 1 && rings[0]
          ? splitAtAntimeridian(rings[0]).map((coordinates) => [coordinates])
          : [rings]
      })
      const firstPart = parts[0]
      const geometry: Geometry =
        item.type === 'Polygon' && parts.length === 1 && firstPart
          ? { type: 'Polygon', coordinates: firstPart }
          : { type: 'MultiPolygon', coordinates: parts }
      return {
        type: 'Feature',
        id: feature.featureId,
        geometry,
        properties: {
          featureId: feature.featureId,
          territoryCode,
          status: territoryCode
            ? index.associations.get(territoryCode)?.viewpointSensitive
              ? 'sensitive'
              : 'matched'
            : 'unassigned',
        },
      }
    }),
  }
}

let geometryPromise: Promise<FeatureCollection> | undefined
export function loadBoundaryGeometry(index: BoundaryIndex): Promise<FeatureCollection> {
  geometryPromise ??= read('geometry.topojson')
    .then((value) => decodeBoundaryGeometry(value, index))
    .catch((error: unknown) => {
      geometryPromise = undefined
      throw error
    })
  return geometryPromise
}
