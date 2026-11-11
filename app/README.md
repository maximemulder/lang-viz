# Language Atlas frontend

Static React client for exploring the geographic distribution and relationships of
the world's languages.

## Development

Use Node.js 24 or newer for development and tests.

```sh
npm install
npm run dev
```

The dev server excludes generated `public/data/` and `public/etymology/` assets from file watching to
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

## Word histories (port preview)

Use the header's **Word histories** workspace to search recorded forms, meanings,
or languages, trace a word, inspect separate word/relationship citations, and
compare expressions for a concept. The lexical code and dataset load on the first
visit; geographic data is not needed to use this workspace. Geography loads on its
first visit and keeps the existing map and camera across workspace switches.

Restore the independently pinned lexical browser bundle from the repository root
once the candidate release has been published:

```sh
python3 -m pipeline.etymology.data_release restore
```

During this local review, the candidate is in
`.data-releases/word-trails-diacl-2026-10-24-v1/`; see the
[release instructions](../pipeline/etymology/README.md#independent-release-delivery)
for offline installation and publication status. To compile from the pinned
sources instead:

```sh
python3 -m pipeline.etymology.sources restore --from-git .
python3 -m pipeline.etymology.build
```

Alternatively, omit `--from-git .` to restore the checksum-pinned sources from their
immutable URLs. See [source and compilation contracts](../pipeline/etymology/README.md).
No source processing runs automatically during npm commands. Deployment restores
the prebuilt lexical and geographic artifacts independently. The lexical response
is decoded, parsed, validated, and indexed in a short-lived worker; the prepared
repository is reused in memory when returning to the workspace. See **About the
data** for the lexical source and CC BY-NC-SA 4.0 notice.

Start `npm run dev` in `app/`, open **Word histories**, and choose **wine**, **water**,
or **tooth**. `/` focuses search; Arrow Down moves into results, Enter traces a form,
and Escape clears search and scope. Graph nodes and links accept Enter/Space.
Selected entries expose **Expand connections**, keeping the 60-form display limit.
**Family comparison** offers collection, concept, family, and missing-entry controls.
Reconstruction, placeholders, missing evidence, and unspecified relationships remain
explicit. A shared concept does not establish cognacy.

For review, customize trail controls, select a link, switch to Geography and back,
then customize comparison filters and repeat. These settings and selected evidence
persist in the session. Graph pan/zoom and the About disclosure are local display
state. Try Back/Forward, refresh, and a direct link such as
`/#workspace=etymology&word=69562&view=history`. A Geography link with a word remains
in Geography on refresh. Malformed links and unknown IDs show diagnostics.
Only workspace, word, view, concept, and collection are encoded in the URL; other
settings reset on reload. Dataset failures show the actual error and a retry in
the affected workspace, while header navigation remains available.

```sh
npm test
npm run test:etymology-snapshot
npm run test:etymology-browser
```

The last two commands require the generated lexical bundle; the browser suite also
uses the existing atlas data and installed Firefox/geckodriver. It runs the
production app with controlled HTTP failures/delays and writes reports/screenshots
under `test-results/etymology-03/browser/`. See [browser checks](tests/browser/README.md).
Use **Show current word trail** to draw the current graph's forms and recorded
relationships on Geography. It focuses the map only on that explicit action;
ordinary workspace switches, style changes, and tracing a different word do not
refocus automatically. **Focus current trail** requests another fit. Reduced-motion
preferences are respected, and newer profile/trail/manual camera actions cancel
older pending moves.

The trail panel lists every displayed form, including overlapping historical stages
and entries without focal points. Markers and **Inspect** buttons select evidence
without changing the trail root or its controls. **Return to exploration** restores
the current view and comparison filters. **Clear word overlay** removes the lexical
layers while preserving pinned polygon entries.

**Add matched language areas** is a separate action through the atlas's normal
pinning pipeline. It uses current source/period filters, geometry overrides, and
own/descendant representation settings. Results distinguish actual additions,
already-present representations, currently unavailable records, and records with
no unique catalog match. Existing comparisons and colors remain intact. Atlas
areas are the chosen dataset representations; focal links are not historical routes.

**Browse word entries** is available in language profiles and pinned map popups.
It uses the represented catalog entry, including aggregates and source-defined
entries. A unique exact Glottocode scopes lexical search; ambiguous or missing
matches leave an explanation and the full search available. It preserves the
current exploration until you explicitly trace another form.

`npm run test:word-trail-browser` checks this integration against production code,
real catalogs, and explicitly labeled coordinate fixtures. Artifact delivery and
performance measurement remain ETY-05 work.

## Language controls

The sidebar has Explore and On map views, with a persistent, collapsible details
pane above them. Clicking a name or pressing Enter inspects it without changing
views or moving keyboard focus. Closing details leaves both selections and the
map intact. More details exposes exact pinned areas, individual color overrides,
source records, available mapped descendants, and a source-variant picker.

Hovering a result, map group, map row, or pinned entry card previews its source
areas with a contrasting outline and halo. Families and other entries with descendants
outline their combined footprint, hiding internal contributor borders while keeping
islands and genuine holes. Keyboard focus provides the same preview.
On an empty map, previews also receive a faint fill. Existing map fills keep their colors.
An open profile keeps its outline until it is closed. Temporary sidebar or map hover
supersedes profile highlighting and leaving restores it. Previewing never adds an
entry or changes coverage geometry.

Clicking a sidebar name or pressing Enter opens the profile and centers its actual
source-area bounds, one zoom level wider than a tight fit and capped at zoom 6 to
show the surrounding region. The existing profile name
can be clicked to refocus after panning. Hover, tab switches, source/period changes,
and manual pans do not recenter. Profile links in map popups keep the current camera.
A newer profile request cancels an older pending move. Unmapped representations show
an explanation and leave the camera still. Reduced-motion preferences are respected.
The lazy `geometry-bounds.json` index is generated by the atlas pipeline and first
loads on an explicit profile action, not on startup or hover.

In **Explore**, checkboxes build a working selection. They do not change the map.
Space toggles the focused result; arrow keys navigate and expand classification
branches. Select all adds all mappable starting results, including those
outside the virtualized list, without selecting expanded children automatically.
Clear selection only clears these checkboxes. The working selection survives
queries, viewport changes, sources, periods, and view switches. Its count includes
entries outside the current results and reports those unavailable with the next
operation's settings.

Sources & period and Search area sit above the search input. Current map searches
filter starting entries by their own or descendant geography; added areas are
never clipped to the viewport. Entries with usable coverage come first. Unmapped
entries remain searchable, expandable, and inspectable. The type of a languoid
remains in details, tooltips, and accessible row labels rather than visible badges.

**Add to map** applies to the complete working selection, including selected entries
outside the current query. Coloring defaults to **Color by hierarchy**; **One color
per group** gives each selected branch its own uniform color. Both choices use the
same coverage: the entry's own area and every mapped descendant, with descendants
replacing overlapping ancestor fills and broader parent coverage retained elsewhere.
The Coverage disclosure offers **Only this entry’s area** for source inspection and
comparisons. Unavailable selections are reported and skipped; they remain selected.
Overlapping selected roots become one branch group. Repeating an addition preserves
existing identities and styles and restores any removed members of the same group.

**On map** lists the resulting groups independently of Explore's settings. Groups
keep their exact source polygons, periods, coverage, and colors. Expand a group to
inspect or remove individual areas, or remove/recolor the whole group. Group controls
switch uniform/hierarchy coloring, choose a base color, or restore automatic color.
Individual overrides take precedence and can be reset in details. Searching by a
member automatically reveals matching areas in collapsed groups. Clear map removes
all groups, even those hidden by its search, without clearing Explore's selection.

To compare sources or periods, keep the working selection, change the geography
filters or a source-variant picker, and add again. Different pinned geometries form
independent groups. An own-area group and a whole-branch group can coexist. Shared
polygons in different groups have independent entry identities, colors, inspection,
and refinement; groups never suppress one another. Identical repeated additions
reuse the existing group, retaining its original context and styling.

Both browsing views retain their queries, expansion, and scroll positions.
Navigation state lives in `src/state/languageControls.ts`; the working selection
and next-operation settings live in `src/state/searchSelection.ts`.
`src/domain/mapGroups.ts` builds and merges pinned groups, while
`src/domain/exploration.ts` applies geography to catalog search results.
Map presentation and advanced palette defaults remain in Map settings.
See [map entries](src/domain/MAP_ENTRIES.md) for the rendering model and compatibility
APIs used by offline preparation and browser fixtures.

The initial basemap uses EOX terrain tiles and needs an internet connection. Language
geometry will be generated by the repository's offline data pipeline and loaded as
static vector tiles.
