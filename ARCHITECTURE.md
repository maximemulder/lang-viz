# Architecture

How the data is prepared and how the app is organised. See [OVERVIEW.md](OVERVIEW.md) for the project summary, [DATASETS.md](DATASETS.md) for the sources, and [VISUALIZATIONS.md](VISUALIZATIONS.md) for the views.

---

## 1. Overview

```
raw datasets ──► converters (Python, offline) ──► internal schema ──► small JSON / TopoJSON ──► web app
 (CLDF, ini,       one per dataset                catalog-ID-keyed                            shared state + views
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
2. **Level mismatches.** Datasets record dialects, languages or groups of varieties. WALS observations remain attached to their exact source varieties; an atlas association is separate and must not roll a value up to a parent language or family. Conflicting variety values remain distinct. See the [WALS contracts](WALS_PORT_PLAN.md#architecture-and-behavior-contracts).
3. **Disagreeing sources.** A language may have several polygons or coordinates. We pick a default (Glottolog coordinates; asher2007world polygons where available) and keep the alternatives for the "compare sources" view. Never merge them silently.
4. **Entries outside Glottolog.** Reviewed equivalents keep Glottocodes. Entries without equivalents use stable dataset-namespaced IDs and explicit source classification provenance. The atlas registry is `pipeline/atlas/source_languoids.json`; reviewed parent links place Tibeto-Burman under Sino-Tibetan and Shaozhou Tuhua/Danzhou under Sinitic. Family and parent-language metadata follow the combined ancestry. Existing Glottolog branches keep their parents; only entries with unresolved broader affiliations remain roots.
5. **Time.** Each dataset has its own notion of time (DiACL date ranges, Glottography map years, *contemporary* / *traditional*). We keep a simple model: every geometry or variety gets an optional start / end year and a layer label. A finer time axis only if a view needs it.
6. **Provenance.** Every row keeps a `source` column, so any value shown in the app can be traced back to its dataset.

---

## 3. Offline data preparation

### 3.1 Internal schema

Everything uses an opaque catalog ID (existing Glottocodes or dataset-namespaced
IDs, rule 4). Catalog schema v5 records `classification` as either
`{kind: "glottolog", glottocode}` or `{kind: "source", datasetId, label, note}`.
External identifier joins must use the explicit Glottocode, not assume every
catalog ID is one. Tables:

| Table | Content |
|---|---|
| `languages` | Catalog ID, classification provenance, name, level (family / language / dialect / group), parent, top-level family, macroarea, countries, coordinates, endangerment, ISO code, time range |
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
- **WALS:** `pipeline/wals/` validates a pinned CLDF snapshot and compiles an independent
  `app/public/wals/features.json` with source records, seven feature definitions,
  categories, observations, references, examples, provenance and source caveats.
  Full source recovery and explicit snapshot checks are separate from ordinary
  tests. The frontend repository and catalog/session contracts are implemented;
  independent release delivery is pinned by `wals-release.json`. Profile cards load
  this supplement on explicit first use. See the
  [schema and commands](pipeline/wals/README.md).
- **Grambank:** a separate CLDF adapter remains future work.
- **DiACL:** CLDF + raw XML / JSON → `forms`, `word_links`, date ranges. The word-history links exist only in the raw files.
- **Glottography:** `pyglottography` for merged polygons at the three levels → `geometries`.
- **Wikidata:** normalized SPARQL extracts → speaker estimates, official status
  and writing systems; preserve statement dates, scope, rank and provenance.
- **Proto-language mapping:** hand-made CSV.

Tools: `pycldf` (reading CLDF; `cldf createdb` for SQLite if useful), `pyglottography`, `mapshaper`.

### 3.3 Exports for the browser

WALS uses a separate, lazy `data/walsRepository.ts` with runtime validation and
source/feature/category/identifier indexes. `integrations/wals/` resolves declared
classification Glottocodes or conservative unique ISO associations against the
complete loaded atlas catalog. Broader family/group scope stays explicit; source
observations are never inherited. WALS source IDs, per-profile variety/feature
choices and the optional overlay specification belong to `features/wals/`, above
component lifetimes. Loading cannot write navigation. Explicit show/focus actions
share the map camera intent with atlas and lexical navigation; inspection opens
associated profiles without moving the map and retains unmatched source evidence
separately. The profile UI publishes the complete ready atlas catalog, independent
of map filters, before resolving associations. Cards retain unknown word-order and
regional comparison slots, select one observed extra deterministically, and reveal
the exact inspected feature. Broader scope and source variety identity remain visible;
citations, version and source errata are available in native disclosures. No WALS
map control or consumer is mounted yet. The separate browser/source release inventories include checksums,
schema/adapter/source versions, producer identity, license and errata. Deployment
restores the verified browser asset without compiling or copying raw sources,
then checks the seven-feature snapshot and current catalog associations together.
See [WALS frontend contracts](app/src/features/wals/README.md) and the
[association review](app/src/integrations/wals/ASSOCIATION_REVIEW.md).

Word histories use an independent lexical schema and release pin
(`etymology-release.json`). The geographic catalog IDs and lexical numeric IDs
remain separate. `pipeline.etymology.data_release` restores a prebuilt browser
bundle, manifest, source pin, and notice; its separate raw archive is retained for
reproduction and omitted from deployment. It never invokes the source adapter
while restoring. CI verifies both dataset pins and runs the explicit lexical
snapshot gate before building. See [lexical delivery](pipeline/etymology/README.md).

On first lexical visit, response bytes transfer to a short-lived module worker
for decoding, parsing, validation, and indexing. The prepared repository returns
through structured clone and is cached above the workspace lifecycle. Errors
remain local and retryable. Search uses a cached numeric collator; no npm lifecycle
hook downloads or preprocesses lexical sources. Worker timings and remaining
handoff cost are recorded by the production browser measurement command.

Lexical navigation lives in a store-scoped session above both workspaces. The graph
and enabled map overlay derive the same bounded trail specification. Geography
stays mounted after its first visit, preserving its map and pinned comparisons.
Shared session/navigation modules contain the data-free contract and reducer.
Lexical resolution and derived trail state belong to `features/etymology/`.
`integrations/etymology/` composes optional map layers and sidebar content through
generic geography slots, and owns catalog matching, area additions, and trail
camera behavior. The map and geography workspace import no lexical implementation;
the integration loads it only when the overlay is enabled.

The URL encodes workspace, root word, view, concept, and collection; other controls
persist only within the session. Explicit trail/profile camera actions share one
current-intent identity, preventing delayed bounds requests from overriding newer
navigation. Lexical area additions resolve identity against the complete catalogs,
then use current atlas availability and normal pinning/deduplication. See
[session and navigation contracts](app/src/state/EXPLORER_SESSION.md).

The current geographic atlas uses:

- `manifest.json`: catalog counts, source archive profiles, prepared coverage profiles and per-profile zoom limits.
- `languages.json`: search, classification, coordinates and geometry availability for the full catalog.
- `geometry-index.json`: geometry variant metadata needed for browsing and selection.
- `geometry-bounds.json`: source-footprint bounds, loaded lazily for explicit profile navigation. Circular longitude arcs keep dateline-crossing areas local.
- `dataset-metadata/<hash>.json`: dataset citations, licenses and default palettes for every period. Colors are arrays aligned to `languages.json`; catalog fingerprints bind their order. This required metadata loads and validates with the catalogs before any dataset is ready. Palette selection then needs no network request. `geography-datasets.json` is its offline description input.
- `geometry/v1-<hash>/<dataset>/<period>.pmtiles`: original source geometry, fetched by HTTP range for viewport tiles. Filters and pinned entries determine which profiles load. Tile-join filters the combined offline archive without re-tiling geometry.
- `coverage-parts/v2-<hash>/<dataset>/<period>/…`: selection-independent prepared MVT parts and a content-addressed availability index. Indexes and tiles load on demand. Complete indexed levels distinguish known-empty tiles from unprepared detail; no empty tile files are required.
- `provenance/<dataset>/<period>.json`: original source filenames and feature IDs, loaded only when requested in Details.

`geometry-variants.json` and `language-areas.pmtiles` remain offline inputs and
compatibility assets. Source rendering, fallback and overlap computation use the
same profile router. Combining source tiles preserves every contributor; it does
not substitute for computing cross-dataset intersections. Prepared indexes are
cached by profile and tile caches remain bounded. Reusable parts cover every
dataset/period through the source archive's maximum client-supported zoom
(currently 8). There are no dataset-specific zoom defaults. Incremental generation
preserves existing profiles and higher zoom levels, publishing each completed
zoom atomically so interrupted fine-detail preparation retains intermediate coverage.
Visited tiles are an optional cache: receiver vertex and pattern-memory pressure
evicts offscreen history before rejecting the visible viewport. Display budgets
remain unchanged and worker caches still support return pans.

Other views may later add these exports:

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

- selected entries (catalog IDs)
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
