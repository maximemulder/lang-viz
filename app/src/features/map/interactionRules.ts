/** Country overview picks countries. Inside an already selected country, the
 * same pointer gestures pick its language areas instead. */
export function inspectLanguageInRegion(
  featureId: string | null,
  selected: readonly string[],
  hasLanguage: boolean,
) {
  return featureId !== null && selected.includes(featureId) && hasLanguage
}

/** Real atlas records only. A family/branch selection includes its mapped
 * descendants; an ordinary language uses its own supplied footprint. */
export function isolatedLanguageIds(
  id: string,
  level: string | undefined,
  hasOwnArea: boolean,
  children: ReadonlyMap<string, readonly { readonly id: string }[]>,
) {
  const ids = new Set([id])
  if (level !== 'family' && hasOwnArea) return ids
  const pending = [id]
  for (let index = 0; index < pending.length; index++) {
    for (const child of children.get(pending[index] ?? '') ?? []) {
      if (!ids.has(child.id)) {
        ids.add(child.id)
        pending.push(child.id)
      }
    }
  }
  return ids
}

/** Keep the first hit stable while the user completes a mouse/trackpad double click. */
export const MAP_DOUBLE_CLICK_MS = 600
export function isDoubleMapClick(
  previous: { readonly x: number; readonly y: number; readonly time: number } | null,
  current: { readonly x: number; readonly y: number; readonly time: number },
) {
  return (
    previous !== null &&
    current.time - previous.time <= MAP_DOUBLE_CLICK_MS &&
    current.time >= previous.time &&
    Math.hypot(current.x - previous.x, current.y - previous.y) <= 12
  )
}
