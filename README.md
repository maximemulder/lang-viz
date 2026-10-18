# Interactive atlas of the world's languages

The browser application lives in `app/`; its static data is generated from the
downloaded Glottolog and Glottography datasets by the offline Python pipeline.

## Build the proof of concept

```sh
uv sync
./pipeline/atlas/bootstrap-tippecanoe.sh
uv run python -m pipeline.atlas.build
cd app
npm install
npm run dev
```

Generated browser artifacts are written to `app/public/data/` and are not
committed. The normalized intermediate geometry is written to `data/processed/`.

The generated geometry catalog preserves four temporal source views:

- Asher contemporary areas;
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
