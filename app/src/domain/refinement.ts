/** Selected representation IDs whose areas a more specific entry refines. */
export type Refinements = Readonly<Record<string, readonly string[]>>

/** Keep incomparable contributors; classification depth alone never gives priority. */
export const refinedMemberships = (ids: readonly string[], refinements: Refinements = {}) => {
  const hidden = new Set(ids.flatMap((id) => refinements[id] ?? []))
  return [...new Set(ids)].filter((id) => !hidden.has(id)).sort()
}
