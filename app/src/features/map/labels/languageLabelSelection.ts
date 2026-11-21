import RBush, { type BBox } from 'rbush'
import type { LanguageLabelAnchor, LanguageLabelProfile } from '../../../data/languageLabels.ts'
import type { Language } from '../../../domain/atlas.ts'

export interface LabelChoice {
  readonly variantId: string
  readonly anchor: LanguageLabelAnchor
  readonly minZoom: number
  readonly anchorOrder: number
  readonly owners?: readonly string[]
}

export interface LanguageLabelNode {
  readonly language: Language
  readonly children: Map<string, LanguageLabelNode>
  readonly choices: LabelChoice[]
  readonly endpoints: Set<string>
  readonly variants: Set<string>
  handoffZoom: number
}

export interface PlacedLanguageLabel {
  readonly language: Language
  readonly choice: LabelChoice
  readonly variantId: string
}

export interface LabelBox extends BBox {
  readonly x: number
  readonly y: number
}

export interface LabelLayout {
  project(language: Language, choice: LabelChoice): LabelBox | null
  owner(node: LanguageLabelNode, choice: LabelChoice, box: LabelBox): string | undefined
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
  Number(!a.owners) - Number(!b.owners) ||
  a.anchorOrder - b.anchorOrder ||
  b.anchor[2] - a.anchor[2] ||
  a.variantId.localeCompare(b.variantId)

export function languageLabelTree(
  profiles: Iterable<LanguageLabelProfile>,
  languages: ReadonlyMap<string, Language>,
  variantIds: readonly string[],
  isolated: boolean,
): ReadonlyMap<string, LanguageLabelNode> {
  const roots = new Map<string, LanguageLabelNode>()
  const selected = new Set(variantIds)
  const tables = [...profiles]
  const legacy = tables.every((profile) => !profile.overviews.size)
  const members = new Map<LanguageLabelNode, Map<string, LanguageLabelAnchor[]>>()
  for (const profile of tables) {
    for (const variantId of selected) {
      const variant = profile.variants.get(variantId)
      if (!variant || variant.path.some((id) => !languages.has(id))) continue
      const { path, anchors } = variant
      const endpoint = path.at(-1)
      if (!endpoint) continue
      let branches = roots
      for (const [depth, id] of path.entries()) {
        if (isolated && id !== endpoint) continue
        let node = branches.get(id)
        if (!node) {
          const language = languages.get(id)
          if (!language) break
          node = {
            language,
            children: new Map(),
            choices: [],
            endpoints: new Set(),
            variants: new Set(),
            handoffZoom: Infinity,
          }
          branches.set(id, node)
          members.set(node, new Map())
        }
        node.endpoints.add(endpoint)
        node.variants.add(variantId)
        if (id !== endpoint) {
          node.handoffZoom = Math.min(node.handoffZoom, profile.handoffZooms.get(id) ?? Infinity)
          const representatives = legacy ? members.get(node) : undefined
          const primary = anchors[0]
          if (representatives && primary) {
            const byEndpoint = representatives.get(endpoint)
            if (byEndpoint) byEndpoint.push(primary)
            else representatives.set(endpoint, [primary])
          }
        }
        for (const [anchorOrder, anchor] of anchors.entries()) {
          const minZoom = anchor[4][depth]
          if (minZoom !== undefined) node.choices.push({ variantId, anchor, minZoom, anchorOrder })
        }
        branches = node.children
      }
    }
  }
  for (const [node, representatives] of members) {
    if (
      !isolated &&
      (node.children.size || node.language.level === 'family' || node.language.level === 'group')
    ) {
      for (const profile of tables) {
        for (const [anchorOrder, [anchor, candidates]] of (
          profile.overviews.get(node.language.id) ?? []
        ).entries()) {
          const owners = candidates.filter((id) => node.variants.has(id))
          const variantId = owners[0]
          const minZoom = anchor[4][0]
          if (variantId !== undefined && minZoom !== undefined) {
            node.choices.push({ variantId, anchor, minZoom, anchorOrder, owners })
          }
        }
      }
    }
    if (representatives.size > 1) {
      rankOverviewChoices(node.choices, representatives)
    } else node.choices.sort(compareLanguageChoices)
  }
  return roots
}

/** Descend on schedule. A parent is a local fallback for a group of selected endpoints. */
export function selectLanguageLabels(
  roots: ReadonlyMap<string, LanguageLabelNode>,
  zoom: number,
  lod: number,
  layout: LabelLayout,
  previous: ReadonlyMap<string, PlacedLanguageLabel>,
): Map<string, PlacedLanguageLabel> {
  const placements = new Map<string, PlacedLanguageLabel>()
  const boxes = new Map<string, LabelBox>()
  const occupied = new RBush<LabelBox>()
  const ordered = (nodes: ReadonlyMap<string, LanguageLabelNode>) =>
    [...nodes.values()].sort((a, b) => b.endpoints.size - a.endpoints.size)
  const visit = (node: LanguageLabelNode): boolean => {
    const { choices, language } = node
    const visitChildren = () => {
      let placed = false
      for (const child of ordered(node.children)) if (visit(child)) placed = true
      return placed
    }

    if (node.children.size && node.endpoints.size === 1) return visitChildren()

    const childrenFirst = zoom >= node.handoffZoom
    if (childrenFirst && visitChildren()) return true

    const current = placements.get(language.id)
    const currentBox = boxes.get(language.id)
    const prior = previous.get(language.id)?.choice
    const available = (choice: LabelChoice) => {
      if (zoom < choice.minZoom || !(choice.anchor[3] & (1 << lod))) return null
      const box = layout.project(language, choice)
      if (!box) return null
      const collides = currentBox
        ? occupied.search(box).some((other) => other !== currentBox)
        : occupied.collides(box)
      if (collides) return null
      return box
    }
    for (const [index, candidate] of choices.entries()) {
      const box = available(candidate)
      if (!box) continue
      const variantId = layout.owner(node, candidate, box)
      if (!variantId) continue
      let placement = { language, choice: candidate, variantId }
      let nextBox = box

      // Hold a nearby previous anchor when it differs by only one place in the ranking.
      if (prior && prior !== candidate && choices[index + 1] === prior) {
        const priorBox = available(prior)
        if (priorBox && Math.hypot(box.x - priorBox.x, box.y - priorBox.y) <= 12) {
          const owner = layout.owner(node, prior, priorBox)
          if (owner) {
            placement = { language, choice: prior, variantId: owner }
            nextBox = priorBox
          }
        }
      }
      if (!current || compareLanguageChoices(placement.choice, current.choice) < 0) {
        if (currentBox) occupied.remove(currentBox)
        occupied.insert(nextBox)
        boxes.set(language.id, nextBox)
        placements.set(language.id, placement)
      }
      return true
    }
    return !!current || (!childrenFirst && visitChildren())
  }
  for (const root of ordered(roots)) visit(root)
  return placements
}
