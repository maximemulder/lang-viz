import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl'

import { BIOME_COLOR } from './biomes'

export type BackgroundMode = 'minimal' | 'biomes' | 'terrain' | 'satellite'

const PREVIEW_BASE = `${import.meta.env.BASE_URL}basemaps/previews`

export const BACKGROUND_OPTIONS = [
  { value: 'minimal', label: 'Plain', preview: `${PREVIEW_BASE}/plain.webp` },
  { value: 'biomes', label: 'Biomes', preview: `${PREVIEW_BASE}/biomes.webp` },
  { value: 'terrain', label: 'Terrain', preview: `${PREVIEW_BASE}/terrain.webp` },
  {
    value: 'satellite',
    label: 'Satellite',
    preview: `${PREVIEW_BASE}/satellite.webp`,
  },
] as const

const NASA_TILES =
  'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8'
const EOX_TILES = 'https://tiles.maps.eox.at/wmts/1.0.0'

const TERRAIN_ATTRIBUTION = [
  'Terrain:',
  'data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> and others,',
  'rendering © <a href="https://maps.eox.at/">EOX</a>',
].join(' ')

const BACKGROUND_LAYERS: Readonly<Record<BackgroundMode, readonly string[]>> = {
  minimal: ['minimal-water', 'minimal-coastline', 'minimal-rivers'],
  biomes: ['geographic-biomes', 'minimal-water', 'minimal-coastline', 'minimal-rivers'],
  terrain: ['geographic-terrain'],
  satellite: ['geographic-satellite'],
}

/** Keep the style and language sources in place when changing only the basemap. */
export const applyBackground = (map: MapLibreMap, mode: BackgroundMode) => {
  const color = mode === 'minimal' || mode === 'biomes' ? '#f5f2e9' : '#164f6f'
  if (
    map.getLayer('ocean-background') &&
    map.getPaintProperty('ocean-background', 'background-color') !== color
  ) {
    map.setPaintProperty('ocean-background', 'background-color', color)
  }
  const visibleLayers = new Set(BACKGROUND_LAYERS[mode])
  for (const id of new Set(Object.values(BACKGROUND_LAYERS).flat())) {
    if (!map.getLayer(id)) continue
    const visibility = visibleLayers.has(id) ? 'visible' : 'none'
    if (map.getLayoutProperty(id, 'visibility') !== visibility) {
      map.setLayoutProperty(id, 'visibility', visibility)
    }
  }
}

/** Geographic backgrounds without political boundaries or place labels. */
export const GEOGRAPHIC_BASEMAP: StyleSpecification = {
  version: 8,
  name: 'Language atlas backgrounds',
  sources: {
    terrain: {
      type: 'raster',
      tiles: [`${EOX_TILES}/terrain_3857/default/g/{z}/{y}/{x}.jpg`],
      tileSize: 256,
      maxzoom: 17,
      attribution: TERRAIN_ATTRIBUTION,
    },
    satellite: {
      type: 'raster',
      tiles: [`${NASA_TILES}/{z}/{y}/{x}.jpeg`],
      tileSize: 256,
      // Overzoom NASA's published z0–8 tiles for closer views.
      maxzoom: 8,
      attribution:
        'Blue Marble © <a href="https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/">NASA Earth Observatory</a>; tiles via <a href="https://www.earthdata.nasa.gov/eosdis/science-system-description/eosdis-standard-services/global-imagery-browse-services-gibs">NASA GIBS</a>',
    },
    biomes: {
      type: 'vector',
      url: `pmtiles://${new URL(`${import.meta.env.BASE_URL}basemaps/biomes.pmtiles`, window.location.href).href}`,
      attribution:
        '<a href="https://doi.org/10.1093/biosci/bix014">RESOLVE Ecoregions 2017</a> (<a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>); simplified, styled by biome',
    },
    'minimal-geography': {
      type: 'vector',
      url: 'https://tiles.openfreemap.org/planet/latest',
      attribution:
        '<a href="https://openfreemap.org/">OpenFreeMap</a> © <a href="https://openmaptiles.org/">OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
    },
  },
  layers: [
    {
      id: 'ocean-background',
      type: 'background',
      paint: { 'background-color': '#164f6f', 'background-color-transition': { duration: 0 } },
    },
    {
      id: 'geographic-biomes',
      type: 'fill',
      source: 'biomes',
      'source-layer': 'biomes',
      layout: { visibility: 'none' },
      paint: { 'fill-color': BIOME_COLOR, 'fill-outline-color': BIOME_COLOR },
    },
    {
      id: 'minimal-water',
      type: 'fill',
      source: 'minimal-geography',
      'source-layer': 'water',
      layout: { visibility: 'none' },
      paint: { 'fill-color': '#cbdcdf' },
    },
    {
      id: 'minimal-coastline',
      type: 'line',
      source: 'minimal-geography',
      'source-layer': 'water',
      layout: { visibility: 'none' },
      paint: { 'line-color': '#a3bec1', 'line-width': 0.5 },
    },
    {
      id: 'minimal-rivers',
      type: 'line',
      source: 'minimal-geography',
      'source-layer': 'waterway',
      minzoom: 5,
      layout: { visibility: 'none' },
      paint: { 'line-color': '#b8cfd2', 'line-width': 0.6 },
    },
    {
      id: 'geographic-terrain',
      type: 'raster',
      source: 'terrain',
      layout: { visibility: 'visible' },
      paint: { 'raster-fade-duration': 180 },
    },
    {
      id: 'geographic-satellite',
      type: 'raster',
      source: 'satellite',
      layout: { visibility: 'none' },
      paint: { 'raster-fade-duration': 180 },
    },
  ],
}
