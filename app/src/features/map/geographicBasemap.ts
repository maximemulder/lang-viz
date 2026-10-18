import type { StyleSpecification } from 'maplibre-gl'

const TERRAIN_TILES_URL =
  'https://tiles.maps.eox.at/wmts/1.0.0/terrain_3857/default/g/{z}/{y}/{x}.jpg'

const TERRAIN_ATTRIBUTION = [
  'Terrain:',
  'data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> and others,',
  'rendering © <a href="https://maps.eox.at/">EOX</a>',
].join(' ')

/**
 * A physical basemap with no political boundaries or place labels.
 * Administrative context can be added later as an independent overlay.
 */
export const GEOGRAPHIC_BASEMAP: StyleSpecification = {
  version: 8,
  name: 'Geographic terrain',
  sources: {
    terrain: {
      type: 'raster',
      tiles: [TERRAIN_TILES_URL],
      tileSize: 256,
      maxzoom: 17,
      attribution: TERRAIN_ATTRIBUTION,
    },
  },
  layers: [
    {
      id: 'ocean-background',
      type: 'background',
      paint: {
        'background-color': '#164f6f',
      },
    },
    {
      id: 'geographic-terrain',
      type: 'raster',
      source: 'terrain',
      paint: {
        'raster-fade-duration': 180,
      },
    },
  ],
}
