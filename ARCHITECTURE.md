# Architecture

How the data is prepared and how the app is organised. See [OVERVIEW.md](OVERVIEW.md) for the project summary, [DATASETS.md](DATASETS.md) for the sources, and [VISUALIZATIONS.md](VISUALIZATIONS.md) for the views.

---

## 1. Overview

```
raw datasets ──► converters (Python, offline) ──► internal schema ──► small JSON / TopoJSON ──► web app
 (CLDF, ini,       one per dataset                Glottocode-keyed                            shared state + views
  XML, GeoJSON)
```

Two parts:

- **Offline data preparation** (Python): turns every dataset into one internal schema, then exports compact static files.
- **Front end** (browser only): loads those files. No server or database is needed at run time.

The key rule: **the front end only knows the internal schema, never the original datasets.** Adding a dataset means writing a new converter; the views do not change.

---

## 2. Integration rules

The datasets share a format (CLDF) and a key (Glottocode), so format conversion is easy (see [DATASETS.md](DATASETS.md#5-how-the-datasets-link)). The real work is deciding what counts as the same thing. These are the rules to agree on:

1. **Features with similar meaning are not directly comparable.** WALS and Grambank ask similar but not identical questions, with different value sets. We use one main source per topic and do not merge them.
2. **Level mismatches.** Datasets record dialects, languages or groups of varieties. Data is rolled up to language level via the Glottolog tree (dialect → parent language). If two dialects of one language disagree, we keep both values and flag the conflict.
3. **Disagreeing sources.** A language may have several polygons or coordinates. We pick a default (Glottolog coordinates; asher2007world polygons where available) and keep the alternatives for the "compare sources" view. Never merge them silently.
4. **Languages outside Glottolog.** Proto-languages and some historical varieties (51 in DiACL) get a hand-made mapping table to Glottolog family nodes, or an internal ID if no match exists.
5. **Time.** Each dataset has its own notion of time (DiACL date ranges, Glottography map years, *contemporary* / *traditional*). We keep a simple model: every geometry or variety gets an optional start / end year and a layer label. A finer time axis only if a view needs it.
6. **Provenance.** Every row keeps a `source` column, so any value shown in the app can be traced back to its dataset.

---

## 3. Offline data preparation

### 3.1 Internal schema

Everything keyed by Glottocode (or internal ID, rule 4). Tables:

| Table | Content |
|---|---|
| `languages` | Glottocode, name, level (family / language / dialect), parent, top-level family, macroarea, countries, coordinates, endangerment, ISO code, time range |
| `names` | Alternative names (for search) |
| `features` | Feature definitions: ID, name, area, possible values, source (WALS / Grambank / …) |
| `values` | Language × feature → value, source |
| `concepts` | Concept ID (Concepticon), gloss |
| `forms` | Word forms: language, concept, form, source |
| `word_links` | Parent form → child form, link type (inherited, borrowed, …) |
| `speaker_estimates` | Language, count, date, speaker scope, place, rank, provenance |
| `official_status` | Language, jurisdiction, subnational scope, time range, rank, provenance |
| `writing_systems` | Language × writing system |
| `geometries` | Polygon, level (feature / language / family), layer (contemporary / traditional / historical), year, source |
| `availability` | Per-language summary: number of features, forms, polygons, sources, … (computed) |

### 3.2 Converters

One script per dataset:

- **Glottolog:** from glottolog-cldf (preferred) or the `languoids/tree` `.ini` files → `languages`, `names`.
- **WALS / Grambank:** CLDF → `features`, `values`.
- **DiACL:** CLDF + raw XML / JSON → `forms`, `word_links`, date ranges. The word-history links exist only in the raw files.
- **Glottography:** `pyglottography` for merged polygons at the three levels → `geometries`.
- **Wikidata:** normalized SPARQL extracts → speaker estimates, official status
  and writing systems; preserve statement dates, scope, rank and provenance.
- **Proto-language mapping:** hand-made CSV.

Tools: `pycldf` (reading CLDF; `cldf createdb` for SQLite if useful), `pyglottography`, `mapshaper`.

### 3.3 Exports for the browser

- `languages.json`: compact table of all languages with the fields the views need.
- `tree.json`: the Glottolog classification (possibly split per family and loaded on demand).
- `features/…json`: feature definitions and values, possibly one file per feature.
- `search-index.json`: names, alternative names and codes for the language finder.
- `availability.json`: per-language data counts for the finder's badges.
- `geo/…topojson`: polygons simplified with mapshaper, one file per level / layer, so zoomed-out views load only family areas.
- `diacl/…json`: forms and word links per concept, loaded on demand.

Target: a first load of a few MB; everything else loaded when needed.

---

## 4. Front end

### 4.1 Shared state

One central store holds:

- selected languages (set of Glottocodes)
- active filters (family, macroarea, country, endangerment, "has data in…")
- active feature (and second feature for the heatmap)
- time / map layer
- hovered language (for cross-view highlighting)

Every view subscribes to the store and dispatches changes to it. **Views never talk to each other directly**, so a new view only needs to be connected to the store.

### 4.2 Stack (to decide early)

- **D3** for the tree, heatmap, charts and custom views.
- **Map:** thousands of polygons need either a WebGL library (**MapLibre GL** or **deck.gl**) or D3 + TopoJSON with level-of-detail by zoom. A quick performance test with the real polygons should decide this in the first week.
- **Search:** MiniSearch or Fuse.js.
- Framework for layout and state: open (plain JS with a small store, or a light framework such as Svelte or Vue).
- Hosting: static files (e.g. GitHub Pages).

---

## 5. Proposed repository layout

```
datasets/          downloaded datasets (already in place; not committed, or as git submodules)
data/processed/    exported JSON / TopoJSON
pipeline/          Python converters and export scripts
app/               front end
docs/              report, figures
```
