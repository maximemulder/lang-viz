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

The frontend can then be checked with:

```sh
cd app
npm run check
npm run typecheck
npm run build
```
