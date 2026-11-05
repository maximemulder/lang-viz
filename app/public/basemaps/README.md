# Biome background

## Settings thumbnails

`previews/{plain,biomes,terrain,satellite}.webp` show the same western-central Africa crop from
the application's four basemaps, without overlays or color adjustments. They
were rendered at 256 × 256 pixels in Mercator, centered on `[5, 9]` at zoom
`2.3`, then resized to 128 × 128 for compact local WebP assets. The crop includes
the Sahara, Gulf of Guinea, and the savanna–Congo rainforest transition.

Plain uses OpenFreeMap / OpenMapTiles / OpenStreetMap geography; Biomes uses
RESOLVE 2017 (CC BY 4.0); Terrain uses EOX's terrain rendering (OpenStreetMap
and other contributors); Satellite uses NASA Blue Marble via GIBS. The map
displays provider attribution. Regenerate these previews if their styles change.

## Biome data

`biomes.pmtiles` is a locally served, generalized vector basemap derived from
**RESOLVE Ecoregions 2017**, Dinerstein et al.,
[An Ecoregion-Based Approach to Protecting Half the Terrestrial Realm](https://doi.org/10.1093/biosci/bix014).
The source is licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
See the [dataset catalog](https://developers.google.com/earth-engine/datasets/catalog/RESOLVE_ECOREGIONS_2017).
Attribution is also displayed on the map when this background is selected.

The 847 features supplied by the service are grouped by the 14 `BIOME_NUM`
categories. Feature IDs and ecoregion boundaries are not presented to the user.
The runtime palette and legend are in `src/features/map/biomes.ts`.
This is an ecological reference, not a reconstruction of historical environments
or a current land-use map. Areas without biome coverage retain neutral land.

## Rebuild

From the repository root, download the generalized GeoJSON from the published
RESOLVE feature service, then use the existing Tippecanoe installation:

```sh
curl --fail --location 'https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/Resolve_Ecoregions/FeatureServer/0/query?where=1%3D1&outFields=BIOME_NUM%2CBIOME_NAME&outSR=4326&f=geojson&maxAllowableOffset=0.02&geometryPrecision=4&resultRecordCount=2000' --output /tmp/resolve-biomes.geojson
uv run python -m pipeline.atlas.build_biomes /tmp/resolve-biomes.geojson
```

The download used on 2026-11-06 had SHA-256:
`5c8bca87814a3f15fb73a41acf05beea9026673d7367ecaab9a3be1b77c21ba6`.

The pipeline keeps the biome category, coalesces equivalent features, and builds
zoom levels 0–6 with shared-border simplification. Closer views overzoom the last
level. This avoids downloading and parsing the full 23 MB source in the browser;
PMTiles retrieves only the tiles needed for the current view. The archive ships
with the application and is independent of the language-data build.
