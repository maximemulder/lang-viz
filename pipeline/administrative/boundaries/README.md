# Administrative boundary view: ADM-02

This is a separately versioned, opt-in presentation source. It does not add
territory shapes, border IDs, or political labels to the CLDR observation asset.
The first view uses `world-atlas` **2.0.2** `countries-50m.json` (756,420 bytes),
derived from Natural Earth **4.1.0** Admin-0 countries at 1:50m. Its topology
SHA-256 is pinned in [sources.json](sources.json), as are the npm archive
integrities. The source branch used the same package version and the
`iso-3166-1` **2.1.1** numeric-code lookup. Both packages are fetched at build
time into ignored `data/administrative/boundaries/`; the 1:50m TopoJSON is
small enough to serve directly, so this view does not need vector tiles.

The default Natural Earth Admin-0 data reflects a source worldview, including
de facto control choices. [Natural Earth describes its breakaway and disputed
areas](https://www.naturalearthdata.com/downloads/50m-cultural-vectors/50m-admin-0-breakaway-disputed-areas/).
`world-atlas` preserves country names and ISO numeric IDs where available, but
it does not carry a separate disputed-segment layer. This view must be labeled
as **Natural Earth 4.1.0 / world-atlas 2.0.2**, with borders off by default.
The crosswalk flags viewpoint-sensitive territory associations. The map uses
one outline style for all features, identifies the source viewpoint in its
legend, and shows relevant crosswalk notes when a territory is selected. It
must not claim that all disputes can be shown as distinct lines with this
source. This package contains no alternative country-specific border view.
The static GitHub Pages deployment supplies no client-country signal, so the
map cannot make a location-aware view choice at present.

## Explicit association policy

[crosswalk.json](crosswalk.json) lists all 251 CLDR territory codes from the
pinned joined CSV, independently of their language values. A `matched` entry
names every source feature ID assigned to that code. `ambiguous` entries list
candidates but receive **no metric fill**; `unmatched` entries have no polygon.
`unassignedFeatureIds` inventories all source geometries without a matched
CLDR observation. Source feature IDs are stable `country-000` ordinal keys into
this exact TopoJSON. The source's numeric ISO ID remains a separate field.
Swapping the view requires a new pin and reviewed crosswalk, not a change to
the CLDR supplement.

| Audit result | Count |
| --- | ---: |
| Source geometries | 241 |
| CLDR territories with explicit numeric matches | 230 |
| Ambiguous CLDR territories | 1 (`XK`) |
| Unmatched CLDR territories | 20 |
| Unassigned source geometries | 10 |

The unassigned shapes are Somaliland, Oman, Libya, Kuwait, Kosovo, Northern
Cyprus, Indian Ocean Territory, Heard and McDonald Islands, Siachen Glacier,
and Antarctica. The unnumbered shapes are not silently merged into adjacent
statistical territories. The source contains two numeric `036` geometries,
Australia and Ashmore and Cartier Islands; `AU` explicitly maps to both. `XK`
retains the unnumbered Kosovo geometry as a candidate and cannot receive a
fill. `PS`, `TW`, `EH`, and other salient matches carry `viewpointSensitive`
flags and notes. The 14 ISO-coded CLDR territories without a source feature,
plus six special CLDR codes without an ISO numeric mapping, stay searchable
without geometry. Five source numeric features have no CLDR observation.

Representative points are computed from the largest usable polygon in each
feature and validated to lie inside it. The converter handles the source's
antimeridian topology; Fiji uses its largest non-wrapping island, while Russia
uses a repaired main polygon for its marker. Points identify **geometry
features**, not language locations or territorial population centers.

## Browser assets and reproduction

Run after the ADM-01 source restore:

```sh
uv run python -m pipeline.administrative.boundaries.sources restore
uv run python -m pipeline.administrative.boundaries.sources verify
uv run python -m pipeline.administrative.boundaries.build build
uv run python -m pipeline.administrative.boundaries.build verify
uv run pytest -q pipeline/tests/test_administrative_boundaries.py
```

The ignored browser directory `app/public/administrative/boundaries/` has three
assets: `geometry.topojson` (source bytes), `crosswalk.json` (reviewed
associations), and `feature-index.json` (feature IDs, source names/IDs, points,
manifest, provenance, hashes, and coverage). The build verifies all inputs and
the exact output bytes. Deployment restores and verifies these assets before
building the frontend. Neither the source files nor browser assets are added
to Git; only pins, code, and the reviewed crosswalk are tracked.

Attribution: [Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/)
data are public domain; [`world-atlas` 2.0.2](https://github.com/topojson/world-atlas)
is ISC; [`iso-3166-1` 2.1.1](https://www.npmjs.com/package/iso-3166-1) is MIT.

## Basemap audit for the border-off state

The current Plain and Biomes styles render physical water, coast, river, and
biome layers, with no administrative layer or place-label layer. Satellite
uses NASA Blue Marble imagery, without vector labels. Terrain uses EOX
`terrain_3857` **without** the separate EOX overlay; [EOX documents](https://maps.eox.at/)
that its overlay supplies labels and line features such as borders. Raster
providers can change tile contents independently of this repository, so that
last guarantee is based on EOX's documented layer design, not a locally pinned
tile snapshot. ADM-05 must not add EOX's overlay when borders are off.
