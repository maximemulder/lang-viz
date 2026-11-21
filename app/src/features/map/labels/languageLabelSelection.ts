import RBush, { type BBox } from 'rbush'
import type { LanguageLabelAnchor, LanguageLabelProfile } from '../../../data/languageLabels.ts'
import type { MapArea } from '../../../domain/aggregation.ts'
import type { Language } from '../../../domain/atlas.ts'

interface LabelMember {
  readonly areaId: string
  readonly languageId: string
}

export interface LabelChoice {
  readonly variantId: string
  readonly anchor: LanguageLabelAnchor
  readonly minZoom: number
  readonly anchorOrder: number
  readonly owners: readonly string[]
  readonly combined?: boolean
}

interface LanguageLabelNode {
  readonly language: Language
  readonly children: Map<string, LanguageLabelNode>
  readonly primary: LabelChoice[]
  readonly overview: LabelChoice[]
  readonly members: Map<string, Set<string>>
  readonly areaIds: Set<string>
  readonly ownAreaIds: Set<string>
  handoffZoom: number
}

export interface PlacedLanguageLabel {
  readonly language: Language
  readonly choice: LabelChoice
  readonly variantId: string
  readonly overview: boolean
}

interface ScreenPoint {
  readonly x: number
  readonly y: number
}

export interface LabelBox extends BBox, ScreenPoint {}

export interface LabelLayout {
  point(anchor: LanguageLabelAnchor): ScreenPoint | null
  project(language: Language, choice: LabelChoice, spansAreas: boolean): LabelBox | null
  visibleAt(x: number, y: number): readonly string[]
}

type Direction = readonly [x: number, y: number, z: number]

const radians = Math.PI / 180
// Chord distance on a unit sphere for an arc of roughly 1,600 km.
const neighborhoodRadiusSquared = 0.25 ** 2
const densityGrid = 64

function anchorDirection([longitude, latitude]: LanguageLabelAnchor): Direction {
  const lng = longitude * radians
  const lat = latitude * radians
  return [Math.cos(lat) * Math.cos(lng), Math.cos(lat) * Math.sin(lng), Math.sin(lat)]
}

function rankOverviewChoices(
  choices: LabelChoice[],
  representatives: ReadonlyMap<string, LanguageLabelAnchor[]>,
) {
  // A language contributes the same total weight across any pinned source variants.
  const directions = [...representatives.values()].flatMap((anchors) =>
    anchors.map((anchor) => ({ direction: anchorDirection(anchor), weight: 1 / anchors.length })),
  )

  // Nearby candidates share a density estimate on a roughly 100 km grid.
  // Only the score is snapped. Every label uses a verified polygon anchor.
  const cells = new Map<string, number>()
  const density = new Map<LabelChoice, number>()
  for (const choice of choices) {
    const [a, b, c] = anchorDirection(choice.anchor)
    const i = Math.floor(densityGrid * a)
    const j = Math.floor(densityGrid * b)
    const k = Math.floor(densityGrid * c)
    const key = [i, j, k].join(',')
    const cached = cells.get(key)
    if (cached !== undefined) {
      density.set(choice, cached)
      continue
    }
    const x = (i + 0.5) / densityGrid
    const y = (j + 0.5) / densityGrid
    const z = (k + 0.5) / densityGrid
    let score = 0
    for (const {
      direction: [a, b, c],
      weight,
    } of directions) {
      const distanceSquared = (x - a) ** 2 + (y - b) ** 2 + (z - c) ** 2
      const proximity = 1 - distanceSquared / neighborhoodRadiusSquared
      if (proximity > 0) score += weight * proximity ** 2
    }
    cells.set(key, score)
    density.set(choice, score)
  }
  choices.sort(
    (a, b) =>
      (density.get(b) ?? 0) - (density.get(a) ?? 0) ||
      b.anchor[2] - a.anchor[2] ||
      a.variantId.localeCompare(b.variantId),
  )
}

const compareLanguageChoices = (a: LabelChoice, b: LabelChoice) =>
  Number(!!b.combined) - Number(!!a.combined) ||
  a.anchorOrder - b.anchorOrder ||
  b.anchor[2] - a.anchor[2] ||
  a.variantId.localeCompare(b.variantId)

function ancestorsOf(id: string, languages: ReadonlyMap<string, Language>) {
  const ancestors = new Set<string>()
  for (
    let parent = languages.get(id)?.parentId;
    parent && !ancestors.has(parent);
    parent = languages.get(parent)?.parentId
  ) {
    ancestors.add(parent)
  }
  return ancestors
}

export function languageLabelTree(
  profiles: Iterable<LanguageLabelProfile>,
  languages: ReadonlyMap<string, Language>,
  variantIds: readonly string[],
  {
    areas,
    isolatedLanguageId,
  }: {
    readonly areas?: readonly MapArea[]
    readonly isolatedLanguageId?: string
  } = {},
): ReadonlyMap<string, LanguageLabelNode> {
  const roots = new Map<string, LanguageLabelNode>()
  const selected = new Set(variantIds)
  const tables = [...profiles]
  const legacy = tables.every((profile) => !profile.overviews.size)
  const representatives = new Map<LanguageLabelNode, Map<string, LanguageLabelAnchor[]>>()
  const representations = new Map<string, LabelMember[]>()
  const ancestry = new Map<string, Set<string>>()
  for (const { id: areaId, languageId, variants } of areas ?? []) {
    const member = { areaId, languageId }
    for (const { id } of variants) {
      const list = representations.get(id)
      if (list) list.push(member)
      else representations.set(id, [member])
    }
  }
  for (const profile of tables) {
    for (const variantId of selected) {
      const variant = profile.variants.get(variantId)
      if (!variant || variant.path.some((id) => !languages.has(id))) continue
      const { path, anchors } = variant
      const endpoint = path.at(-1)
      if (!endpoint) continue
      for (const { areaId, languageId } of representations.get(variantId) ?? [
        { areaId: variantId, languageId: isolatedLanguageId ?? endpoint },
      ]) {
        const index = path.indexOf(languageId)
        let lineage = isolatedLanguageId ? [languageId] : path.slice(0, index + 1)
        if (index < 0 && !isolatedLanguageId) {
          let parents = ancestry.get(languageId)
          if (!parents) {
            parents = ancestorsOf(languageId, languages)
            ancestry.set(languageId, parents)
          }
          lineage = [...path.filter((id) => parents.has(id)), languageId]
        }
        let branches = roots
        for (const id of lineage) {
          let node = branches.get(id)
          if (!node) {
            const language = languages.get(id)
            if (!language) break
            node = {
              language,
              children: new Map(),
              primary: [],
              overview: [],
              members: new Map(),
              areaIds: new Set(),
              ownAreaIds: new Set(),
              handoffZoom: Infinity,
            }
            branches.set(id, node)
            representatives.set(node, new Map())
          }
          const own = id === languageId
          let areaIds = node.members.get(variantId)
          if (!areaIds) {
            areaIds = new Set()
            node.members.set(variantId, areaIds)
          }
          const known = areaIds.has(areaId)
          areaIds.add(areaId)
          node.areaIds.add(areaId)
          if (own) node.ownAreaIds.add(areaId)
          if (!own) {
            node.handoffZoom = Math.min(node.handoffZoom, profile.handoffZooms.get(id) ?? Infinity)
            const byLanguage = legacy ? representatives.get(node) : undefined
            const primary = anchors[0]
            if (byLanguage && primary && !known) {
              const list = byLanguage.get(languageId)
              if (list) list.push(primary)
              else byLanguage.set(languageId, [primary])
            }
          }
          const choices = own ? node.primary : node.overview
          const depth = path.indexOf(id)
          if (!known) {
            const owners = [areaId]
            for (const [anchorOrder, anchor] of anchors.entries()) {
              // An explicitly mapped group or dialect can be absent from the compact path.
              const minZoom = anchor[4][depth] ?? 0
              choices.push({ variantId, anchor, minZoom, anchorOrder, owners })
            }
          }
          branches = node.children
        }
      }
    }
  }
  for (const [node, byLanguage] of representatives) {
    if (node.children.size || node.language.level === 'family' || node.language.level === 'group') {
      for (const profile of tables) {
        for (const [anchorOrder, [anchor, candidates]] of (
          profile.overviews.get(node.language.id) ?? []
        ).entries()) {
          const variantId = candidates.find((id) => node.members.has(id))
          const minZoom = anchor[4][0]
          if (variantId !== undefined && minZoom !== undefined) {
            const owners = new Set(candidates.flatMap((id) => [...(node.members.get(id) ?? [])]))
            const primaryOwners = [...owners].filter((id) => node.ownAreaIds.has(id))
            const overviewOwners = [...owners].filter((id) => !node.ownAreaIds.has(id))
            const choice = { variantId, anchor, minZoom, anchorOrder, combined: true }
            if (primaryOwners.length) node.primary.push({ ...choice, owners: primaryOwners })
            if (overviewOwners.length) node.overview.push({ ...choice, owners: overviewOwners })
          }
        }
      }
    }
    node.primary.sort(compareLanguageChoices)
    if (byLanguage.size > 1) rankOverviewChoices(node.overview, byLanguage)
    else node.overview.sort(compareLanguageChoices)
  }
  return roots
}

// An overview describes a cluster at the scale of a few label widths on screen.
const MIN_OVERVIEW_RADIUS = 128
const MAX_MEMBER_PROBES = 8
// A tiny fragment can be drawn without being discernible on the map.
const MIN_MEMBER_RADIUS_PX = 2

interface LocalMember extends BBox, ScreenPoint {
  readonly languageId: string
  readonly areaId: string
  readonly clearance: number
}

interface PlacedBox extends LabelBox {
  readonly languageId: string
}

interface LocalOverview {
  readonly box: LabelBox
  readonly radius: number
  readonly node: LanguageLabelNode
  readonly owner: string
}

interface MemberEvidence {
  readonly member: LocalMember
  readonly weight: number
}

const nearby = (a: ScreenPoint, b: ScreenPoint, radius: number) =>
  (a.x - b.x) ** 2 + (a.y - b.y) ** 2 <= radius ** 2

const overviewRadius = (box: LabelBox) => Math.max(MIN_OVERVIEW_RADIUS, box.maxX - box.minX)
const containsMember = (node: LanguageLabelNode, areaId: string) =>
  node.areaIds.has(areaId) && !node.ownAreaIds.has(areaId)

function localFootprint(
  center: ScreenPoint,
  member: ScreenPoint,
  radius: number,
  clearance: number,
) {
  // Use the radius of the interior disk clipped to this neighborhood as a
  // size proxy. Linear weights keep a large area from dwarfing several smaller ones.
  const distance = Math.hypot(center.x - member.x, center.y - member.y)
  return Math.min(clearance, radius, (radius + clearance - distance) / 2)
}

/** Compare names of drawn areas with a local roll-up of their family or branch. */
export function selectLanguageLabels(
  roots: ReadonlyMap<string, LanguageLabelNode>,
  zoom: number,
  lod: number,
  layout: LabelLayout,
  previous: ReadonlyMap<string, PlacedLanguageLabel>,
): Map<string, PlacedLanguageLabel> {
  const placements = new Map<string, PlacedLanguageLabel>()
  const boxes = new Map<string, PlacedBox>()
  const primaryNamesByArea = new Map<string, string>()
  const occupied = new RBush<PlacedBox>()
  const lodBit = 1 << lod
  const scale = 512 * 2 ** zoom
  const summaries: LocalOverview[] = []
  const supportsLod = ({ anchor }: LabelChoice) => Boolean(anchor[3] & lodBit)
  const project = (node: LanguageLabelNode, choice: LabelChoice, overview: boolean) => {
    if (zoom < choice.minZoom || !supportsLod(choice)) return null
    const level = node.language.level
    return layout.project(
      node.language,
      choice,
      overview || level === 'family' || level === 'group',
    )
  }

  const tryPlace = (
    node: LanguageLabelNode,
    choices: readonly LabelChoice[],
    overview: boolean,
    resolve?: (box: LabelBox, collisions: readonly PlacedBox[]) => readonly PlacedBox[] | null,
  ) => {
    const { language } = node
    const current = placements.get(language.id)
    if (current && overview) return
    const currentBox = boxes.get(language.id)
    const prior = previous.get(language.id)
    const priorChoice = prior?.overview === overview ? prior.choice : undefined
    const verifiedOwner = (choice: LabelChoice, { x, y, minX, maxX }: LabelBox) => {
      const visible = layout.visibleAt(x, y)
      const owner = choice.owners.find((id) => visible.includes(id))
      if (!owner || !choice.combined) return owner

      // A combined anchor's offline clearance may include unselected shapes.
      const offset = (maxX - minX) * 0.24
      const expected = overview ? node.areaIds : node.ownAreaIds
      return [x - offset, x + offset].some((sample) =>
        layout.visibleAt(sample, y).some((id) => expected.has(id)),
      )
        ? owner
        : undefined
    }
    const candidate = (choice: LabelChoice) => {
      const box = project(node, choice, overview)
      if (!box) return null
      let displaced: readonly PlacedBox[] = []
      if (resolve) {
        const resolved = resolve(box, occupied.search(box))
        if (!resolved) return null
        displaced = resolved
      } else if (
        currentBox
          ? occupied.search(box).some((other) => other !== currentBox)
          : occupied.collides(box)
      ) {
        return null
      }
      const owner = verifiedOwner(choice, box)
      if (!owner) return null
      // An overview anchored in an already named area reads as a second name for it.
      const primaryName = primaryNamesByArea.get(owner)
      const sharesArea = overview
        ? primaryName !== undefined && !displaced.some((other) => other.languageId === primaryName)
        : summaries.some(
            (summary) =>
              summary.owner === owner ||
              (nearby(box, summary.box, summary.radius) && containsMember(summary.node, owner)),
          )
      if (sharesArea) return null
      return { box: { ...box, languageId: language.id }, displaced, choice, owner }
    }
    for (const [index, choice] of choices.entries()) {
      if (current && compareLanguageChoices(choice, current.choice) >= 0) continue
      let next = candidate(choice)
      if (!next) continue
      // Retain the old anchor only when it is a near-equivalent candidate.
      if (priorChoice && choices[index + 1] === priorChoice && !next.displaced.length) {
        const priorCandidate = candidate(priorChoice)
        if (
          priorCandidate &&
          !priorCandidate.displaced.length &&
          nearby(next.box, priorCandidate.box, 12) &&
          (!current || compareLanguageChoices(priorChoice, current.choice) < 0)
        ) {
          next = priorCandidate
        }
      }
      if (currentBox) occupied.remove(currentBox)
      for (const box of next.displaced) {
        const area = placements.get(box.languageId)?.variantId
        if (area !== undefined) primaryNamesByArea.delete(area)
        occupied.remove(box)
        boxes.delete(box.languageId)
        placements.delete(box.languageId)
      }
      if (current) primaryNamesByArea.delete(current.variantId)
      if (!overview) primaryNamesByArea.set(next.owner, language.id)
      occupied.insert(next.box)
      boxes.set(language.id, next.box)
      placements.set(language.id, {
        language,
        choice: next.choice,
        variantId: next.owner,
        overview,
      })
      return next
    }
  }

  const primary: { node: LanguageLabelNode; clearance: number }[] = []
  const overviews: LanguageLabelNode[] = []
  const collect = (node: LanguageLabelNode) => {
    const eligible = node.primary.find((choice) => project(node, choice, false))
    if (eligible) primary.push({ node, clearance: eligible.anchor[2] })
    const childrenFirst = zoom >= node.handoffZoom
    if (childrenFirst) for (const child of node.children.values()) collect(child)
    if (node.overview.length && node.areaIds.size > 1) overviews.push(node)
    if (!childrenFirst) for (const child of node.children.values()) collect(child)
  }
  for (const root of roots.values()) collect(root)

  // For competing area names, give the larger interior first choice of space.
  primary.sort(
    (a, b) => b.clearance - a.clearance || a.node.language.id.localeCompare(b.node.language.id),
  )
  for (const { node } of primary) tryPlace(node, node.primary, false)
  if (!overviews.length) return placements

  // Native-LOD anchors also give evidence for areas whose text cannot fit.
  const points: LocalMember[] = []
  const indexed = new Set<LanguageLabelNode>()
  const minClearance = MIN_MEMBER_RADIUS_PX / scale
  const indexMembers = (node: LanguageLabelNode) => {
    if (indexed.has(node)) return
    indexed.add(node)
    for (const choice of node.primary) {
      if (choice.combined || !supportsLod(choice) || choice.anchor[2] < minClearance) continue
      const point = layout.point(choice.anchor)
      const areaId = choice.owners[0]
      if (point && areaId !== undefined) {
        const { x, y } = point
        points.push({
          x,
          y,
          minX: x,
          maxX: x,
          minY: y,
          maxY: y,
          areaId,
          languageId: node.language.id,
          clearance: choice.anchor[2] * scale,
        })
      }
    }
    for (const child of node.children.values()) indexMembers(child)
  }
  for (const root of overviews) indexMembers(root)
  const localMembers = new RBush<LocalMember>().load(points)

  const competingAreas = (a: LanguageLabelNode, b: LanguageLabelNode) => {
    const [smaller, larger] = a.areaIds.size <= b.areaIds.size ? [a, b] : [b, a]
    for (const id of smaller.areaIds) if (larger.areaIds.has(id)) return true
    return false
  }

  const compareOverview = (
    node: LanguageLabelNode,
    box: LabelBox,
    collisions: readonly PlacedBox[],
  ): readonly PlacedBox[] | null => {
    const radius = overviewRadius(box)
    const bounds = {
      minX: box.x - radius,
      minY: box.y - radius,
      maxX: box.x + radius,
      maxY: box.y + radius,
    }
    const nearbySummaries = summaries.filter(({ box: other, radius: otherRadius }) =>
      nearby(box, other, radius + otherRadius),
    )
    if (
      nearbySummaries.some(
        (other) =>
          nearby(box, other.box, Math.max(radius, other.radius)) &&
          competingAreas(node, other.node),
      )
    ) {
      return null
    }
    const names = new Map<PlacedBox, number>()
    for (const other of occupied.search(bounds)) {
      if (!nearby(box, other, radius)) continue
      const label = placements.get(other.languageId)
      if (label && !label.overview && containsMember(node, label.variantId)) {
        names.set(other, localFootprint(box, other, radius, label.choice.anchor[2] * scale))
      }
    }
    if (collisions.some((other) => !names.has(other))) return null

    const unresolved = new Map<string, [MemberEvidence, MemberEvidence?]>()
    for (const member of localMembers.search(bounds)) {
      if (!containsMember(node, member.areaId) || !nearby(box, member, radius)) continue
      const named = boxes.get(member.languageId)
      if (named && (names.has(named) || nearby(member, named, radius))) continue
      if (
        nearbySummaries.some(
          (summary) =>
            containsMember(summary.node, member.areaId) &&
            nearby(summary.box, member, summary.radius),
        )
      ) {
        continue
      }
      const weight = localFootprint(box, member, radius, member.clearance)
      const evidence = unresolved.get(member.languageId)
      const candidate = { member, weight }
      if (!evidence) unresolved.set(member.languageId, [candidate])
      else if (weight > evidence[0].weight)
        unresolved.set(member.languageId, [candidate, evidence[0]])
      else if (weight > (evidence[1]?.weight ?? 0)) evidence[1] = candidate
    }
    if (unresolved.size < 2) return null

    // Verify the strongest anchor per name first. Multiple components or pinned
    // variants of the same language contribute at most one sample to the score.
    const ranked = [...unresolved.values()].sort((a, b) => b[0].weight - a[0].weight)
    const namedWeight = [...names.values()].reduce((total, weight) => total + weight, 0)
    const coversMore = (weight: number) =>
      weight > namedWeight || (weight === namedWeight && zoom < node.handoffZoom)
    const bestPossible = ranked
      .slice(0, MAX_MEMBER_PROBES)
      .reduce((total, [best]) => total + best.weight, 0)
    if (!coversMore(bestPossible)) return null

    let probes = 0
    let count = 0
    let weight = 0
    for (const evidence of ranked) {
      for (const candidate of evidence) {
        if (!candidate) continue
        if (probes++ >= MAX_MEMBER_PROBES) return null
        const { member, weight: candidateWeight } = candidate
        if (layout.visibleAt(member.x, member.y).includes(member.areaId)) {
          count++
          weight += candidateWeight
          break
        }
      }
      if (count >= 2 && coversMore(weight)) return [...names.keys()]
    }
    return null
  }

  let displaced = false
  for (const node of overviews) {
    const next = tryPlace(node, node.overview, true, (box, collisions) =>
      compareOverview(node, box, collisions),
    )
    if (next) {
      displaced ||= next.displaced.length > 0
      summaries.push({ box: next.box, radius: overviewRadius(next.box), node, owner: next.owner })
    }
  }
  if (displaced) {
    // Freed space can take unrelated area names or a different local occurrence.
    for (const { node } of primary) {
      if (!placements.has(node.language.id)) tryPlace(node, node.primary, false)
    }
  }
  return placements
}
