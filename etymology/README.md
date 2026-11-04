# Word Trails in Language Atlas

The integrated feature lives in `app/src/features/etymology/`. It is a React
workspace in the existing application, sharing Jotai state, the atlas's visual
style, and Max's MapLibre map. `word-trails/` remains the original standalone
prototype for reference and independent experimentation.

## Run

From `app/`, with Node 24+ and Python 3 installed:

```sh
npm ci
npm run dev
```

Open **Word histories**, or visit `/#word=69562&view=history` for the English
**wine** example. For a GitHub Pages build, use
`/lang-viz/#word=69562&view=history`.

`predev`, `pretest`, and `prebuild` generate the lexical browser data automatically.
You can also regenerate it with `npm run data:etymology`. All input paths are
relative to this checkout, so teammates and CI do not need the original author's
Downloads folder. No network or Python packages are required for this step.

Max's geographic pipeline is separate; follow the repository README to generate
its catalog and PMTiles. Word histories and their focal-point overlay work without
those files. Adding polygon areas and opening words from pinned map inspectors need
the generated geographic catalog. The terrain basemap requires a connection, as
it does in the original atlas.

## Explore across the two workspaces

- Search forms, meanings, or lexical languages; select a result to trace it.
  `/` focuses search; arrow keys navigate results and Enter chooses a form.
- Inspect a graph node for word-entry evidence, or a connection for relationship
  evidence. Trace another entry, expand neighbors, adjust depth, or show placeholders.
- Compare all recorded forms for a concept by family and major branch. Multiple
  synonyms remain separate; missing entries can be shown explicitly.
- Choose **Show on atlas** to display the current graph's representative language
  locations and color-coded connections on Max's map. The sidebar lists locations
  separately so overlapping historical stages remain accessible.
- **Add matched language areas** adds available polygons to the existing atlas
  selection, respecting its period and geographic-source filters.
- **Explore word entries** in a pinned polygon inspector opens that language's lexical entries when a unique exact
  Glottocode match exists. If there is no unique exact match, the explorer explains
  the gap and leaves the full lexical search available.

## Data and boundaries

The five supplied data files live in `etymology/data/`:

- `language-tree.json`
- `languages.csv`
- `lexical-database.json`
- `typodataset-350.json`
- `wordlists.json`

The native adapter reads `data/lexical-database.json` and `data/language-tree.json`.
The word-list/concept hierarchy comes from the lexical export's matching
`WordLists` and `ConnectedLexemes`; `languages.csv`, `wordlists.json`, and the
Austronesian grammar export are retained as supplied but do not infer word links.

`pipeline/etymology/build.py` validates relationship endpoints, concept membership,
and source references, then produces `app/public/etymology/word-trails.json`:
74,635 words, 46,351 relationships, 466 lexical language records (about 21.8 MB
uncompressed). Generated data is ignored by Git and copied into the production
build. The React explorer and lexical data are loaded on demand; a cached
repository indexes incoming/outgoing links, concepts, languages, and normalized
search text for subsequent visits in the same page.

Atlas IDs are Glottocodes; DiACL IDs stay in their own namespace. Forward joins use
an explicit Glottocode first. Only records without a Glottocode may fall back to
an ISO code, and only when that code is unique on both sides. An explicit but
unmatched Glottocode is never replaced with another language sharing an ISO code.
Proto-languages with no atlas match retain their own DiACL focal point and graph
entry; no polygon or family identity is invented. Reverse navigation from a pinned atlas inspector
requires a unique exact Glottocode match.

Graph depth counts recorded relationships, not elapsed years. Each graph is capped
at 60 forms; hiding placeholders interrupts paths without inventing shortcut
edges. Cycles and multiple parents remain representable. Family comparison does
not imply cognacy. Incoming relationship counts are not borrowing rates.

Map connections join language focal points, not precise historical transmission
routes; they are split at the antimeridian. Relationship direction and evidence
are inspected in the graph. Coordinates missing from the export are omitted from
the map and reported, while their words remain in the graph. Geographic time/source
filters describe polygon coverage and do not filter or date lexical relationships.

## Implementation map

- `pipeline/etymology/build.py`: reproducible static-data build and join validation.
- `app/src/domain/etymology.ts`: typed records, graph traversal, indexing, search,
  and conservative atlas matching.
- `app/src/data/etymologyRepository.ts`: on-demand loading, caching, and retry.
- `app/src/state/explorerState.ts`: workspace, focus, language request, map overlay.
- `app/src/features/etymology/`: graph, comparison, evidence inspector, and shared-map
  overlay. Word links do not enter the polygon/overlap computation pipeline.
- `app/tests/etymology.test.ts`: real wine chain and references, identifier matching,
  placeholders, cycles, multiple parents, graph cap, search, and map geometry.

Source attribution and the original prototype's limitations are documented in
[word-trails/README.md](word-trails/README.md). Generated standalone `data.js` and
`OPEN-ME.html` are also ignored to avoid committing duplicate dataset copies;
`rebuild-data.py` and `package-offline.py` can regenerate them.
