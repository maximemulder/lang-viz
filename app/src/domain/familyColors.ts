import { clampChroma, converter, formatHex } from 'culori'

const toLab = converter('oklab')

export interface ColorSample {
  readonly hex: string
  readonly l: number
  readonly a: number
  readonly b: number
}

// RGB rounding revisits a small set of colors many times during shade search.
// Bound retention across view changes; samples are immutable throughout the app.
const sampleCache = new Map<string, ColorSample>()
export const colorSample = (hex: string): ColorSample => {
  const cached = sampleCache.get(hex)
  if (cached) return cached
  const lab = toLab(hex)
  if (!lab) throw new Error(`Invalid palette color: ${hex}`)
  const sample = { hex, l: lab.l, a: lab.a, b: lab.b }
  if (sampleCache.size >= 8192) sampleCache.clear()
  sampleCache.set(hex, sample)
  return sample
}

export const colorDistance = (a: ColorSample, b: ColorSample) =>
  Math.sqrt(((a.l - b.l) * 0.65) ** 2 + (a.a - b.a) ** 2 + (a.b - b.b) ** 2)

// Family identity relies more on chromatic differences than shade differences.
const identityDistance = (a: ColorSample, b: ColorSample) =>
  Math.sqrt(((a.l - b.l) * 0.45) ** 2 + (a.a - b.a) ** 2 + (a.b - b.b) ** 2)

export const gamutSample = (l: number, a: number, b: number): ColorSample =>
  colorSample(formatHex(clampChroma({ mode: 'oklab', l, a, b }, 'oklch')))

/** The original 24 anchors define the preferred style. */
const preferredFamilyAnchors: readonly ColorSample[] = Array.from({ length: 24 }, (_, i) =>
  formatHex(
    clampChroma(
      { mode: 'oklch', l: i < 12 ? 0.61 : 0.73, c: 0.16, h: (i % 12) * 30 + 15 },
      'oklch',
    ),
  ),
).map(colorSample)

/** Keep the original moderate-chroma anchors alongside the expanded gamut.
 * These are candidates, not fixed category identities.
 * Deduplicate after gamut mapping, preserving every previously available color.
 */
const anchorCandidates = (chromas: readonly number[]): readonly ColorSample[] =>
  [
    ...new Set([
      ...[0.54, 0.64, 0.74, 0.82].flatMap((l) =>
        chromas.flatMap((c) =>
          Array.from({ length: 48 }, (_, h) =>
            formatHex(clampChroma({ mode: 'oklch', l, c, h: h * 7.5 }, 'oklch')),
          ),
        ),
      ),
      ...preferredFamilyAnchors.map(({ hex }) => hex),
    ]),
  ].map(colorSample)

// Defaults retain their established identities; explicit view optimization can
// also choose subdued anchors without a preference for particular swatches.
export const familyCandidates = anchorCandidates([0.12, 0.18, 0.24])
const subduedFamilyCandidates = anchorCandidates([0.06, 0.09, 0.12, 0.18, 0.24])

export const colorHash = (id: string) => {
  let hash = 0
  for (const character of id) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) | 0
  return hash >>> 0
}

export interface WeightedColor {
  readonly color: ColorSample
  readonly weight: number
}

export interface ColorFamily {
  readonly id: string
  readonly reference: ColorSample
  readonly locked: boolean
  /** Fraction of displayed area using automatic colors, versus exact overrides. */
  readonly automatic: number
  readonly fixed: readonly WeightedColor[]
  /** Displayed area, relative to the most prominent displayed family. */
  readonly prominence: number
  readonly prominent: boolean
  /** Fraction of the fixed catalog grid or captured screen grid occupied. */
  readonly coverage: number
  /** Need for internal detail, independently of the family's prominence. */
  readonly demand: number
}

export interface FamilyLink {
  readonly a: number
  readonly b: number
  readonly local: number
  readonly weight: number
  readonly priority: number
  readonly target: number
  readonly clearance: number
}

/** A halfspace in the family-identity metric, relative to its own anchor. */
export interface FamilyColorPlane {
  readonly l: number
  readonly a: number
  readonly b: number
  readonly limit: number
  readonly distance: number
  /** Competing family, absent for the family's own coherence constraints. */
  readonly family?: number
  readonly global?: boolean
}
export interface FamilyColorSpace {
  readonly radius: number
  readonly planes: readonly FamilyColorPlane[]
}

/** A family pair contributes once, independently of its number of descendants.
 * Normalize incident pressure so dense classifications cannot buy their way out
 * of a conspicuous conflict by contributing thousands of small improvements.
 */
export const buildFamilyLinks = (
  families: readonly ColorFamily[],
  proximity: (a: number, b: number) => number,
): readonly FamilyLink[] => {
  const degrees = families.map(() => 0)
  const links: FamilyLink[] = []
  const prominentFamilies = new Set(families.map((_, i) => i).filter((i) => families[i]?.prominent))
  families.forEach((a, i) => {
    for (let j = i + 1; j < families.length; j++) {
      const b = families[j]
      if (!b) continue
      const local = proximity(i, j)
      if (local < 0.025 && !prominentFamilies.has(i) && !prominentFamilies.has(j)) continue
      const prominent = Math.sqrt(a.prominence * b.prominence)
      const weight = local
      const priority = Math.max(
        local * (0.25 + 0.75 * Math.sqrt(Math.max(a.prominence, b.prominence))),
        0.8 * prominent,
      )
      const target = priority > 0.2 ? 0.24 : 0.2
      links.push({ a: i, b: j, local, weight, priority, target, clearance: target })
      degrees[i] = (degrees[i] ?? 0) + weight
      degrees[j] = (degrees[j] ?? 0) + weight
    }
  })
  const requested = families.map((family, i) =>
    family.automatic
      ? (Math.min(0.1, 0.18 / Math.sqrt(1 + (degrees[i] ?? 0) + 0.1 * (families.length - 1))) *
          family.demand) /
        (family.demand + 1)
      : 0,
  )
  return links.map((link) => ({
    ...link,
    clearance: link.target + (requested[link.a] ?? 0) + (requested[link.b] ?? 0),
    weight:
      link.weight * (1 / (degrees[link.a] || 1) + 1 / (degrees[link.b] || 1)) +
      (prominentFamilies.has(link.a) && prominentFamilies.has(link.b)
        ? (2 *
            (0.5 +
              0.5 *
                Math.sqrt(
                  (families[link.a]?.prominence ?? 0) * (families[link.b]?.prominence ?? 0),
                ))) /
          Math.max(1, prominentFamilies.size - 1)
        : 0),
  }))
}

const risk = (distance: number, target: number) => {
  const shortfall = Math.max(0, 1 - distance / target)
  // A strong tail penalty protects the worst ambiguities alongside the average.
  const squared = shortfall * shortfall
  return squared + 4 * squared * squared * squared
}

const hueRisk = (a: ColorSample, b: ColorSample) => {
  const chroma = Math.hypot(a.a, a.b) * Math.hypot(b.a, b.b)
  const hue =
    chroma > 0.001
      ? 0.17 * Math.sqrt(Math.max(0, 2 - (2 * (a.a * b.a + a.b * b.b)) / chroma))
      : 0.17
  return 0.4 * risk(hue, 0.17)
}

/** Every preferred anchor has zero cost; nearby shades cost little, and more
 * extreme colors remain available when their separation is worth the cost.
 * The reference palette expresses editorial taste, not a universal beauty model.
 */
const anchorPreferenceCost = (sample: ColorSample) =>
  (Math.min(...preferredFamilyAnchors.map((color) => colorDistance(sample, color))) / 0.08) ** 2

/** Deterministic multi-start search with pair swaps. Its objective includes both
 * normalized pair losses and the worst important family conflict. Internal shade
 * differences never compete with family identity in this search.
 */
export const assignFamilyAnchors = (
  families: readonly ColorFamily[],
  links: readonly FamilyLink[],
  prioritizeProminent = true,
  restrainChroma = false,
): readonly ColorSample[] => {
  if (!families.length) return []
  const prominent = families.map((_, i) => i).filter((i) => families[i]?.prominent)
  if (prioritizeProminent && prominent.length > 0 && prominent.length < families.length) {
    const subset = prominent.map((i) => families[i] as ColorFamily)
    const proximity = new Map(links.map((link) => [`${link.a},${link.b}`, link.local]))
    const subsetLinks = buildFamilyLinks(
      subset,
      (a, b) => proximity.get(`${prominent[a]},${prominent[b]}`) ?? 0,
    )
    const initial = assignFamilyAnchors(subset, subsetLinks, false, restrainChroma)
    const anchors = new Map(prominent.map((i, j) => [i, initial[j] as ColorSample]))
    return assignFamilyAnchors(
      families.map((family, i) => {
        const reference = anchors.get(i)
        return reference ? { ...family, reference, locked: true } : family
      }),
      links,
      false,
      restrainChroma,
    )
  }
  const candidates = restrainChroma ? subduedFamilyCandidates : familyCandidates
  const samples = [...candidates]
  const indices = new Map(samples.map((sample, i) => [sample.hex, i]))
  const indexOf = (sample: ColorSample) => {
    let index = indices.get(sample.hex)
    if (index === undefined) {
      index = samples.length
      indices.set(sample.hex, index)
      samples.push(sample)
    }
    return index
  }
  const references = families.map(({ reference }) => indexOf(reference))
  // Exact overrides are evaluated on demand: thousands of custom colors must
  // not expand the quadratic candidate-risk tables.
  const size = samples.length
  const targets = [0.2, 0.24, 0.28, 0.32, 0.36, 0.4, 0.44]
  const tables = targets.map(() => new Float32Array(size * size))
  const tableIndex = (link: FamilyLink) =>
    Math.max(0, Math.min(targets.length - 1, Math.round((link.clearance - 0.2) / 0.04)))
  const tableFor = (link: FamilyLink) => tables[tableIndex(link)] as Float32Array
  samples.forEach((a, i) => {
    for (let j = 0; j <= i; j++) {
      const b = samples[j]
      if (!b) continue
      const d = identityDistance(a, b)
      const category = hueRisk(a, b)
      tables.forEach((table, k) => {
        table[i * size + j] = table[j * size + i] = risk(d, targets[k] ?? 0.24) + category
      })
    }
  })
  const incident = families.map(() => [] as number[])
  links.forEach(({ a, b }, i) => {
    incident[a]?.push(i)
    incident[b]?.push(i)
  })
  const pairScore = (link: FamilyLink, ca: number, cb: number) => {
    const table = tableFor(link)
    const a = families[link.a]
    const b = families[link.b]
    if (!a || !b) return 0
    if (!a.fixed.length && !b.fixed.length) return table[ca * size + cb] ?? 0
    const fixedScore = (a: ColorSample, b: ColorSample) => {
      const i = indices.get(a.hex)
      const j = indices.get(b.hex)
      return i !== undefined && j !== undefined
        ? (table[i * size + j] ?? 0)
        : risk(identityDistance(a, b), targets[tableIndex(link)] ?? 0.24) + hueRisk(a, b)
    }
    let value = a.automatic * b.automatic * (table[ca * size + cb] ?? 0)
    let worst = 0
    for (const f of a.fixed) {
      const weight = f.weight * b.automatic
      const score = fixedScore(f.color, samples[cb] as ColorSample)
      value += weight * score
      worst = Math.max(worst, Math.min(1, weight * 8) * score)
      for (const g of b.fixed) {
        const weight = f.weight * g.weight
        const score = fixedScore(f.color, g.color)
        value += weight * score
        worst = Math.max(worst, Math.min(1, weight * 8) * score)
      }
    }
    for (const f of b.fixed) {
      const weight = f.weight * a.automatic
      const score = fixedScore(samples[ca] as ColorSample, f.color)
      value += weight * score
      worst = Math.max(worst, Math.min(1, weight * 8) * score)
    }
    return value + 0.35 * worst
  }
  const preferences = samples.map(anchorPreferenceCost)
  const unaryCost = (i: number, candidate: number) => {
    const family = families[i]
    const before = family?.reference
    const after = samples[candidate]
    if (!family || !before || !after) return 0
    // Prefer calmer anchors most strongly on large footprints. Reuse the
    // existing evidence, keeping defaults independent of camera/selection.
    const areaWeight = 0.1 + 0.9 * family.prominence ** 2
    return (
      0.018 * (colorDistance(before, after) / 0.3) ** 2 +
      (restrainChroma
        ? 1.2 *
          areaWeight *
          (Math.max(0, Math.hypot(after.a, after.b) - (0.18 - 0.08 * family.prominence)) / 0.08) **
            2
        : 0.3 * areaWeight * (preferences[candidate] ?? 0))
    )
  }
  const unaryCosts = families.map((_, i) => Float64Array.from(samples, (_, j) => unaryCost(i, j)))
  const choices = families.map((family, i) => {
    const reference = references[i] ?? 0
    if (family.locked || !family.automatic) return [reference]
    const offset = colorHash(family.id) % candidates.length
    return [
      ...new Set([
        reference,
        ...Array.from({ length: candidates.length }, (_, j) => (j + offset) % candidates.length),
      ]),
    ]
  })
  const ordered = families
    .map((_, i) => i)
    .sort((a, b) => {
      const pressure = (i: number) =>
        (incident[i] ?? []).reduce((sum, j) => sum + (links[j]?.priority ?? 0), 0) +
        (families[i]?.prominence ?? 0)
      return (
        pressure(b) - pressure(a) || (families[a]?.id ?? '').localeCompare(families[b]?.id ?? '')
      )
    })
  const energy = (assignment: readonly number[]) => {
    let total = assignment.reduce((sum, candidate, i) => sum + unaryCost(i, candidate), 0)
    let worst = 0
    for (const link of links) {
      const score = pairScore(link, assignment[link.a] ?? 0, assignment[link.b] ?? 0)
      total += link.weight * score
      worst = Math.max(worst, link.priority * score)
    }
    return total + 0.6 * worst
  }
  const candidateCosts = (
    i: number,
    assignment: readonly number[],
    outsideWorst: number,
    assigned?: ReadonlySet<number>,
  ) => {
    const unary = unaryCosts[i]
    const costs = unary ? new Float64Array(unary) : new Float64Array(size)
    const worst = new Float64Array(size).fill(outsideWorst)
    for (const j of incident[i] ?? []) {
      const link = links[j]
      if (!link) continue
      const other = link.a === i ? link.b : link.a
      if (assigned && !assigned.has(other)) continue
      const otherColor = assignment[other] ?? 0
      if (!families[i]?.fixed.length && !families[other]?.fixed.length) {
        const table = tableFor(link)
        const offset = otherColor * size
        for (const candidate of choices[i] ?? []) {
          const score = table[offset + candidate] ?? 0
          costs[candidate] = (costs[candidate] ?? 0) + link.weight * score
          worst[candidate] = Math.max(worst[candidate] ?? 0, link.priority * score)
        }
      } else {
        for (const candidate of choices[i] ?? []) {
          const score = pairScore(
            link,
            link.a === i ? candidate : otherColor,
            link.b === i ? candidate : otherColor,
          )
          costs[candidate] = (costs[candidate] ?? 0) + link.weight * score
          worst[candidate] = Math.max(worst[candidate] ?? 0, link.priority * score)
        }
      }
    }
    for (const candidate of choices[i] ?? [])
      costs[candidate] = (costs[candidate] ?? 0) + 0.6 * (worst[candidate] ?? 0)
    return costs
  }
  const descend = (assignment: number[], passes: number) => {
    const scores = links.map((link) =>
      pairScore(link, assignment[link.a] ?? 0, assignment[link.b] ?? 0),
    )
    for (let pass = 0; pass < passes; pass++) {
      let changed = false
      for (const i of ordered) {
        if ((choices[i]?.length ?? 0) < 2) continue
        let outsideWorst = 0
        links.forEach((link, j) => {
          if (link.a !== i && link.b !== i)
            outsideWorst = Math.max(outsideWorst, link.priority * (scores[j] ?? 0))
        })
        const costs = candidateCosts(i, assignment, outsideWorst)
        let best = assignment[i] ?? 0
        let bestCost = costs[best] ?? 0
        for (const candidate of choices[i] ?? []) {
          const value = costs[candidate] ?? 0
          if (value < bestCost - 1e-9) {
            bestCost = value
            best = candidate
          }
        }
        if (assignment[i] === best) continue
        changed = true
        assignment[i] = best
        for (const j of incident[i] ?? []) {
          const link = links[j]
          if (link) scores[j] = pairScore(link, assignment[link.a] ?? 0, assignment[link.b] ?? 0)
        }
      }
      if (!changed) break
    }
  }
  let best = [...references]
  descend(best, 5)
  // Starting from already-used colors can trap a greedy search. Construct a
  // second assignment with only previously assigned neighbors contributing.
  const greedy = [...references]
  const assigned = new Set<number>()
  for (const i of ordered) {
    const costs = candidateCosts(i, greedy, 0, assigned)
    let bestCost = Number.POSITIVE_INFINITY
    for (const candidate of choices[i] ?? []) {
      const cost = costs[candidate] ?? 0
      if (cost < bestCost - 1e-9) {
        bestCost = cost
        greedy[i] = candidate
      }
    }
    assigned.add(i)
  }
  descend(greedy, 5)
  if (energy(greedy) < energy(best) - 1e-9) best = greedy
  const difficult = [...links]
    .sort(
      (a, b) =>
        b.priority * pairScore(b, best[b.a] ?? 0, best[b.b] ?? 0) -
        a.priority * pairScore(a, best[a.a] ?? 0, best[a.b] ?? 0),
    )
    .slice(0, 48)
  for (const { a, b } of difficult) {
    if (
      families[a]?.locked ||
      families[b]?.locked ||
      !families[a]?.automatic ||
      !families[b]?.automatic
    )
      continue
    if (!choices[a]?.includes(best[b] ?? 0) || !choices[b]?.includes(best[a] ?? 0)) continue
    const alternative = [...best]
    alternative[a] = best[b] ?? 0
    alternative[b] = best[a] ?? 0
    if (energy(alternative) < energy(best) - 1e-9) best = alternative
  }
  descend(best, 2)
  return best.map((index) => samples[index] ?? (candidates[0] as ColorSample))
}

/** Bound hue and chroma for family identity, then share remaining anchor margin.
 * Prominent families have a common separation bound. Tighter local planes carry
 * their neighbor index so callers can apply them only at geographic contacts.
 * Crowding consumes expansion room without collapsing every shade dimension.
 */
export const familyColorSpaces = (
  families: readonly ColorFamily[],
  links: readonly FamilyLink[],
  anchors: readonly ColorSample[],
  maximum = 0.22,
): readonly FamilyColorSpace[] => {
  const minimum = Math.min(0.06, maximum)
  const loads = families.map(() => 0)
  const footprintLoads = families.map(({ coverage }) => Math.min(1, coverage / 0.01))
  for (const link of links) {
    const pressure = Math.max(
      link.local,
      families[link.a]?.prominent && families[link.b]?.prominent ? 0.25 : 0,
    )
    loads[link.a] = (loads[link.a] ?? 0) + pressure * (footprintLoads[link.b] ?? 0)
    loads[link.b] = (loads[link.b] ?? 0) + pressure * (footprintLoads[link.a] ?? 0)
  }
  const spaces = families.map(({ demand }, i) => {
    const planes: FamilyColorPlane[] = []
    const anchor = anchors[i]
    const chroma = anchor ? Math.hypot(anchor.a, anchor.b) : 0
    if (anchor && chroma > 0.02) {
      const a = anchor.a / chroma
      const b = anchor.b / chroma
      const tangent = Math.tan(Math.PI / 9)
      for (const sign of [-1, 1])
        planes.push({
          l: 0,
          a: -sign * b - tangent * a,
          b: sign * a - tangent * b,
          limit: tangent * chroma,
          distance: 1,
        })
      planes.push({ l: 0, a: -a, b: -b, limit: 0.45 * chroma, distance: 1 })
    }
    return {
      radius: demand ? minimum + (maximum - minimum) / (1 + 0.4 * (loads[i] ?? 0)) : 0,
      planes,
    }
  })
  for (const link of links) {
    if (
      link.local < 0.15 &&
      link.priority < 0.4 &&
      !(families[link.a]?.prominent && families[link.b]?.prominent)
    )
      continue
    for (const [i, j] of [
      [link.a, link.b],
      [link.b, link.a],
    ] as const) {
      const family = families[i]
      const other = families[j]
      const anchor = anchors[i]
      const otherAnchor = anchors[j]
      const space = spaces[i]
      if (!family?.demand || !other || !anchor || !otherAnchor || !space) continue
      const constrain = (sample: ColorSample, demand: number, global: boolean) => {
        const distance = identityDistance(anchor, sample)
        if (global && distance < 0.015) space.radius = Math.min(space.radius, distance / 2 + 0.001)
        const share = family.demand / (family.demand + demand)
        const plane = {
          l: (sample.l - anchor.l) * 0.45 ** 2,
          a: sample.a - anchor.a,
          b: sample.b - anchor.b,
          limit: share * (distance - Math.min(link.target, distance * 0.85)) * distance,
          distance,
          family: j,
        }
        space.planes.push(plane)
        if (global)
          space.planes.push({
            ...plane,
            global: true,
            limit: share * (distance - Math.min(0.2, distance * 0.8)) * distance,
          })
      }
      if (other.automatic) constrain(otherAnchor, other.demand, family.prominent && other.prominent)
      for (const fixed of other.fixed)
        if (fixed.weight >= 0.025) constrain(fixed.color, 0, family.prominent && other.prominent)
    }
  }
  return spaces
}
