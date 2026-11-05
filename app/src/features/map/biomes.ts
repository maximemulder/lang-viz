import type { ExpressionSpecification } from 'maplibre-gl'

// RESOLVE Ecoregions 2017 biome IDs; deliberately muted for language overlays.
export const BIOMES = [
  { id: 1, label: 'Tropical moist forests', color: '#8faf8f' },
  { id: 2, label: 'Tropical dry forests', color: '#aab68a' },
  { id: 3, label: 'Tropical conifer forests', color: '#96ad8b' },
  { id: 4, label: 'Temperate broadleaf forests', color: '#b4c49b' },
  { id: 5, label: 'Temperate conifer forests', color: '#9db8aa' },
  { id: 6, label: 'Boreal forests / taiga', color: '#a0b8b7' },
  { id: 7, label: 'Tropical grasslands / savannas', color: '#d2ca9c' },
  { id: 8, label: 'Temperate grasslands', color: '#d7d3a8' },
  { id: 9, label: 'Flooded grasslands', color: '#a9c7b8' },
  { id: 10, label: 'Montane grasslands', color: '#c2b9a3' },
  { id: 11, label: 'Tundra', color: '#c8ccc1' },
  { id: 12, label: 'Mediterranean woodlands / scrub', color: '#c8bf9f' },
  { id: 13, label: 'Deserts / dry shrublands', color: '#e3cfa8' },
  { id: 14, label: 'Mangroves', color: '#88b9ac' },
] as const

export const BIOME_COLOR: ExpressionSpecification = [
  'match',
  ['get', 'biome_id'],
  BIOMES[0].id,
  BIOMES[0].color,
  ...BIOMES.slice(1).flatMap(({ id, color }) => [id, color]),
  '#e5e6dd',
]
