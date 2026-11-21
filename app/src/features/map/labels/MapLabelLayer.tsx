import type { SymbolLayerSpecification } from 'maplibre-gl'
import { Layer } from 'react-map-gl/maplibre'

export const LABEL_FONT = ['Arial', 'sans-serif']
export const LABEL_SIZE = 13
const TEXT_PADDING = 3
const HALO_WIDTH = 2.1
export const LABEL_MARGIN = TEXT_PADDING + HALO_WIDTH + 1

/** Common typography and collision rules for region and language symbols. */
export function MapLabelLayer({
  singleLine = false,
  ...props
}: Pick<SymbolLayerSpecification, 'id' | 'minzoom' | 'filter'> & {
  readonly source?: string
  readonly singleLine?: boolean
}) {
  return (
    <Layer
      {...props}
      type="symbol"
      layout={{
        'text-field': ['get', 'labelName'],
        'text-font': LABEL_FONT,
        'text-size': LABEL_SIZE,
        'text-max-width': singleLine ? 100 : 10,
        'text-padding': TEXT_PADDING,
        'symbol-sort-key': ['get', 'labelRank'],
      }}
      paint={{
        'text-color': ['case', ['boolean', ['get', 'overview'], false], '#465b60', '#182d31'],
        'text-halo-color': '#fffdf6',
        'text-halo-width': HALO_WIDTH,
        'text-halo-blur': 0.4,
      }}
    />
  )
}
