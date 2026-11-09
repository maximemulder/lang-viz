# Interactive atlas of the world's languages

The browser application lives in `app/`; its static data is generated from the
downloaded Glottolog, Glottography, and Digital Language Atlas of China datasets
by the offline Python pipeline.

## Build the proof of concept

```sh
bash ./pipeline/atlas/fetch-sources.sh
uv sync
bash ./pipeline/atlas/bootstrap-tippecanoe.sh
uv run python -m pipeline.atlas.build
cd app
npm install
npm run precompute:branches
npm run precompute:parts
npm run dev
```

Generated browser artifacts are written to `app/public/data/` and are not
committed. The normalized intermediate geometry is written to `data/processed/`.
External datasets and Tippecanoe are fetched at the exact revisions recorded in
`pipeline/atlas/sources.lock.tsv`; DLAC's Dataverse files are pinned by file ID and
SHA-256 in `pipeline/dlac/fetch.sh` and fetched by the same source-fetch command.
The atlas build converts DLAC's shapefile automatically. See
[DLAC's mapping and reuse policy](DATASETS.md#44-language-atlas-of-china), including
the conflicting CC0/BY-NC-SA metadata and the conservative noncommercial terms
used for its contribution. The build distributes a source notice beside the data.

The searchable catalog includes every Glottolog languoid: families and subfamilies,
languages, and dialects. It also includes source-defined entries without an
equivalent Glottocode, currently DLAC's Tibeto-Burman, Shaozhou Tuhua, and Danzhou.
These have stable dataset-namespaced IDs, retain the source's labels and scope,
and are identified in Explore, Details, and map inspection. Reviewed parent links
place Tibeto-Burman under Sino-Tibetan, and Shaozhou Tuhua and Danzhou under
Sinitic. Family metadata follows this ancestry. Entries with unresolved broader
affiliations remain roots; existing Glottolog branches keep their parents.
Search accepts primary and alternative names, ISO codes, Glottocodes, and catalog
IDs. Without a query, the compact tree starts at top-level families,
isolates, and other parentless entries. Search ranks direct names and identifiers
before partial matches and lets any languoid start an expandable subtree. An
ancestor's name supplies context rather than matching all its descendants.
Expanding a result shows all its immediate children, including entries without
polygons and names that do not match the query. Counts and bulk selection refer
to starting entries (roots or matches), independently of unfolded descendants.

Glottolog's `values.csv` classification paths supply immediate `parentId` links;
these include intermediate subfamilies and nested dialect groups. The separate
`parentLanguageId` remains the language-level ancestor of a dialect. The details
panel shows clickable ancestry and geographic sources, and "Show in classification"
reveals a result within its full tree. Arrow keys navigate/unfold branches, Home
and End move through the list, and Space toggles the focused entry's map area.

Each row shows its map representation: "Own area" for directly supplied polygons,
"Descendant areas" for an aggregation, "Filtered out" for geography hidden by the
current sources/period, or "No areas" when the entire branch has no polygons.
Entries with both representations have an inline selector; the details panel also
offers this choice. Own areas are the default when available. Otherwise, available
descendant areas make an entry selectable. Selecting an entry remembers its chosen
representation across filter changes; unavailable selections stay checked and can
be removed or switched to the other representation.

Aggregation starts with the entry's children and uses the first available polygon
source down each branch. A mapped child's dialects are not added again. Source and
period filters, and each contributor's geographic-source override, apply before
choosing this frontier. The details panel lists contributors, source provenance,
and uncovered branches; the aggregation represents available coverage, rather
than an inferred complete extent. Geometry is unioned per selected entry in the
map worker and displayed with one color and one checkbox. A contributor can still
be selected separately. Both hatching and blending preserve the grouped coverage.
Large aggregations use the existing geometry budgets and solid-area fallback.

Expansion and map selection are independent; aggregating a family does not check
its descendants individually. Entries without available areas remain searchable
and expandable.

To show an entry and its individually colored descendants, choose **Show branch
on map (N)** in Details, or **Show branches on map (N)** for the current Explore
roots/matches. The action visits collapsed branches and selects every entry with
its own polygon for the chosen sources and period, including mapped ancestors.
Within this branch view, descendants replace ancestor colors only where their
areas overlap. Halh therefore retains its broader area around Dariganga. Sibling
and unrelated-language overlaps remain stripes or blends. Broader fill identifies
geography supplied at that classification level, not an inferred individual language.
Unmapped branches contribute no invented coverage.

The action replaces entries in these branches from the same source/period context;
other comparison contexts stay selected. Entries retain their polygons, colors,
and source provenance, even when descendants fully cover their displayed fill.
Removing a descendant exposes available ancestor fill again. Repeating the action
preserves existing entry identities and colors. Source and period choices affect
the next action; they do not change already pinned entries.

`npm run precompute:branches` optionally prepares complete **single-dataset,
single-period** views at zooms 0–3 from the existing simplified archive. It costs
about two minutes on the development machine and resumes completed tiles. The browser
uses these tiles only for an exact geometry/refinement match.

`npm run precompute:parts` additionally prepares reusable disjoint coverage at
all source zooms for every dataset/period (currently 0–8). Each piece retains every original contributor,
including ancestors hidden in a branch view. Partial branches, child removal,
independent entries and descendant aggregates can therefore reuse the same
geometry: runtime work selects memberships and joins matching shared edges,
without general polygon unions, intersections or differences. Exact full branch
views still prefer the more compact prepared branch tiles. Mixed datasets or
periods, unprepared zooms and missing optional assets use the bounded live engine.
Run both preparation commands again after regenerating atlas data; deployment
runs them automatically. To limit generation, use e.g.
`npm run precompute:parts -- --dataset asher2007world --period contemporary --max-zoom 6`.
Filtered runs preserve other completed profiles and never downgrade higher-detail
preparation. Each completed zoom is published atomically; interrupted runs
resume existing tiles. The generator visits source archive entries rather than
the world grid. Empty areas are recorded in a small availability index instead
of individual files. Indexes and parts load only for the active dataset/period
and viewport; each profile has its own prepared zoom limit (up to source zoom 8).
The default has no dataset-specific exceptions: both Asher periods and every
other profile receive all source levels. The browser can therefore compose
single-profile full views, subsets and aggregates at intermediate zooms without
live polygon overlay. `npm run test:prepared-browser` covers dense Asher regions,
world-to-regional navigation, subsets, both periods, and the other datasets.
When visited tiles consume the receiver's position or pattern budget, offscreen
history is evicted before rejecting visible coverage. This keeps the current
view's detail without increasing the rendering limits; worker caches still
serve return pans.

Original geometry is also split by dataset/period into PMTiles archives. The
browser requests ranges only from archives required by the current browsing
filters and pinned entries. Pinned comparisons retain their original sources
and periods. Source tiles are filtered from the combined archive without changing
their coordinates or simplification; mixed-source tiles are assembled in a worker
before live overlap calculation. The combined archive remains an offline input
and supports older manifests.

Search, hierarchy, availability and source labels remain eager metadata. The
browser uses `geometry-index.json`; full source feature identifiers load per
dataset/period only when **Original source records** is expanded in Details.

Source and period controls live under "Sources & period" in Explore, alongside
search-area scope. They affect geography available to browse and add; existing
map entries retain their pinned sources and periods. Viewport scope limits
starting results, including aggregates with contributing areas in view; expanded
branches still show their full classification children.
Each row and map inspection identifies the classification level.

The pipeline imports the existing Glottography language, family, and dialect
areas, then uses original `features.geojson` polygons for entries not covered by
those prepared layers. Separate original polygons for one languoid are displayed
together as one source variant, without dissolving their boundaries. Explicitly
shared source polygons retain each referenced languoid. The pipeline preserves
source geometry; optional descendant aggregation happens in the browser rather
than creating new dataset records. Geometry variants record their input
file, source feature IDs, and whether they use original or dataset-prepared areas.
Unassigned features are omitted; identifiers absent from the atlas catalog are
reported as build warnings. Existing file and vector-layer names
(`languages.json`, `language_areas`) also cover families, dialects, and source
groups. Catalog schema version 5 adds explicit `classification` provenance:
`{kind: "glottolog", glottocode}` or `{kind: "source", datasetId, label, note}`.
`id` is an opaque catalog key, independent of external identifiers. The schema
retains immediate `parentId` links, `languoidCount`, and `languoidWithGeometryCount`.
Source entries are registered in `pipeline/atlas/source_languoids.json`; adding
one requires a reviewed registry entry and importer assignment. Registry checks
reject duplicate IDs, unknown datasets/parents, and classification cycles.

The generated geometry catalog preserves four temporal source views:

- contemporary areas from Asher, Wurm and Hattori's Pacific atlas, Matsumae's
  Northeast Asian dataset, and DLAC's regional China source (labeled 1985–1987);
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

**Language colors** uses stable genealogy palettes. In Map settings,
**Optimize colors for this view** adapts the palette to the selected polygons on
screen. Prominent and neighboring families receive coherent palettes. Internal
variation follows each family's neighborhood, using available shade differences
to retain broad branch structure in crowded views and expand focused comparisons.
Refresh updates offscreen relatives with the same family palette. Colors remain
fixed while navigating or changing filters. Custom colors are kept;
**Undo colors** and **Use default palette** restore earlier assignments. These
settings last until reload. Defaults and view optimization share the same shade
allocator; fixed catalog evidence keeps defaults stable. Independent evaluation
checks local conflicts and branch contrast at several area scales. See
[the color algorithm, controls, and evaluation commands](app/src/domain/COLORS.md).

Overlap geometry is computed in a browser worker from the existing PMTiles
archive, using its simplified vector tiles and a spatial index. Exact complete
dataset views and same-dataset/period subsets can use the optional prepared coverage described above; no server
is required. Computation updates after navigation;
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
