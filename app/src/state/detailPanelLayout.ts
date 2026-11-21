export type DetailPanelOrigin = 'sidebar' | 'map'
export type DetailPanelPlacement = 'cover' | 'beside'

export interface DetailPanelLayout {
  readonly origin: DetailPanelOrigin
  readonly placement: DetailPanelPlacement
  readonly placementChosen: boolean
}

/** Drill-down links inherit the entry point. A manual move lasts until the panel closes. */
export function openDetailPanel(
  current: DetailPanelLayout | null,
  origin = current?.origin ?? 'sidebar',
): DetailPanelLayout {
  return {
    origin,
    placement: current?.placementChosen ? current.placement : origin === 'map' ? 'cover' : 'beside',
    placementChosen: current?.placementChosen ?? false,
  }
}

export function moveDetailPanel(layout: DetailPanelLayout): DetailPanelLayout {
  return {
    ...layout,
    placement: layout.placement === 'cover' ? 'beside' : 'cover',
    placementChosen: true,
  }
}
