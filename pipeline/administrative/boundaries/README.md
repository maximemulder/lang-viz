# Administrative boundary view

The optional boundary view uses Natural Earth's **1:50m Admin-0 Countries**
shapefile, version **5.1.1**, from the latest overall Natural Earth release
**5.1.2**. [Natural Earth's download page](https://www.naturalearthdata.com/downloads/50m-cultural-vectors/50m-admin-0-countries-2/)
identifies 5.1.1 as the current version of this particular file. The exact
archive and CLDR 49 territory source are pinned by size and SHA-256 in
[sources.json](sources.json). The build reads the shapefile with pyshp and
produces a 1:50m GeoJSON browser asset with five-decimal coordinates.

Natural Earth draws [de facto boundaries](https://www.naturalearthdata.com/downloads/50m-cultural-vectors/50m-admin-0-breakaway-disputed-areas/)
by default. This is one source viewpoint, with no alternate country-specific
border package. Borders are off by default; the map information control names
the source and viewpoint.

## Geometry and statistical associations

[crosswalk.json](crosswalk.json) lists every CLDR 49 territory code, including
codes without geometry. Each matched feature must agree with Natural Earth's
`ISO_A2_EH` and `ISO_N3_EH` identifiers. The stable feature key uses
`ADM0_A3`, such as `country-LBY`; it does not depend on feature order.
Matches are explicitly reviewed, and geometry remains separate from CLDR
observations.

| Audit result | Count |
| --- | ---: |
| Natural Earth country shapes | 242 |
| CLDR 49 territories | 258 |
| Matched CLDR territories | 236 |
| Ambiguous CLDR territories | 1 (`XK`) |
| Unmatched CLDR territories | 21 |
| Source shapes without a reviewed CLDR match | 5 |

The five unassigned shapes are **Somaliland**, **Kosovo**, **Northern Cyprus**,
**Indian Ocean Territories**, and **Siachen Glacier**. All source shapes retain borders,
label positions, and representative points and can be inspected in Area mode.
They receive no metric fill.
Somalia's `SO` observations are assigned only to the source's Somalia polygon;
they are not copied to Somaliland. Kosovo's `XK` observations remain
searchable, with its separate source polygon documented as ambiguous.

Libya (`LY`), Oman (`OM`), and Kuwait (`KW`) now have both CLDR 49
observations and matched shapes. The old prejoined CSV lacked these territories.
`AU` covers Australia and Ashmore and Cartier Islands. Natural Earth also gives
Indian Ocean Territories the Australian ISO identifier, but the reviewed
crosswalk explicitly excludes that separate shape from Australia's fill. Viewpoint-sensitive
associations retain their notes in the crosswalk and territory detail view.
Natural Earth's Admin-0 countries file does not carry every disputed line as a
separate segment.

Representative points are computed inside each source polygon, never from
language locations. The feature index also stores bounds for the main polygon
around each point, so focusing a mainland shape does not zoom out to distant
islands. Labels use Natural Earth's `NAME` or its shorter `NAME_LONG`,
`LABEL_X/Y`, `MIN_LABEL`, and `LABELRANK`. Minimum label zooms are rounded up
to six integer bands (2–7); MapLibre suppresses collisions. Labels stay
available beyond Natural Earth's `MAX_LABEL`, since this map has no finer
place-name layer. Representative points remain invisible hit targets for tiny
shapes. The browser splits date-line rings before handing GeoJSON to MapLibre.

## Reproduction

Run after restoring the administrative CLDR 49 sources:

```sh
uv run python -m pipeline.administrative.sources restore
uv run python -m pipeline.administrative.boundaries.sources restore
uv run python -m pipeline.administrative.boundaries.build build
uv run python -m pipeline.administrative.boundaries.build verify
uv run pytest -q pipeline/tests/test_administrative_boundaries.py
```

The ignored browser directory `app/public/administrative/boundaries/` contains
`geometry.geojson`, `crosswalk.json`, and `feature-index.json`. The build
verifies their exact bytes and removes the older `geometry.topojson`. The
deployment workflow restores and verifies them before building the frontend.
Natural Earth data are [public domain](https://www.naturalearthdata.com/about/terms-of-use/).

The Plain, Biomes, and Satellite map backgrounds contain no administrative
labels or lines. Terrain uses EOX `terrain_3857` without the separate overlay
that supplies labels and borders; remote raster providers may change tile
contents independently of this repository.
