import { type GeographyAvailability, mappedBranchForLanguages } from './aggregation.ts'
import type { LanguageId } from './atlas.ts'
import { buildColorTopology, type ColorTopology, topmostColorRoots } from './colors.ts'
import type { LanguageHierarchy } from './hierarchy.ts'
import { type GeographyContext, pinMapEntry } from './mapEntries.ts'

/** Shared branch policy for interactive selection and offline coverage preparation. */
export const buildBranchMapEntries = (
  rootIds: readonly LanguageId[],
  hierarchy: LanguageHierarchy,
  availability: ReadonlyMap<LanguageId, GeographyAvailability>,
  context: GeographyContext,
  topology: ColorTopology = buildColorTopology(hierarchy),
) => {
  const branch = mappedBranchForLanguages(rootIds, hierarchy, availability)
  const roots = new Set(topmostColorRoots(rootIds, topology))
  const entries = branch.languageIds.flatMap((id) => {
    let ancestor: string | null = id
    const visited = new Set<string>()
    while (ancestor && !roots.has(ancestor) && !visited.has(ancestor)) {
      visited.add(ancestor)
      ancestor = hierarchy.languageById.get(ancestor)?.parentId ?? null
    }
    const rootId = ancestor && roots.has(ancestor) ? ancestor : null
    const entry = pinMapEntry(id, availability.get(id), 'own', context, rootId)
    return entry ? [{ ...entry, ...(rootId ? { branchRootId: rootId } : {}) }] : []
  })
  return { ...branch, entries }
}
