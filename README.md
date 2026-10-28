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
The physical basemap is currently the only map layer fetched from the network:
it uses EOX's global raster tile service. A self-hosted raster pyramid is practical
at low zooms, but grows by roughly four times for every additional zoom level;
production deployments should either package only the required zooms/regions or
use a dedicated local vector-basemap archive. The Google Fonts import is also
remote and can be replaced with self-hosted font files for a fully offline build.

The frontend can then be checked with:

```sh
cd app
npm run check
npm run typecheck
npm run build
```

## Overlap hatching proof of concept

The map defaults to **Alternating stripes**: shared areas cycle through the
colors of all selected languages covering them. Use **Try Britain example** to
select English, Welsh, Scottish Gaelic, and Irish from the same contemporary
Asher source and fly to their areas. The **Color blending** option provides the
previous rendering for comparison. Hover and click still inspect the original
language polygons, including all contributors to an overlap.

**Color strength** defaults to 82% and can be adjusted between 40% and 100%.
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
and the ordinary language fills remain visible. Pattern spacing follows
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
