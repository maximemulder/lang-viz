export const OUTLINE_LAYER = 'language_outline'
export const outlineGroupsKey = (groups: readonly (readonly string[])[]) =>
  JSON.stringify(
    [...new Set(groups.map((ids) => JSON.stringify([...new Set(ids)].sort())))]
      .sort()
      .map((key) => JSON.parse(key) as string[])
      .filter((ids) => ids.length),
  )
