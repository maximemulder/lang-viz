import type { AtlasManifest } from '../domain/atlas.ts'

export const WORLD_DETAIL_ZOOM = 2

export type LanguageLabelAnchor = readonly [
  longitude: number,
  latitude: number,
  clearance: number,
  lodMask: number,
  minZooms: readonly number[],
]

interface VariantLabelAnchors {
  readonly path: readonly string[]
  /** Preferred component and centered anchors come first, followed by local fallbacks. */
  readonly anchors: readonly LanguageLabelAnchor[]
}

export interface LanguageLabelProfile {
  readonly variants: ReadonlyMap<string, VariantLabelAnchors>
  readonly revealZooms: ReadonlyMap<string, number>
  readonly handoffZooms: ReadonlyMap<string, number>
  readonly overviews: ReadonlyMap<string, readonly OverviewAnchor[]>
}

type OverviewAnchor = readonly [anchor: LanguageLabelAnchor, owners: readonly string[]]

export type GeometryProfile = NonNullable<AtlasManifest['geometryProfiles']>[number]

const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

const number = (value: unknown, low: number, high: number): value is number =>
  typeof value === 'number' && value >= low && value <= high

const isAnchor = (row: unknown, depth: number): row is LanguageLabelAnchor =>
  Array.isArray(row) &&
  row.length === 5 &&
  number(row[0], -180, 180) &&
  number(row[1], -90, 90) &&
  number(row[2], Number.MIN_VALUE, 1) &&
  number(row[3], 1, 511) &&
  Number.isInteger(row[3]) &&
  Array.isArray(row[4]) &&
  row[4].length === depth &&
  row[4].every((zoom) => number(zoom, 0, 64))

export function decodeLanguageLabels(value: unknown, archive: string): LanguageLabelProfile {
  const invalid = () => new Error(`Invalid language labels for ${archive}`)
  if (
    !record(value) ||
    (value.schemaVersion !== 1 && value.schemaVersion !== 2 && value.schemaVersion !== 3) ||
    value.archive !== archive ||
    !record(value.variants) ||
    !record(value.handoffZooms)
  )
    throw invalid()

  const variants = new Map<string, VariantLabelAnchors>()
  const parents = new Set<string>()
  const languoids = new Set<string>()
  for (const [id, row] of Object.entries(value.variants)) {
    if (!record(row)) throw invalid()
    const { path, anchors } = row
    if (
      !Array.isArray(path) ||
      path.length < 1 ||
      path.length > 3 ||
      !path.every((node) => typeof node === 'string') ||
      new Set(path).size !== path.length ||
      !Array.isArray(anchors) ||
      !anchors.length ||
      !anchors.every((anchor) => isAnchor(anchor, path.length))
    )
      throw invalid()
    variants.set(id, { path, anchors })
    for (const node of path.slice(0, -1)) parents.add(node)
    for (const node of path) languoids.add(node)
  }

  const revealZooms = new Map<string, number>()
  if (value.schemaVersion === 3) {
    if (!record(value.revealZooms)) throw invalid()
    for (const [id, zoom] of Object.entries(value.revealZooms)) {
      if (!languoids.delete(id) || !number(zoom, 0, 12)) throw invalid()
      revealZooms.set(id, zoom)
    }
    if (languoids.size) throw invalid()
    for (const { path } of variants.values()) {
      let parentZoom = -1
      for (const id of path) {
        const zoom = revealZooms.get(id) ?? -1
        if (parentZoom < 0 ? zoom !== 0 : zoom < WORLD_DETAIL_ZOOM || zoom <= parentZoom) {
          throw invalid()
        }
        parentZoom = zoom
      }
    }
  }

  const handoffZooms = new Map<string, number>()
  for (const [id, zoom] of Object.entries(value.handoffZooms)) {
    if (!parents.delete(id) || !number(zoom, 0, 12)) throw invalid()
    handoffZooms.set(id, zoom)
  }
  if (parents.size) throw invalid()
  const overviews = new Map<string, readonly OverviewAnchor[]>()
  if (value.schemaVersion >= 2) {
    if (!record(value.overviews)) throw invalid()
    for (const [id, rows] of Object.entries(value.overviews)) {
      if (
        !handoffZooms.has(id) ||
        !Array.isArray(rows) ||
        !rows.length ||
        rows.length > 16 ||
        !rows.every(
          (row): row is OverviewAnchor =>
            Array.isArray(row) &&
            row.length === 2 &&
            isAnchor(row[0], 1) &&
            Array.isArray(row[1]) &&
            row[1].length > 0 &&
            new Set(row[1]).size === row[1].length &&
            row[1].every(
              (owner) =>
                typeof owner === 'string' && (variants.get(owner)?.path.includes(id) ?? true),
            ),
        )
      ) {
        throw invalid()
      }
      overviews.set(id, rows)
    }
  }
  return { variants, revealZooms, handoffZooms, overviews }
}

const requests = new Map<string, Promise<LanguageLabelProfile>>()

export function loadLanguageLabels(profile: GeometryProfile & { labels: string }) {
  const url = `${import.meta.env.BASE_URL}data/${profile.labels}`
  let pending = requests.get(url)
  if (!pending) {
    pending = fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`Language labels unavailable (HTTP ${response.status})`)
        return response.json() as Promise<unknown>
      })
      .then((value) => decodeLanguageLabels(value, profile.archive))
      .catch((error: unknown) => {
        requests.delete(url)
        throw error
      })
    requests.set(url, pending)
  }
  return pending
}
