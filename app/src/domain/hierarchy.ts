import type { Language } from './atlas.ts'

export interface LanguageHierarchy {
  readonly roots: readonly Language[]
  readonly childrenById: ReadonlyMap<string, readonly Language[]>
  readonly languageById: ReadonlyMap<string, Language>
}

export interface HierarchyRow {
  readonly key: string
  readonly parentKey: string | null
  readonly language: Language
  readonly depth: number
  readonly position: number
  readonly siblingCount: number
  readonly childCount: number
}

/** Input catalog order supplies the alphabetical order of roots and siblings. */
export const buildLanguageHierarchy = (languages: readonly Language[]): LanguageHierarchy => {
  const languageById = new Map(languages.map((language) => [language.id, language]))
  const roots: Language[] = []
  const childrenById = new Map<string, Language[]>()
  for (const language of languages) {
    if (language.parentId && languageById.has(language.parentId)) {
      const children = childrenById.get(language.parentId) ?? []
      children.push(language)
      childrenById.set(language.parentId, children)
    } else {
      roots.push(language)
    }
  }
  return { roots, childrenById, languageById }
}

export const languageAncestors = (hierarchy: LanguageHierarchy, language: Language) => {
  const ancestors: Language[] = []
  const visited = new Set([language.id])
  let parentId = language.parentId
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId)
    const parent = hierarchy.languageById.get(parentId)
    if (!parent) break
    ancestors.push(parent)
    parentId = parent.parentId
  }
  return ancestors.reverse()
}

/** Each matching entry is an independent starting point, even if an ancestor matches too. */
export const flattenLanguageHierarchy = (
  hierarchy: LanguageHierarchy,
  roots: readonly Language[],
  expandedKeys: ReadonlySet<string>,
): HierarchyRow[] => {
  const rows: HierarchyRow[] = []
  const visit = (
    siblings: readonly Language[],
    parentKey: string | null,
    depth: number,
    ancestors: ReadonlySet<string>,
  ) => {
    siblings.forEach((language, index) => {
      if (ancestors.has(language.id)) return
      const key = parentKey ? `${parentKey}/${language.id}` : language.id
      const children = hierarchy.childrenById.get(language.id) ?? []
      rows.push({
        key,
        parentKey,
        language,
        depth,
        position: index + 1,
        siblingCount: siblings.length,
        childCount: children.length,
      })
      if (expandedKeys.has(key)) {
        visit(children, key, depth + 1, new Set([...ancestors, language.id]))
      }
    })
  }
  visit(roots, null, 0, new Set())
  return rows
}
