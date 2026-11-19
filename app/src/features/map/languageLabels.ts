export interface LanguageLabel {
  readonly id: string
  readonly name: string
  readonly longitude: number
  readonly latitude: number
  readonly area: number
  readonly familyId?: string | null
  readonly familyName?: string | null
  readonly kind?: 'language' | 'family'
}

/** Ranking describes mapped extent, never speaker population or importance. */
export function labelMinimumZoom(area: number) {
  return Math.max(
    0.8,
    Math.min(7, Math.log2((75 * 360) / (512 * Math.sqrt(Math.max(area, 0.001))))),
  )
}

// Catalog filing categories are not genealogical family labels.
const CATALOG_CATEGORIES = new Set([
  'Bookkeeping',
  'Sign Language',
  'Unclassifiable',
  'Unattested',
  'Artificial Language',
  'Mixed Language',
  'Speech Register',
])

/** Use the supplied classification verbatim. An anchor is an actual member's
 * catalog location, never an invented family territory or an inferred homeland. */
export function familyLabels(labels: readonly LanguageLabel[]): LanguageLabel[] {
  const families = new Map<string, LanguageLabel[]>()
  for (const label of labels) {
    if (!label.familyId || !label.familyName || CATALOG_CATEGORIES.has(label.familyName)) continue
    const members = families.get(label.familyId) ?? []
    members.push(label)
    families.set(label.familyId, members)
  }
  return [...families].flatMap(([id, members]) => {
    if (members.length < 2) return []
    const latitude = members.reduce((sum, member) => sum + member.latitude, 0) / members.length
    const sine = members.reduce(
      (sum, member) => sum + Math.sin((member.longitude * Math.PI) / 180),
      0,
    )
    const cosine = members.reduce(
      (sum, member) => sum + Math.cos((member.longitude * Math.PI) / 180),
      0,
    )
    const longitude = (Math.atan2(sine, cosine) * 180) / Math.PI
    const distance = (member: LanguageLabel) => {
      const dx = ((member.longitude - longitude + 540) % 360) - 180
      return (dx * Math.cos((latitude * Math.PI) / 180)) ** 2 + (member.latitude - latitude) ** 2
    }
    const anchor = members.reduce((best, member) =>
      distance(member) < distance(best) ? member : best,
    )
    // Offer several real member locations so a collision does not hide a whole
    // family. The screen selector still displays at most one label per family.
    const anchors = [anchor]
    const separation = (a: LanguageLabel, b: LanguageLabel) => {
      const dx = ((a.longitude - b.longitude + 540) % 360) - 180
      return dx * dx + (a.latitude - b.latitude) ** 2
    }
    for (let i = 1; i < 6; i++) {
      const next = members.reduce((best, member) => {
        const nearest = Math.min(...anchors.map((a) => separation(a, member)))
        const bestNearest = Math.min(...anchors.map((a) => separation(a, best)))
        return nearest > bestNearest ? member : best
      })
      if (Math.min(...anchors.map((a) => separation(a, next))) < 25) break
      anchors.push(next)
    }
    return anchors.map((member) => ({
      id,
      name: member.familyName ?? '',
      kind: 'family' as const,
      longitude: member.longitude,
      latitude: member.latitude,
      area: members.reduce((sum, member) => sum + member.area, 0),
    }))
  })
}

/** Screen-space spacing reveals more names as the viewport opens up, without a
 * fixed four-label quota that leaves whole regions looking empty. */
export function visibleLanguageLabels(
  labels: readonly LanguageLabel[],
  zoom: number,
  width: number,
  height: number,
  project: (label: LanguageLabel) => { x: number; y: number },
) {
  const selected: { label: LanguageLabel; x: number; y: number }[] = []
  const ranked = [...labels].sort((a, b) => b.area - a.area || a.id.localeCompare(b.id))
  const labelWidth = (label: LanguageLabel) =>
    Math.max(
      label.kind === 'family' ? 125 : 85,
      Math.min(label.kind === 'family' ? 230 : 190, label.name.length * 6.5 + 24),
    )
  const add = (label: LanguageLabel) => {
    const { x, y } = project(label)
    if (x < 35 || x > width - 35 || y < 30 || y > height - 30) return
    if (
      selected.some(
        (other) =>
          other.label.id === label.id ||
          (Math.abs(x - other.x) < (labelWidth(label) + labelWidth(other.label)) / 2 &&
            Math.abs(y - other.y) < (label.kind === 'family' ? 58 : 52)),
      )
    )
      return
    selected.push({ label, x, y })
  }
  for (const label of ranked) {
    if (label.kind !== 'family' && labelMinimumZoom(label.area) > zoom) continue
    add(label)
    if (selected.length >= 40) break
  }
  const regionalTarget = Math.max(3, Math.min(24, Math.ceil((width * height) / 70000)))
  if (zoom >= 2.6 && selected.length < regionalTarget) {
    for (const label of ranked) {
      add(label)
      if (selected.length >= regionalTarget) break
    }
  }
  return selected.map(({ label }) => label)
}
