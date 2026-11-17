import type { FeatureCollection, Geometry } from 'geojson'

type Coordinate = [number, number]

export interface BoundaryFeature {
  readonly featureId: string
  readonly sourceId: string
  readonly sourceAlpha2Code: string | null
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
    index.schemaVersion !== 2 ||
    crosswalk.schemaVersion !== 2 ||
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
      typeof feature.sourceId !== 'string' ||
      !(
        feature.sourceAlpha2Code === null ||
        (typeof feature.sourceAlpha2Code === 'string' &&
          /^[A-Z]{2}$/.test(feature.sourceAlpha2Code))
      ) ||
      typeof feature.sourceName !== 'string' ||
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
    features: features.map((feature) => {
      const territoryCode = featureToCode.get(feature.featureId)
      return {
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [...feature.point] },
        properties: {
          territoryCode: territoryCode ?? null,
          featureId: feature.featureId,
          sourceName: feature.sourceName,
        },
      }
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

/** Validate the pinned GeoJSON and attach reviewed statistical associations. */
export function decodeBoundaryGeometry(value: unknown, index: BoundaryIndex): FeatureCollection {
  if (!record(value) || value.type !== 'FeatureCollection' || !Array.isArray(value.features))
    throw new Error('Invalid boundary GeoJSON.')
  const source = value as unknown as FeatureCollection
  if (source.features.length !== index.features.length)
    throw new Error('Boundary GeoJSON does not match feature index.')
  return {
    type: 'FeatureCollection',
    features: source.features.map((item, position) => {
      const feature = index.features[position]
      if (!feature || item.id !== feature.featureId)
        throw new Error('Boundary feature order mismatch.')
      const territoryCode = index.featureToCode.get(feature.featureId) ?? null
      if (
        !item.geometry ||
        (item.geometry.type !== 'Polygon' && item.geometry.type !== 'MultiPolygon')
      )
        throw new Error('Invalid boundary polygon.')
      const sourceParts =
        item.geometry.type === 'Polygon' ? [item.geometry.coordinates] : item.geometry.coordinates
      const parts = sourceParts.flatMap((rings) =>
        rings.length === 1 && rings[0]
          ? splitAtAntimeridian(rings[0] as Coordinate[]).map((coordinates) => [coordinates])
          : [rings],
      )
      const firstPart = parts[0]
      const geometry: Geometry =
        item.geometry.type === 'Polygon' && parts.length === 1 && firstPart
          ? { type: 'Polygon', coordinates: firstPart }
          : { type: 'MultiPolygon', coordinates: parts }
      return {
        type: 'Feature',
        id: feature.featureId,
        geometry,
        properties: {
          featureId: feature.featureId,
          sourceName: feature.sourceName,
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
  geometryPromise ??= read('geometry.geojson')
    .then((value) => decodeBoundaryGeometry(value, index))
    .catch((error: unknown) => {
      geometryPromise = undefined
      throw error
    })
  return geometryPromise
}
