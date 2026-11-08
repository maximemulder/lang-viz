type Position = [number, number]

/** Quantize before winding: rounding can reverse a narrow ring's signed area.
 * MVT readers infer shells from the first nonzero ring's winding, so one tiny
 * reversed shell can turn the rest of a language's islands into holes.
 * Keep shell/hole ownership until after projection, including parent assembly.
 */
export const quantizeTilePolygon = (
  polygon: readonly (readonly Position[])[],
  project: (point: Position) => Position,
): Position[][] => {
  const output: Position[][] = []
  for (const [index, ring] of polygon.entries()) {
    const rounded: Position[] = []
    for (const point of ring) {
      const projected = project(point)
      const next: Position = [Math.round(projected[0]), Math.round(projected[1])]
      const previous = rounded.at(-1)
      if (!previous || previous[0] !== next[0] || previous[1] !== next[1]) rounded.push(next)
    }
    const first = rounded[0]
    const last = rounded.at(-1)
    if (first && last && (first[0] !== last[0] || first[1] !== last[1])) rounded.push(first)
    let area = 0
    for (let i = 1; i < rounded.length; i++) {
      const a = rounded[i - 1]
      const b = rounded[i]
      if (a && b) area += a[0] * b[1] - b[0] * a[1]
    }
    if (!area) {
      // A collapsed shell cannot leave its holes attached to a preceding island.
      if (index === 0) return []
      continue
    }
    output.push(area > 0 === (index === 0) ? rounded : rounded.reverse())
  }
  return output
}
