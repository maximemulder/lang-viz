import { Layer } from 'react-map-gl/maplibre'

/** Progressive geography from the existing OpenFreeMap/OpenMapTiles source.
 * Country outlines retain the separately reviewed Natural Earth geometry.
 */
export function AdministrativeZoom() {
  return (
    <>
      <Layer
        id="region-state-borders"
        type="line"
        source="minimal-geography"
        source-layer="boundary"
        minzoom={4}
        filter={['all', ['==', ['get', 'admin_level'], 4], ['!=', ['get', 'maritime'], 1]]}
        paint={{
          'line-color': '#69786d',
          'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.4, 9, 1.1],
          'line-opacity': 0.75,
        }}
      />
      <Layer
        id="region-district-borders"
        type="line"
        source="minimal-geography"
        source-layer="boundary"
        minzoom={8}
        filter={[
          'all',
          ['in', ['get', 'admin_level'], ['literal', [6, 7, 8]]],
          ['!=', ['get', 'maritime'], 1],
        ]}
        paint={{
          'line-color': '#7d877f',
          'line-width': 0.65,
          'line-opacity': 0.65,
          'line-dasharray': [2, 2],
        }}
      />
      {[
        { id: 'states', min: 4, max: 10, classes: ['state', 'province'] },
        { id: 'cities', min: 5, max: 24, classes: ['city'] },
        { id: 'towns', min: 8, max: 24, classes: ['town'] },
        {
          id: 'localities',
          min: 11,
          max: 24,
          classes: ['village', 'suburb', 'quarter', 'neighbourhood'],
        },
      ].map(({ id, min, max, classes }) => (
        <Layer
          key={id}
          id={`region-place-${id}`}
          type="symbol"
          source="minimal-geography"
          source-layer="place"
          minzoom={min}
          maxzoom={max}
          filter={['in', ['get', 'class'], ['literal', classes]]}
          layout={{
            'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name_en'], ['get', 'name']],
            'text-font': ['Arial', 'sans-serif'],
            'text-size': id === 'states' ? 12 : 13,
            'text-padding': 6,
            'text-max-width': 9,
            'symbol-sort-key': ['coalesce', ['get', 'rank'], 20],
          }}
          paint={{ 'text-color': '#233d34', 'text-halo-color': '#fffdf5', 'text-halo-width': 1.8 }}
        />
      ))}
    </>
  )
}
