import initGeos from 'geos-wasm'
import RBush from 'rbush'
import {
  type CoverageInput,
  type CoveragePartition,
  type CoverageRegion,
  type MultiPolygon,
  OverlapBudgetError,
  OverlapGeometryError,
  type Polygon,
} from './geometry.ts'

type Geos = Awaited<ReturnType<typeof initGeos>>

// The package's declarations incorrectly type the runtime enum values as functions.
const POLYGON = 3
const MULTIPOLYGON = 6
const GEOMETRY_COLLECTION = 7

interface NativeRegion {
  readonly pointer: number
  readonly members: readonly string[]
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
}

/** Own every native allocation for one synchronous partition, including failures. */
class GeometryScope {
  private readonly geos: Geos
  private readonly error: () => string
  private readonly geometries = new Set<number>()
  private readonly buffers = new Set<number>()
  private reader = 0
  private writer = 0

  constructor(geos: Geos, error: () => string) {
    this.geos = geos
    this.error = error
  }

  private require(pointer: number): number {
    if (!pointer) throw new OverlapGeometryError(this.error() || 'GEOS geometry operation failed')
    return pointer
  }

  own(pointer: number): number {
    this.require(pointer)
    this.geometries.add(pointer)
    return pointer
  }

  free(pointer: number) {
    if (!this.geometries.delete(pointer)) throw new Error('Unowned GEOS geometry')
    this.geos.GEOSGeom_destroy(pointer)
  }

  allocate(bytes: number): number {
    const pointer = this.require(this.geos.Module._malloc(bytes))
    this.buffers.add(pointer)
    return pointer
  }

  private releaseBuffer(pointer: number) {
    this.buffers.delete(pointer)
    this.geos.Module._free(pointer)
  }

  read(coordinates: MultiPolygon): number {
    // Reject malformed/invalid source geometry rather than silently changing its
    // intended area through MakeValid, ring closure, or precision reduction.
    for (const polygon of coordinates) {
      if (!polygon.length) throw new OverlapGeometryError('Polygon has no exterior ring')
      for (const ring of polygon) {
        const first = ring[0]
        const last = ring.at(-1)
        if (
          ring.length < 4 ||
          !first ||
          !last ||
          first[0] !== last[0] ||
          first[1] !== last[1] ||
          ring.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))
        ) {
          throw new OverlapGeometryError('Polygon contains an invalid coordinate ring')
        }
      }
    }
    this.reader ||= this.require(this.geos.GEOSGeoJSONReader_create())
    const bytes = new TextEncoder().encode(JSON.stringify({ type: 'MultiPolygon', coordinates }))
    const text = this.allocate(bytes.length + 1)
    try {
      this.geos.Module.HEAPU8.set(bytes, text)
      this.geos.Module.HEAPU8[text + bytes.length] = 0
      const geometry = this.own(this.geos.GEOSGeoJSONReader_readGeometry(this.reader, text))
      if (this.geos.GEOSisValid(geometry) !== 1) {
        throw new OverlapGeometryError('Selected language geometry is invalid')
      }
      return geometry
    } finally {
      this.releaseBuffer(text)
    }
  }

  /** Borrowed polygon pointers; their parent must outlive their use. */
  polygons(pointer: number): number[] {
    const empty = this.geos.GEOSisEmpty(pointer)
    if (empty === 1) return []
    if (empty !== 0) throw new OverlapGeometryError('Cannot inspect GEOS geometry')
    const type = this.geos.GEOSGeomTypeId(pointer)
    if (type === POLYGON) return [pointer]
    if (type < 0) throw new OverlapGeometryError('Cannot inspect GEOS geometry type')
    if (type !== MULTIPOLYGON && type !== GEOMETRY_COLLECTION) return []
    const count = this.geos.GEOSGetNumGeometries(pointer)
    if (count < 0) throw new OverlapGeometryError('Cannot inspect GEOS collection')
    const polygons: number[] = []
    for (let i = 0; i < count; i++) {
      polygons.push(...this.polygons(this.require(this.geos.GEOSGetGeometryN(pointer, i))))
    }
    return polygons
  }

  private polygonOnly(pointer: number): number {
    const type = this.geos.GEOSGeomTypeId(pointer)
    if (type === POLYGON || type === MULTIPOLYGON) return pointer
    // Boundary contact can yield points/lines or mixed collections. Keep only
    // area before the next operation, which expects homogeneous inputs.
    const children = this.polygons(pointer).map((p) => this.own(this.geos.GEOSGeom_clone(p)))
    const buffer = this.allocate(Math.max(4, children.length * 4))
    try {
      this.geos.Module.HEAPU32.set(children, buffer / 4)
      const result = this.own(
        this.geos.GEOSGeom_createCollection(MULTIPOLYGON, buffer, children.length),
      )
      // Collection creation consumes its children; only the parent remains owned.
      for (const child of children) this.geometries.delete(child)
      this.free(pointer)
      return result
    } finally {
      this.releaseBuffer(buffer)
    }
  }

  intersection(a: number, b: number): number {
    return this.polygonOnly(this.own(this.geos.GEOSIntersection(a, b)))
  }

  difference(a: number, b: number): number {
    return this.polygonOnly(this.own(this.geos.GEOSDifference(a, b)))
  }

  union(a: number, b: number): number {
    return this.polygonOnly(this.own(this.geos.GEOSUnion(a, b)))
  }

  exportPolygon(pointer: number): Polygon {
    this.writer ||= this.require(this.geos.GEOSGeoJSONWriter_create())
    const text = this.require(this.geos.GEOSGeoJSONWriter_writeGeometry(this.writer, pointer, -1))
    try {
      const json: { type: string; coordinates: Polygon } = JSON.parse(
        this.geos.Module.UTF8ToString(text),
      )
      if (json.type !== 'Polygon') throw new OverlapGeometryError('Expected a polygonal region')
      return json.coordinates
    } finally {
      this.geos.GEOSFree(text)
    }
  }

  dispose() {
    for (const pointer of this.geometries) this.geos.GEOSGeom_destroy(pointer)
    for (const pointer of this.buffers) this.geos.Module._free(pointer)
    if (this.reader) this.geos.GEOSGeoJSONReader_destroy(this.reader)
    if (this.writer) this.geos.GEOSGeoJSONWriter_destroy(this.writer)
    this.geometries.clear()
    this.buffers.clear()
  }
}

export const createGeosPartition = async (): Promise<CoveragePartition> => {
  let lastError = ''
  const geos = await initGeos({
    // Let native calls unwind and release their C++ temporaries before checking
    // NULL/status in JS. Throwing inside a C error callback bypasses that cleanup.
    errorHandler: (message) => {
      lastError = message
    },
    noticeHandler: () => {},
  })
  return (inputs, extent, options = {}) => {
    lastError = ''
    const scope = new GeometryScope(geos, () => lastError)
    const index = new RBush<NativeRegion>()
    const maxRegions = options.maxRegions ?? 12_000
    const deadline = options.deadline ?? Number.POSITIVE_INFINITY
    let regionCount = 0
    const budget = () => {
      if (regionCount > maxRegions || performance.now() > deadline) throw new OverlapBudgetError()
    }
    try {
      if (!(extent > 0 && Number.isFinite(extent))) {
        throw new OverlapGeometryError('Invalid tile extent')
      }
      const extentPointer = scope.allocate(32)
      const bounds = (pointer: number) => {
        if (
          !geos.GEOSGeom_getExtent(
            pointer,
            extentPointer,
            extentPointer + 8,
            extentPointer + 16,
            extentPointer + 24,
          )
        ) {
          throw new OverlapGeometryError('Cannot read GEOS bounds')
        }
        return {
          minX: geos.Module.getValue(extentPointer, 'double'),
          minY: geos.Module.getValue(extentPointer + 8, 'double'),
          maxX: geos.Module.getValue(extentPointer + 16, 'double'),
          maxY: geos.Module.getValue(extentPointer + 24, 'double'),
        }
      }
      const insert = (pointer: number, members: readonly string[]) => {
        for (const polygon of scope.polygons(pointer)) {
          const clone = scope.own(geos.GEOSGeom_clone(polygon))
          index.insert({ pointer: clone, members, ...bounds(clone) })
          regionCount++
          budget()
        }
      }
      const tile = scope.read([
        [
          [
            [0, 0],
            [extent, 0],
            [extent, extent],
            [0, extent],
            [0, 0],
          ],
        ],
      ])
      const grouped = new Map<string, CoverageInput['geometry'][]>()
      for (const input of inputs) {
        const fragments = grouped.get(input.id) ?? []
        fragments.push(input.geometry)
        grouped.set(input.id, fragments)
      }
      for (const [id, fragments] of [...grouped].sort(([a], [b]) => a.localeCompare(b))) {
        budget()
        const first = fragments[0]
        if (!first) continue
        let merged = scope.read(first)
        for (const fragment of fragments.slice(1)) {
          budget()
          const next = scope.read(fragment)
          const union = scope.union(merged, next)
          scope.free(merged)
          scope.free(next)
          merged = union
        }
        const clipped = scope.intersection(merged, tile)
        scope.free(merged)
        for (const polygon of scope.polygons(clipped)) {
          budget()
          let remaining = scope.own(geos.GEOSGeom_clone(polygon))
          const candidates = index.search(bounds(polygon))
          for (const region of candidates) {
            budget()
            const shared = scope.intersection(region.pointer, polygon)
            if (scope.polygons(shared).length === 0) {
              scope.free(shared)
              continue
            }
            const previousOnly = scope.difference(region.pointer, polygon)
            const nextRemaining = scope.difference(remaining, region.pointer)
            index.remove(region)
            regionCount--
            scope.free(region.pointer)
            insert(previousOnly, region.members)
            insert(shared, [...region.members, id])
            scope.free(previousOnly)
            scope.free(shared)
            scope.free(remaining)
            remaining = nextRemaining
          }
          insert(remaining, [id])
          scope.free(remaining)
        }
        scope.free(clipped)
      }
      const result: CoverageRegion[] = []
      for (const { pointer, members, ...bbox } of index.all()) {
        budget()
        if (!options.includeSingles && members.length < 2) continue
        result.push({ geometry: [scope.exportPolygon(pointer)], members, ...bbox })
      }
      budget()
      return result
    } finally {
      // No native pointer escapes into caches or worker messages.
      scope.dispose()
    }
  }
}

/** Independent feature clipping for fallback tiles; never partitions language overlaps. */
export const createFallbackClipper = async () => {
  let lastError = ''
  const geos = await initGeos({
    errorHandler: (message) => {
      lastError = message
    },
    noticeHandler: () => {},
  })
  return (
    inputs: readonly MultiPolygon[],
    extent: number,
    rectangles: readonly (readonly [number, number, number, number])[],
  ) => {
    lastError = ''
    const scope = new GeometryScope(geos, () => lastError)
    const box = (left: number, top: number, right: number, bottom: number): MultiPolygon => [
      [
        [
          [left, top],
          [right, top],
          [right, bottom],
          [left, bottom],
          [left, top],
        ],
      ],
    ]
    try {
      let uncovered = scope.read(box(0, 0, extent, extent))
      for (const [left, top, right, bottom] of rectangles) {
        const covered = scope.read(box(left, top, right, bottom))
        const next = scope.difference(uncovered, covered)
        scope.free(uncovered)
        scope.free(covered)
        uncovered = next
      }
      return inputs.map((input): MultiPolygon => {
        const original = scope.read(input)
        const clipped = scope.intersection(original, uncovered)
        const polygons = scope.polygons(clipped).map((pointer) => scope.exportPolygon(pointer))
        scope.free(original)
        scope.free(clipped)
        return polygons
      })
    } finally {
      scope.dispose()
    }
  }
}
