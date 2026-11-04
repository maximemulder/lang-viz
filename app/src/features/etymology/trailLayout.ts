import type { WordTrail } from '../../domain/etymology.ts'

export const layoutTrail = (trail: WordTrail) => {
  const degree = new Map(trail.ids.map((id) => [id, 0]))
  const rank = new Map(trail.ids.map((id) => [id, 0]))
  const outgoing = new Map<string, string[]>()
  for (const edge of trail.edges) {
    if (edge.p === edge.c) continue
    degree.set(edge.c, (degree.get(edge.c) ?? 0) + 1)
    outgoing.set(edge.p, [...(outgoing.get(edge.p) ?? []), edge.c])
  }
  const queue = trail.ids.filter((id) => degree.get(id) === 0)
  const processed = new Set<string>()
  while (queue.length) {
    const id = queue.shift()
    if (!id) continue
    processed.add(id)
    for (const child of outgoing.get(id) ?? []) {
      rank.set(child, Math.max(rank.get(child) ?? 0, (rank.get(id) ?? 0) + 1))
      const remaining = (degree.get(child) ?? 0) - 1
      degree.set(child, remaining)
      if (remaining === 0) queue.push(child)
    }
  }
  const cyclic =
    trail.ids.some((id) => !processed.has(id)) || trail.edges.some((edge) => edge.p === edge.c)
  // Keep cyclic records visible without an unbounded ancestry walk.
  trail.ids
    .filter((id) => !processed.has(id))
    .forEach((id, i) => {
      rank.set(id, Math.min(i, 7))
    })
  const columns = new Map<number, string[]>()
  for (const id of trail.ids) {
    const column = rank.get(id) ?? 0
    columns.set(column, [...(columns.get(column) ?? []), id])
  }
  const rows = Math.max(1, ...[...columns.values()].map((column) => column.length))
  const points = new Map<string, { x: number; y: number }>()
  for (const [column, ids] of columns) {
    ids.forEach((id, i) => {
      points.set(id, { x: 30 + column * 225, y: 45 + (rows - ids.length) * 50 + i * 100 })
    })
  }
  return {
    points,
    cyclic,
    width: Math.max(310, Math.max(0, ...rank.values()) * 225 + 230),
    height: Math.max(220, rows * 100 + 40),
  }
}
