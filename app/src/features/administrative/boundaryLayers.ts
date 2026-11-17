export const REGION_POINT_LAYER = 'administrative-point-hits'
export const REGION_POLYGON_LAYER = 'administrative-polygon-hits'
export const REGION_LABEL_ZOOMS = [2, 3, 4, 5, 6, 7] as const
export const REGION_LABEL_LAYERS = REGION_LABEL_ZOOMS.map((zoom) => `administrative-labels-${zoom}`)
