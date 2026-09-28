# Visualizations

The views of the app and how they interact. See [OVERVIEW.md](OVERVIEW.md) for the project summary, [DATASETS.md](DATASETS.md) for the data behind each view, and [ARCHITECTURE.md](ARCHITECTURE.md) for the shared state that links them.

---

## 1. Principles

- **Linked views.** All views read from and write to one shared state: selected languages, filters, active feature, time, map layer. Any selection in one view is reflected in all the others.
- **Exploration, not a fixed story.** Users should be able to start from any view: a language name, a place, a family, or a grammatical feature.
- **Show what is missing.** Coverage is very uneven across datasets and regions. Missing data is always visible (e.g. greyed out and counted), never silently dropped.
- **Show uncertainty.** Language borders are interpretations, and sources disagree. Polygons are drawn with transparency or soft edges, and their source is always available.

---

## 2. Core views (must have)

### 2.1 Language finder (entry point)

With ~8,600 languages, 13,000+ dialects and uneven data across datasets, users need a direct way to find a language and see what we know about it. Without one, the other views are hard to navigate.

- **Search** by name, alternative names (Glottolog lists names in many languages, e.g. *Anglais*, *現代英語*), Glottocode or ISO 639-3 code. Results show name, family and macroarea, to tell apart languages with similar names.
- **Filters:** family, macroarea, country, endangerment status, level (language / dialect), and "has data in…" (WALS, Grambank, DiACL, polygon, …).
- **Data availability at a glance:** each row carries small badges or bars showing what exists for that language, e.g. number of WALS features, word forms in DiACL, polygon yes / no, number of sources. This is also the most honest way to show how uneven the data is.
- **Detail panel** for the selected language: its classification path (clickable into the tree), alternative names, endangerment, the datasets it appears in, and links out (Glottolog, WALS, Wikipedia).
- **Connected to the shared state:** selecting languages (single or multiple, or the whole filtered list) highlights them on the map and tree and adds them to the feature and word views. The reverse also works: selecting a region or a clade elsewhere filters the list.
- Implementation: a search index built offline (names + alternative names + codes) and loaded in the browser with a client-side search library (e.g. MiniSearch or Fuse.js). Alternative names make the index larger, so it may be loaded after the rest of the app, or limited to the most common names.

### 2.2 World map (central view)

- Language territory polygons (Glottography), with Glottolog points as fallback for the ~35% of languages without one.
- Family-area polygons when zoomed out, language areas when zoomed in.
- Colour by family, endangerment status, or the value of the currently selected feature.
- Borders drawn as uncertain (transparency, soft edges, source on hover). Clicking a location lists all languages spoken there, since areas overlap.
- Toggle between *contemporary* and *traditional* (time-of-contact) layers, which shows the effect of colonisation in the Americas and Australia.
- Historical and proto-languages shown as points (DiACL coordinates and date ranges), or as bouckaert2012 polygons for ancient Indo-European languages.
- Brushing a region selects its languages in every view.

### 2.3 Family tree navigator

- Glottolog classification as a collapsible tree, sunburst or icicle. The tree is large (27,254 nodes, up to 27 levels), so it starts collapsed at family level and expands on demand.
- Selecting a node selects all its languages in every view.
- Nodes can be annotated with feature values, share of endangered languages, or data coverage.
- The path from the root to the selected language is always visible, so the tree also works as a breadcrumb for the finder and map.

### 2.4 Feature explorer (WALS, possibly Grambank)

- Choose a feature (e.g. order of subject, object and verb) and see its values on the map and the tree: does it cluster by region or by family?
- Distribution of values for the current selection vs. the whole world (bar chart), including a "no data" bar.
- **Feature × feature co-occurrence heatmap**, e.g. verb–object order vs. adposition order. This shows Greenberg's word-order correlations: pairs of properties that tend to go together across languages.
- The share of missing data is always shown. Comparisons can be restricted to the WALS 100 / 200-language samples, which are much denser.

---

## 3. Extensions (as time allows, roughly by priority)

1. **Typological similarity space.** A 2D projection (MDS or UMAP) of languages by grammatical distance, linked to the map and tree. Are languages that are grammatically close also close geographically or genealogically? Needs care with missing data (distance computed only on shared features, with a minimum overlap).
2. **Word journeys (DiACL).** Pick a concept (*wine, wheel, horse, gold*) and draw its word history as flows on the map, from proto-languages to modern languages. Inherited and borrowed words are coloured differently, with a time slider driven by the date ranges. Coverage is Eurasia and the Pacific only.
3. **Compare sources.** Overlay the different polygons given for one language by different atlases (e.g. Bengali has 4 sources in Glottography), showing that language borders are interpretations.
4. **Endangerment and documentation.** Endangerment status vs. number of sources per language, family or region: which endangered languages are also poorly described?
5. **Sound inventories (PHOIBLE):** number and type of consonants and vowels, on the map and per family.
6. **Loanwords (WOLD):** which meanings are most often borrowed, and from which languages.
7. **Speaker counts (Wikidata):** point size or polygon emphasis by number of speakers; filter by official status.

---

## 4. Interaction summary

| Action in… | Effect elsewhere |
|---|---|
| Finder: select / filter languages | Highlighted on map and tree; added to feature and word views |
| Map: brush region / click location | Finder filtered; tree nodes highlighted; feature charts show the region's distribution |
| Tree: select a node | All its languages selected; map zooms to their area |
| Feature explorer: choose a feature | Map and tree coloured by its values |
| Feature explorer: click a value / heatmap cell | Languages with that value (or pair of values) selected everywhere |
| Time slider / layer toggle | Map layer and word-journey view updated |
