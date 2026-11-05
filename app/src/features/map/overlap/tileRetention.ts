interface TileId {
  readonly key: string
  readonly canonical: { readonly z: number }
  isChildOf(parent: TileId): boolean
}

/** Keep the nearest loaded descendant in each branch, including deeper siblings.
 * MapLibre 6.14 keeps only the globally nearest generation, within three levels.
 * That drops still-visible geometry when another branch finishes first, or when
 * a zoom-out outruns parent loading. Atlas sources have at most eight native
 * zoom levels; retaining existing descendants is bounded by their loaded tiles.
 */
export const retainCoverageChildren = <T extends TileId>(
  retained: Record<string, T>,
  targets: Set<T>,
  descendants: Record<string, { tileID: T }[]>,
): Set<T> => {
  const incomplete = new Set<T>()
  for (const target of targets) {
    const loaded = descendants[target.key] ?? []
    let covered = 0
    for (const { tileID: child } of loaded) {
      // A loaded ancestor replaces only its own branch. Retaining both would
      // needlessly draw overlapping resolutions and duplicate translucent fills.
      if (loaded.some(({ tileID: other }) => child.isChildOf(other))) continue
      retained[child.key] = child
      covered += 4 ** (target.canonical.z - child.canonical.z)
    }
    // Disjoint quadtree descendants have exact binary areas. Overscaled tiles
    // cover their canonical area, rather than a smaller overscaled generation.
    if (covered < 1) incomplete.add(target)
  }
  return incomplete
}
