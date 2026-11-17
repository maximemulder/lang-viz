export const AREA_POINT_LAYER = 'administrative-point-hits'
export const AREA_POLYGON_LAYER = 'administrative-polygon-hits'
export const AREA_LABEL_ZOOMS = [2, 3, 4, 5, 6, 7] as const
export const AREA_LABEL_LAYERS = AREA_LABEL_ZOOMS.map((zoom) => `administrative-labels-${zoom}`)
