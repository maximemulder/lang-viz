type Position = [number, number]

/** Extend only tile-cut edges into MapLibre's 1/128-tile stencil border.
 * Keep natural boundary endpoints fixed and join the apron into its original
 * ring. Separate touching/overlapping apron polygons cause rendering and query
 * ambiguities. Canonical geometry stays separate for parent assembly.
 */
export const bufferTileEdges = (rings: Position[][], extent: number): Position[][] => {
  const padding = Math.max(1, Math.ceil(extent / 128))
  const offset = (a: Position, b: Position): Position | null => {
    if (a[0] === b[0] && a[1] === b[1]) return null
    if (a[0] === 0 && b[0] === 0) return [-padding, 0]
    if (a[0] === extent && b[0] === extent) return [padding, 0]
    if (a[1] === 0 && b[1] === 0) return [0, -padding]
    if (a[1] === extent && b[1] === extent) return [0, padding]
    return null
  }
  let changed = false
  const output = rings.map((ring) => {
    // Rounding to integer MVT coordinates can collapse consecutive vertices.
    const vertices = ring.slice(0, -1).filter((point, i) => {
      const previous = ring[i - 1]
      return !previous || point[0] !== previous[0] || point[1] !== previous[1]
    })
    const count = vertices.length
    if (count < 3) return ring
    const edges = vertices.map((a, i) => {
      const b = vertices[(i + 1) % count]
      return b ? offset(a, b) : null
    })
    if (!edges.some(Boolean)) return ring
    changed = true
    const buffered: Position[] = []
    for (let i = 0; i < count; i++) {
      const point = vertices[i]
      if (!point) continue
      const incoming = edges[(i + count - 1) % count]
      const outgoing = edges[i]
      if (incoming && outgoing) {
        // Consecutive edges on one side share their displaced vertex. At a
        // corner, join both offsets to cover the stencil's corner as well.
        buffered.push([
          point[0] + (incoming[0] || outgoing[0]),
          point[1] + (incoming[1] || outgoing[1]),
        ])
      } else {
        if (incoming) buffered.push([point[0] + incoming[0], point[1] + incoming[1]])
        buffered.push(point)
        if (outgoing) buffered.push([point[0] + outgoing[0], point[1] + outgoing[1]])
      }
    }
    const first = buffered[0]
    if (first) buffered.push(first)
    return buffered
  })
  return changed ? output : rings
}
