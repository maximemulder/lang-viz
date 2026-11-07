# Interactive atlas of the world's languages

The browser application lives in `app/`; its static data is generated from the
downloaded Glottolog and Glottography datasets by the offline Python pipeline.

## Build the proof of concept

```sh
bash ./pipeline/atlas/fetch-sources.sh
uv sync
bash ./pipeline/atlas/bootstrap-tippecanoe.sh
uv run python -m pipeline.atlas.build
cd app
npm install
npm run dev
```

Generated browser artifacts are written to `app/public/data/` and are not
committed. The normalized intermediate geometry is written to `data/processed/`.
External datasets and Tippecanoe are fetched at the exact revisions recorded in
`pipeline/atlas/sources.lock.tsv`.

The searchable catalog includes every Glottolog languoid: families and subfamilies,
languages, and dialects. Search accepts primary and alternative names, ISO codes,
and Glottocodes. Entries without polygons remain searchable; only entries with
areas in the selected sources and period can be selected for display. Each row
and map inspection identifies the classification level.

The pipeline imports the existing Glottography language, family, and dialect
areas, then uses original `features.geojson` polygons for entries not covered by
those prepared layers. Separate original polygons for one languoid are displayed
together as one source variant, without dissolving their boundaries. Explicitly
shared source polygons retain each referenced languoid. No new areas are
aggregated through the classification tree. Geometry variants record their input
file, source feature IDs, and whether they use original or dataset-prepared areas.
Unassigned features are omitted; identifiers absent from the pinned Glottolog
catalog are reported as build warnings. Existing file and vector-layer names
(`languages.json`, `language_areas`) also cover families and dialects; catalog
schema version 3 uses `languoidCount` and `languoidWithGeometryCount`.

The generated geometry catalog preserves four temporal source views:

- contemporary areas from Asher, Wurm and Hattori's Pacific atlas, and Matsumae's
  Northeast Asian dataset;
- Asher time-of-contact areas, with contemporary proxies explicitly marked;
- the DiACL polygon archive's approximate 1750 snapshot;
- Bouckaert's mixed modern-and-ancient Indo-European source view.

Publication years are stored separately from represented geographic periods.
The frontend period selector never substitutes geometry from another period
when the selected view has no area for a language.

Language-area polygons and their catalog are served locally from `app/public/data/`.
Background choices are Plain, Biomes, Terrain, and Satellite. Plain uses
OpenFreeMap water geometry; Terrain uses EOX raster tiles; Satellite uses NASA
Blue Marble via GIBS. Biomes uses a local RESOLVE 2017 vector archive with muted
colors for 14 biome categories; see [its source and rebuild instructions](app/public/basemaps/README.md).
The Google Fonts import is also remote and can be replaced with self-hosted font
files for a fully offline build.

The frontend can then be checked with:

```sh
cd app
npm run check
npm run typecheck
npm run build
```

Pipeline regressions can be checked with `uv run pytest`.

## Overlap rendering

The map defaults to **Alternating stripes**: shared areas cycle through the
colors of all selected languages covering them. Select languages in the language
panel and choose **Alternating stripes** or **Color blending** in Map settings.
Hover and click inspect the displayed regions, including all contributors to an
overlap at the displayed detail level.

**Color intensity** defaults to 82% and can be adjusted between 40% and 100%.
Solid areas and overlap stripes share the same transparency. They are composited
once over the basemap, so transparent stripes do not reveal other language fills
underneath. Adjusting the slider does not recompute geometry.

Overlap geometry is computed in a browser worker from the existing PMTiles
archive, using its simplified vector tiles and a spatial index. There is no
additional geometry export or server. Computation updates after navigation;
tile geometry and overlap results are cached. Multi-language intersections are
partitioned into disjoint regions before drawing, so triple overlaps retain all
three colors rather than stacking pairwise patterns.

This preview uses zoom-dependent map geometry, not full-resolution boundaries
for geographic analysis. It limits viewport work and geometry complexity;
when a limit is reached, a message asks you to zoom in or select fewer languages,
and available coverage remains visible. Loading and errors appear on the map;
**Retry** reuses completed tiles. Single-language regions use native solid fills,
and shared regions use stripe textures. Pattern spacing follows
MapLibre's map-anchored image fills. See the
[implementation notes](app/src/features/map/overlap/README.md) for details.
The [overlap roadmap](OVERLAP_ROADMAP.md) tracks limitations, priorities, and
completion criteria for future sessions.

Run the overlap checks with Node 24 or newer:

```sh
cd app
npm test
```

The real-archive integration test runs when generated atlas data is present;
the synthetic geometry tests run without it.

## Deploy to GitHub Pages

The `Deploy to GitHub Pages` workflow rebuilds all derived atlas data from the
pinned external sources and deploys the Vite application whenever `main` is
pushed. Neither source datasets nor generated browser artifacts are committed or
cached.

Before the first deployment, open the repository's **Settings → Pages** and set
**Source** to **GitHub Actions**. The project site is built with `/lang-viz/` as
its base path and is published at `https://maximemulder.github.io/lang-viz/`.
