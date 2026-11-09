# Language Atlas frontend

Static React client for exploring the geographic distribution and relationships of
the world's languages.

## Development

Use Node.js 24 or newer for development and tests.

```sh
npm install
npm run dev
```

The dev server excludes generated `public/data/` assets from file watching to
avoid exhausting OS watcher limits on precomputed coverage tiles. These files
are still served normally. After regenerating data, restart the dev server and
reload the browser to pick up the new assets.

MapLibre is pinned to 6.14.0 for a narrowly scoped tile-retention workaround.
Review `build/maplibreTileRetention.ts` and the overlap lifecycle regressions before
upgrading it; the build deliberately rejects an unreviewed version change.

Other useful commands:

```sh
npm run typecheck
npm run check
npm run build
npm run test:browser
```

See [browser checks and measurements](tests/browser/README.md) for requirements,
repeatable scenarios, output artifacts, and visible-browser runs.

Semantic genealogy palettes are enabled by default. See the
[color infrastructure](src/domain/COLORS.md) for programmatic custom colors,
subtree anchors, comparison roots, categorical mode, and rendering behavior.

## Language controls

The sidebar has two browsing views, with a shared language details pane above them:

- **Explore** searches the catalog and browses its classification. Check an entry
  to pin its current representation, or use the bulk mapped-leaves action. The
  checkbox refers to the representation currently being browsed; the “on map”
  badge counts all pinned representations of that languoid. Click its name (or press
  Enter on a tree row) to inspect it. Arrow keys browse the tree; Space toggles
  its map selection. Entries with usable areas come first, including with an empty
  search. Each group retains relevance order for searches and alphabetical order
  for classification roots. Entries without areas are muted and labeled
  No area; tooltips explain source/period or representation constraints. Expanded
  branches retain their classification order.
  Sources, geographic period, and search-area filters sit above the search field. The
  collapsed Sources & period control retains a summary of the current context.
- **On map** lists pinned representations independently of the Explore query,
  geography filters, and map position. A languoid can appear several times with
  different sources, periods, or own/descendant areas. Its search filters this
  list by language, source, or period. Each entry can be inspected or removed.
  Clear map removes the entire selection, including entries outside this search.

Clicking a name or pressing Enter on a tree row updates the **details pane** without
changing views or taking keyboard focus from the list. The inspected row is
highlighted independently of its map checkbox. Details starts compact, with the
classification path and an add/remove action; **More details** exposes pinned
entries, individual colors, source provenance, representations, contributors, and
uncovered branches. Inspecting a specific On map entry or a pinned map popup shows
that exact representation's source/period context and removal action. The pane
persists across view changes, can be collapsed or closed, and disappears entirely
when no language is inspected. Closing it leaves the map selection intact.

“Representation to add” uses the sources and period in Explore, representation,
and geographic source picker. The add action shows the current context, with a
Change link that opens its filters in Explore. Changing those choices leaves
existing entries intact; identical representations are deduplicated. Show in
classification reveals the inspected languoid's ancestry in Explore.

Explore and On map retain their searches and list positions across view changes.
“Sources & period” filters the areas available to browse and add; existing entries
keep their exact polygons and periods. To compare sources or periods, add a
languoid, change those filters (or its source picker in Details), then add it again.
Mapped-leaf actions replace entries within the chosen branches only for the same
source/period filter context, preserving comparisons added under other contexts.
The search-area control applies only to Explore. Map presentation and color
controls remain in Map settings. Navigation state lives separately in
`src/state/languageControls.ts`; it does not alter selections or geometry.

Text search lives in `src/domain/catalog.ts`. The data repository builds its
normalized name, alias, word, and identifier index once when loading the catalog.
Explore memoizes text matching independently of map position, sources, period,
and selection; On map uses the same matching rules for its selected entries.
`src/domain/exploration.ts` then applies viewport scope and groups starting entries
by their resolved representation's availability, preserving relevance/catalog
order within each group. Hierarchy expansion stays separate from this step.

See [map entries](src/domain/MAP_ENTRIES.md) for the pinned selection model and
state API. Entry colors inherit semantic languoid colors until individually
overridden; choose different entry colors in Details to distinguish comparisons.

The initial basemap uses EOX terrain tiles and needs an internet connection. Language
geometry will be generated by the repository's offline data pipeline and loaded as
static vector tiles.
