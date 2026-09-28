# Project overview: an interactive atlas of the world's languages

*COMP6411D group project: proposal draft*

| Document | Content |
|---|---|
| [DATASETS.md](DATASETS.md) | Every dataset: content, figures, caveats, download commands, how they link, licences |
| [VISUALIZATIONS.md](VISUALIZATIONS.md) | Core views, extensions, and how the views interact |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Data preparation, integration rules, internal schema, front-end structure |

---

## 1. Idea

Build a set of **linked web visualizations** for exploring the world's languages from three angles:

- **Where** they are spoken, today and in the past (map).
- **How they are related** (family tree).
- **How they differ** in grammar, sounds and vocabulary (feature and word explorers).

All views share one selection state. Selecting a family in the tree highlights its territory on the map. Picking a grammatical feature recolours both the map and the tree. Brushing a region filters the feature charts. Throughout, the goal is interactive exploration, not a fixed story.

The plan is a **solid core of four views**, plus **optional extensions** added as time allows. The architecture is designed so that adding a view or a dataset does not require rewiring the existing ones.

---

## 2. Data in brief

→ Details in [DATASETS.md](DATASETS.md)

| Dataset | Role | Scale |
|---|---|---|
| **Glottolog** (downloaded) | Backbone: catalogue, family tree, points, endangerment | 8,625 languages, 13,758 dialects, 4,871 families |
| **WALS** (downloaded) | Grammatical features | 192 features × 2,662 languages; only 11% filled |
| **DiACL** (downloaded) | Vocabulary and word histories, incl. historical and proto-languages | 422 varieties, 60k word forms, 47k word-history links; mostly Eurasia and Pacific |
| **Glottography** (3 repositories downloaded) | Language territory polygons | Downloaded sets cover 54% of Glottolog languages, ~75% of WALS and DiACL languages, but only 37% in Eurasia; contemporary and traditional layers |
| Grambank, PHOIBLE, WOLD, Lexibank, Wikidata (candidates) | Denser grammar data, sounds, loanwords, word lists, speaker counts | — |

All datasets link via the **Glottocode** (Glottolog's language ID), and all except Wikidata use the same **CLDF** format. Format conversion is easy; the real work is deciding what counts as the same thing across datasets (see [ARCHITECTURE.md](ARCHITECTURE.md#2-integration-rules)).

---

## 3. Visualizations in brief

→ Details in [VISUALIZATIONS.md](VISUALIZATIONS.md)

**Core**

1. **Language finder**: search and filter all languages; shows what data exists for each one; entry point to all other views.
2. **World map** (central view): territory polygons with points as fallback; coloured by family, endangerment or feature value; contemporary / traditional layers.
3. **Family tree navigator**: Glottolog classification; selecting a node selects its languages everywhere.
4. **Feature explorer**: one feature on map and tree; feature × feature co-occurrence heatmap; missing data always visible.

**Extensions**, roughly by priority: typological similarity space, word journeys (DiACL), compare sources, endangerment vs. documentation, sound inventories, loanwords, speaker counts.

---

## 4. Architecture in brief

→ Details in [ARCHITECTURE.md](ARCHITECTURE.md)

```
raw datasets ──► converters (Python, offline) ──► internal schema ──► small JSON / TopoJSON ──► web app
                   one per dataset                Glottocode-keyed                            shared state + views
```

- One converter per dataset, all producing the same Glottocode-keyed schema.
- Static files only; no server.
- One shared state in the browser; views never talk to each other directly.

---

## 5. Expected work

Effort figures are rough, for one person, and to be revised after the first data checks.

| Phase | Content | Estimate |
|---|---|---|
| **0. Data checks** | ~~Download Glottography datasets; measure polygon coverage~~ (done, see [DATASETS.md](DATASETS.md#41-description)); compare Grambank vs. WALS density; map library performance test | 1–2 days |
| **1. Data pipeline** | Internal schema; converters for Glottolog, WALS, Glottography; DiACL raw rebuild (word links + dates); geometry simplification; proto-language mapping | ~1 week |
| **2. App skeleton** | Front-end setup, shared state, data loading, layout | 2–3 days |
| **3. Core views** | Language finder, map, family tree, feature explorer, all linked | 2–3 weeks (can be parallelised: one person per view; the finder is the lightest and is useful first for testing the shared state) |
| **4. Extensions** | Picked from the extension list by priority and remaining time | Open-ended |
| **5. Polish and report** | Legends, tooltips, performance, accessibility, write-up, demo | ~1 week |

Phase 1 must produce a stable schema before phase 3 starts, so the views can be built in parallel.

---

## 6. Risks and open questions

| Risk / question | Mitigation |
|---|---|
| WALS sparsity makes comparisons misleading | Focus on well-covered features or the 200-language sample; consider Grambank; always show missing data |
| Polygon gaps (Eurasia only 37% covered) | Points fallback; add grierson1903lsi / wurm1981pacific if needed |
| Browser performance with thousands of polygons | Simplification, TopoJSON, level-of-detail by zoom, WebGL map library |
| Polygons suggest false precision | Visual encoding of uncertainty; show sources |
| Time handled differently in each dataset | Keep the time axis simple (contemporary / traditional / DiACL periods) unless a view needs more |
| Licences | CC-BY everywhere except wurm1981pacific (CC-BY-NC); attribute every dataset in the app |

**Open questions for the group**

- WALS or Grambank as the main grammar source?
- Map library choice (D3-only vs. MapLibre / deck.gl)?
- Which extension first: similarity space or word journeys?
