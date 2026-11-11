# Etymology port plan

Last updated: 2026-11-11.

This is the execution checklist for bringing Word Trails from `feature/etymology`
into the current atlas. Port the work in reviewable commits on `port/etymology`,
created from the reviewed `main` revision. ETY-00 through ETY-05 are complete;
ETY-06 final regression checks and documentation are complete. The lexical
release is published and clean-checkout remote restoration has passed. Main
integration is authorized as a normal fast-forward push; deployment status is
reported separately from these local acceptance checks.

Update an item's status, implementation notes, and validation evidence as work
proceeds. Complete an item only when its acceptance checks pass. Record skipped
checks and unresolved failures explicitly. If the starting revisions change,
refresh the relevant review findings before relying on them.

## Scope and starting evidence

Reviewed revisions:

- Main: `35ee521a88dd80c1bf1f62d5901d1b56449cd09d`.
- Feature: `58a6c1a2a8a2ef02f433576bf15cd7b0e09c57fe`.
- Common ancestor: `e1b47d4145ad4d312397d3e92696eb5f927ba835`.

The feature is one commit; main has advanced 48 commits since the common ancestor.
A merge preview conflicts in `.gitignore`, `README.md`, `app/README.md`,
`app/src/App.tsx`, `app/src/features/map/LanguageInspector.tsx`,
`app/src/features/map/WorldMap.tsx`, `app/src/index.css`, and
`pipeline/atlas/bootstrap-tippecanoe.sh`.

The review established the following baseline:

- The feature branch passed lint and a production build. Its tests had 45 passes
  and two skipped geographic-archive tests, including seven passing etymology tests.
- The new feature files typechecked when copied over current main, and all seven
  etymology tests passed there. This was an API compatibility check, not a test of
  a completed integration.
- Firefox reproduced lost exploration state when changing workspaces. A configured
  ten-form trail returned as the default nine-form graph, while its map overlay
  retained ten forms. Comparison concept and collection choices also reset.
- Firefox reproduced URL disagreement: refreshing Geography reopened Word histories,
  and changing the word fragment did not update the displayed word.
- The branch includes approximately 61.7 MB of raw datasets and produces a 21.8 MB
  uncompressed browser payload. Performance on slower devices remains unmeasured.

Retain search, word-history graphs, relationship and word evidence, concept/family
comparison, focal-point overlays, and navigation between lexical entries and atlas
languages. The standalone prototype and unused data exports remain available in
the original branch. A concept-wide map, inferred transmission routes, and new
etymological inference are outside this port.

## Architecture and behavior contracts

1. **Geography owns geographic state.** Reuse current availability, pinning,
   representation, color, inspection, and geometry services. Etymology actions must
   preserve existing pinned comparisons and their original source/period context.
2. **Etymology owns lexical state.** Lexical IDs remain separate from atlas IDs.
   Concepts express shared meanings; they do not establish cognacy. Focal-point
   links express recorded connections, not historical routes or dated polygons.
3. **One trail specification drives both views.** Focused word, traversal settings,
   and expanded nodes determine the displayed graph and enabled map overlay. Avoid
   storing a second independently computed trail in map state. The overlay follows
   the current trail until cleared; camera movement requires an explicit action.
4. **Navigation preserves the session.** Keep the focused word, selected word/edge,
   depth, placeholder/branch settings, expansions, comparison choices, and filters
   in state owned above the workspace lifecycle. Graph camera state may stay local.
5. **URLs describe navigation.** Encode workspace, focused word, visualization, and
   comparison concept/collection. Restore these on load and Back/Forward. In-session
   detail need not all appear in the URL; document what a shared link restores.
6. **Data is prepared independently.** Source restoration and lexical compilation
   are explicit operations. Normal tests and app builds do not silently preprocess
   the full lexical dataset. Geographic and lexical bundles have independent pins.
7. **Failures stay local.** Geographic-data failure must leave global navigation and
   lexical exploration usable; lexical failure must leave Geography usable. A stale
   request cannot override a newer navigation or selection.

## Work sequence

| Item | Deliverable | Depends on | Status |
| --- | --- | --- | --- |
| ETY-00 | Port branch and baseline | — | Complete; baseline republication failure repaired in ETY-04 |
| ETY-01 | Source contract, adapter, and domain logic | ETY-00 | Complete |
| ETY-02 | Session state and navigation | ETY-01 | Complete |
| ETY-03 | Explorer UI and app shell | ETY-02 | Complete |
| ETY-04 | Map overlay and atlas bridge | ETY-03 | Complete |
| ETY-05 | Data delivery and performance | ETY-01; final checks need ETY-04 | Complete; release published and remote restore verified in ETY-06 |
| ETY-06 | Regression checks and documentation | ETY-04, ETY-05 | Complete |

Commit each completed item separately; split an item further when it improves
reviewability. Record the source commit in the port's commit/PR descriptions.
Port selected files or functions without merging the original data-heavy commit.

### ETY-00 — Establish the baseline

- [x] Check working-tree state and verify current main and feature revisions.
- [x] Create the port branch from current main, preserving any unrelated work.
- [x] Run the existing frontend checks and record results before adding code.
- [x] Record the geographic data pin used for integration testing.
- [x] Refresh affected review findings if main or the feature has changed.

Acceptance: a reproducible starting revision, data pin, and check record exist.
Keep pre-existing failures distinct from regressions introduced by the port.

#### ETY-00 execution record — 2026-11-11

Created `port/etymology` at main revision
`35ee521a88dd80c1bf1f62d5901d1b56449cd09d`. The starting working tree had no
tracked changes; this plan was its only untracked file and was preserved.
`git ls-remote --heads origin main feature/etymology` confirmed both remote
revisions still match the review above, so no review refresh was needed.
Application code, dependencies, data pins, and installed data were not changed.

Environment: Linux x86_64, Node 24.14.0, npm 11.9.0, Python 3.12.3, and uv 0.11.6.
The browser run used Firefox 156.0 and geckodriver 0.37.1, headless at a requested
1440 × 1000 window size, with software rendering requested and terrain disabled.

Geographic baseline:

- Pin: [data-release.json](data-release.json), repository `maximemulder/lang-viz`,
  tag `atlas-data-2026-11-10-metadata`, asset `atlas-data.tar.gz`.
- Verified archive SHA-256:
  `88a2e1c239465a1c6ca8fe64a959833ca2b15af99292b5dff1c5cbb76a1ec8ff`.
- Installed manifest SHA-256:
  `b521691f6d032a966607ef36610c42a5e5569c078abbcc65cb4ecf5bfd116546`.
- Used `pipeline.atlas.data_release.release_files` to enumerate active files;
  compared each installed file's size and SHA-256 with the verified archive.
  All 62,629 active files matched, totaling 325,819,478 bytes. The audit also
  found 14 excluded palette files; these are outside the pinned active bundle.
- Manifest schema 5: 27,180 catalog entries, 6,654 entries with geometry, and
  14,357 geometry variants.
- Producer provenance remains limited: the pin has `pipelineCommit: null` and
  `packagedFromCommit: 405639953ed55b9e878adbeb2761a1773560c134`. Verification
  establishes identity with the pinned bundle, not an independently rebuilt dataset.

Checks, run before adding feature code:

| Check | Result |
| --- | --- |
| `npm run check` | Passed; 162 files checked, no fixes applied |
| `npm run typecheck` | Passed |
| `npm test` | Passed; 206 passed, zero failed/skipped |
| `npm run build` | Passed; existing large-chunk warning and plugin timing diagnostic |
| Active data/archive comparison | Passed; archive checksum and every active file verified |
| Firefox `world-small` scenario | Failed during warm republication; see below |

**Baseline browser failure:** the initial `world-small` render produced stripes
with zero blank-layer frames. Forced warm republication then failed the existing
assertion, `A rendered frame disabled all language coverage layers`; the failure
snapshot recorded nine blank-layer frames out of 35 rendered frames, with no
reported browser or map errors. The runner's separate injected coverage/fallback
failure checks retained previous coverage and recovered through Retry.
This was one run against unchanged main application code. Its cause and
repeatability are not yet established; do not report the browser suite as passing
or treat this result alone as a new etymology regression. Investigate separately
before using this check as an integration gate, particularly for ETY-04/ETY-06.

Full logs, the active-file checksum inventory, the data verification report, and
browser screenshots/report are saved locally under the ignored directory
[app/test-results/etymology-baseline/](app/test-results/etymology-baseline/).
These generated artifacts are not committed; this record preserves the results.
Python and other browser suites were not run at this baseline stage.

To review the current app, run `npm run dev` from `app/`, then use the URL Vite
prints. Search for languages, add areas, and switch sources/periods to inspect
existing Geography behavior. There is no etymology UI yet.

To reproduce the checks, run from `app/` (Firefox/geckodriver are required for
the last command; use a separate output directory to preserve the baseline):

```sh
npm run check
npm run typecheck
npm test
npm run build
npm run test:browser -- --skip-build --scenario world-small --runs 1 --output test-results/etymology-baseline-repeat/browser
```

From the repository root, `python3 -m pipeline.atlas.data_release audit` checks
the active geographic file set. On a fresh checkout, restore the pinned bundle
first with `python3 -m pipeline.atlas.data_release restore`; this also verifies
the archive checksum. No full source preprocessing is needed for this baseline.

#### Geographic republication follow-up — 2026-11-11

Before ETY-04, the `world-small` cold/warm check reproduced the failure on the
ETY-03 build: cold rendered stripes; forced warm republication recorded nine blank
frames, without map/browser errors. The cause was the diagnostic recompute action
using the full selection reset, releasing active coverage immediately.
Recomputation now retains that coverage until a complete replacement source loads,
while still requesting fresh worker output. Selection resets retain their meaning.

The controller regression suite passed 17 tests, including a new atomic replacement
check. The production build and cold/warm browser run then passed, with coverage
and fallback injected-failure retry recovery also passing. Evidence is in ignored
`app/test-results/etymology-04/{baseline-republication,republication-fixed}/` and
`controller.log`. This repair is a separate prerequisite commit; ETY-04 must still
check its final integrated build. Earlier execution records describe historical
failures rather than the repaired behavior.

### ETY-01 — Port the data adapter and domain logic

Source candidates on the feature commit:

- `pipeline/etymology/build.py`.
- `app/src/domain/etymology.ts`.
- `app/src/features/etymology/trailLayout.ts` and `trailGeography.ts`.
- `app/tests/etymology.test.ts`.

Tasks:

- [x] Define the lexical schema and source snapshot contract. Record source URLs,
  export dates, checksums, attribution, and adapter/schema versions.
- [x] Preserve the exact inputs needed to reproduce the reviewed snapshot outside
  Git, with a pinned restoration path. Do not introduce mutable upstream downloads
  as the only way to recover this snapshot. ETY-05 completes deployment delivery.
- [x] Port the adapter with explicit errors for invalid joins and values. Validate
  word-language joins, edge endpoints/types, concept membership, and source refs.
- [x] Preserve UTF-8, valid zero coordinates, optional-field behavior, provenance,
  and the distinction between word and relationship references. Reject invalid
  coordinates or report their omission explicitly.
- [x] Produce deterministic output with input-content-based freshness checks and
  atomic publication; modification times alone must not decide validity.
- [x] Port traversal, indexing, normalized search, layout, and coordinate helpers.
  Preserve cycle termination, multiple parents, the form cap, and placeholder
  interruption without inventing shortcut edges.
- [x] Adapt matching to the current catalog's `classification` metadata. Prefer an
  explicit Glottocode; use ISO only when no Glottocode exists and the ISO is unique
  on both full catalogs. Reverse navigation requires a unique exact Glottocode.
- [x] Use complete current atlas types in test fixtures. Split lightweight tests
  from full-snapshot integration checks.

Acceptance:

- [x] Synthetic tests run without external datasets and cover invalid data,
  identifier ambiguity, cycles, multiple parents, caps, placeholders, and coordinates.
- [x] A separate real-data check validates the known wine chain and its borrowing
  evidence. Record the reviewed snapshot's 74,635 words, 46,351 relationships, and
  466 lexical language records as snapshot expectations, not universal schema rules.
- [x] Rebuilding identical inputs produces identical output.
- [x] Existing atlas schemas and geometry output remain unchanged.

#### ETY-01 execution record — 2026-11-11

Implementation and reproduction instructions:
[pipeline/etymology/README.md](pipeline/etymology/README.md). The source pin is
[pipeline/etymology/sources.json](pipeline/etymology/sources.json). Selected code
was ported from feature commit `58a6c1a2a8a2ef02f433576bf15cd7b0e09c57fe`;
the original commit and its raw datasets were not merged.

- Restored both exact exports with `python3 -m pipeline.etymology.sources restore
  --from-git .` into ignored `data/etymology/diacl-2026-10-24/`. Both immutable
  GitHub download URLs also returned HTTP 200 with the expected content lengths.
  Full HTTP downloads were not repeated; mocked HTTP tests cover installation
  and checksum failure. Independent release hosting remains ETY-05 work.
- Replaced assertion-based validation with explicit contextual errors, including
  under optimized Python. Added duplicate-key, type/join, tree-placement, time,
  coordinate, concept, and source-reference checks. Optional text is normalized;
  UTF-8, zero coordinates, and separate word/relationship evidence are retained.
- Every explicit build validates source contents and serializes deterministically.
  Atomic output replacement preserves a working bundle on failure. Identical
  output is left untouched; no modification-time freshness shortcut is used.
- Kept layout/geography helpers in `app/src/domain/`, alongside traversal/search,
  rather than creating a UI feature directory prematurely. Matching uses current
  atlas classification metadata; reverse matching requires a unique Glottocode.
- Improved traversal omissions to count unique unseen forms, restricted expansions
  to reachable forms, made nested expansions independent of set insertion order,
  and handled equivalent -180/+180 meridians without division by zero.
- Added no dependencies, app lifecycle hooks, UI integration, or atlas schema changes.

Validation:

| Check | Result |
| --- | --- |
| Python format/lint on new adapter/tests | Passed |
| Lexical adapter/source tests | 31 passed; synthetic inputs, including optimized Python and atomic replacement failures |
| Lexical plus existing data-release Python tests | 53 passed |
| `npm run check` / `npm run typecheck` | Passed |
| Strict typecheck of both new TypeScript test files | Passed using bundler resolution and Node types |
| `npm test` | 221 passed, zero failed/skipped; includes 15 synthetic lexical tests |
| `npm run test:etymology-snapshot` | Three passed against real lexical and current atlas data |
| Two independent snapshot rebuilds | Identical bytes; another identical build preserved output modification time |
| `npm run build` | Passed; existing large-chunk warning remains |
| Geographic baseline content comparison | All 62,629 active files unchanged |

Compiled output: 21,794,225 bytes; SHA-256
`a5d02a88885dad90ec2fd8dbe14d3ffc5b6c52eaa37dee63966d1cdfbe0494a6`.
Logs, reproducibility outputs, and geographic comparison evidence are under ignored
[app/test-results/etymology-01/](app/test-results/etymology-01/).

The full Python pipeline and browser suites were not rerun for these isolated
domain/data additions. ETY-00's browser republication failure remains unresolved;
it is not counted as passing here. App shell and map integration remain later work.

### ETY-02 — Establish session state and URL navigation

Use the feature's `explorerState.ts` as a reference; replace its module-time
`window.location` parsing and scattered component state with explicit state and
navigation boundaries.

- [x] Define the canonical trail specification and session state described above.
  Keep repository data/cache ownership separate from navigation state.
- [x] Define actions for tracing a word, selecting evidence, expanding connections,
  changing comparison scope, opening language words, switching workspaces, showing
  the trail on the atlas, and clearing the overlay.
- [x] Make tracing/navigation reset only state that should change intentionally.
  Plain workspace switching must preserve both lexical and geographic sessions.
- [x] Implement pure URL parsing/serialization plus an explicit browser adapter.
- [x] Handle initial load, Back/Forward, hash changes, malformed parameters, unknown
  IDs, and legacy `#word=...&view=...` links without event/write loops.
- [x] Use history entries for meaningful navigation and replacement for incidental
  updates/canonicalization. Changing to Geography must produce a Geography URL.
- [x] Ensure comparison URLs restore the chosen concept, not merely the root word's
  default concept. Document that unencoded session detail is not restored on reload.

Acceptance: state-transition and routing tests cover round trips, direct links,
invalid links, Back/Forward, and stale asynchronous responses. The graph and map
derive the same forms and links from the same trail specification.

#### ETY-02 execution record — 2026-11-11

Contracts, transitions, URL semantics, and review commands are documented in
[app/src/state/EXPLORER_SESSION.md](app/src/state/EXPLORER_SESSION.md).
This step implements state/navigation independently of the app shell; ETY-03
will connect the browser adapter once above both real workspaces. The original
feature's module-time browser parsing and component-local exploration state were
replaced by explicit interfaces rather than copied into main.

- Added a pure session reducer and store-scoped Jotai atoms. The session retains
  evidence, trail settings/expansions, search/scope, and comparison filters across
  workspace switches. New-word tracing has documented, limited reset behavior.
- Repository readiness is separate from navigation. Current word/concept/language
  resolution is derived after data arrives; loading callbacks never select a word
  or overwrite newer navigation. Unknown IDs and ambiguous matches stay explicit.
- Graph and enabled atlas overlay selectors return the same derived trail object.
  Explicit show actions issue camera request identities; delayed consumers must
  verify the request is current after awaiting readiness. No real map consumer
  or camera movement is integrated in this step.
- Added pure fragment parsing/serialization and a lifecycle-managed browser
  connection for initial load, hash changes, and Back/Forward. Canonicalization
  replaces the current entry, encoded navigation pushes history, and unencoded
  settings do not write it. The pathname, query, and host history state survive.
- Guarded a queued-event race: an incidental search edit cannot overwrite a new
  fragment before its asynchronous `hashchange` event arrives.
- Explicit comparison IDs restore the chosen concept/collection. Unencoded detail
  persists in memory but is not promised on reload or when returning to a different
  root through history. Overlay visibility and camera requests are not URL state.

Validation:

| Check | Result |
| --- | --- |
| New synthetic session/navigation tests | 22 passed; no downloaded data or browser globals needed |
| `npm test` | 243 passed, zero failed/skipped |
| `npm run check` / `npm run typecheck` | Passed |
| Strict typecheck of new unit tests and browser fixture | Passed |
| `npm run test:etymology-snapshot` | Three passed against the existing lexical/atlas data |
| Firefox navigation fixture | 11 checkpoints passed, including native Back/Forward, refresh, pending hash events, invalid IDs, and customized workspace round trips |
| Browser runner Python format/lint | Passed |
| `npm run build` | Passed; existing large-chunk warning remains |
| Production JS comparison | All chunks remain byte-identical to ETY-00; app shell, geographic state, schemas, and data pins are untouched |

Full logs, browser report/screenshots, and production isolation evidence are under
ignored [app/test-results/etymology-02/](app/test-results/etymology-02/).
The browser test uses synthetic records in a development-only fixture; it is not
integrated UI/map acceptance. No full Python pipeline or geographic browser suite
was rerun. ETY-00's geographic republication failure remains unresolved.

For manual review, run `npm run dev` from `app/` and open
`/tests/browser/explorer-navigation.html` on Vite's displayed origin. The buttons
and session readout allow tracing, workspace switching, fragment edits, refresh,
and native history navigation. Automated entry point from `app/`:

```sh
npm run test:explorer-navigation-browser
```

### ETY-03 — Port the explorer UI into the current shell

Source candidates are `EtymologyExplorer`, `WordHistoryGraph`, `WordDetails`,
`FamilyComparison`, and feature styles. Split discovery, controls, and orchestration
into smaller components where that makes state ownership easier to understand.

- [x] Preserve current `App.tsx` structure, `MapProvider`, and geography behavior.
  Add workspace navigation and lazy loading for lexical code/data.
- [x] Keep session state above workspace mounting/unmounting. Preserve the existing
  map instance and resize it appropriately when it becomes visible.
- [x] Place boundaries so either workspace can recover independently. Retain useful
  error details and retry behavior; keep developer setup instructions in docs.
- [x] Port search, keyboard interaction, examples, graph controls, word/edge selection,
  evidence, concept/collection selection, family filtering, and missing-entry states.
- [x] Keep source evidence, reconstruction, placeholders, and omitted connections
  explicit. Do not reinterpret unspecified links as confirmed inheritance/borrowing.
- [x] Scope styles and adapt to the current shell and sidebar rather than replacing
  main's global CSS. Check keyboard focus and narrow-screen scrolling.

Acceptance: browser checks cover search and tracing, edge evidence, comparison
changes, graph expansion, keyboard operation, loading/error/retry, and desktop/narrow
layouts. Switching away and back preserves selected evidence, trail settings,
expansions, concept, collection, and filters. Test lexical use without atlas data
and geographic use when lexical loading fails.

#### ETY-03 execution record — 2026-11-11

Implemented on `port/etymology`, based on `15b26f6`. Presentation was adapted from
`58a6c1a` rather than importing its app shell or map implementation.

- `App.tsx` connects URL navigation once before either workspace mounts. Both
  workspaces load code lazily; a direct lexical link makes no atlas requests,
  and starting in Geography makes no lexical data request. The existing
  `MapProvider`, `WorldMap`, finder, inspection, and selection behavior remain.
- `GeographyWorkspace` remains mounted after its first visit, hides while lexical
  exploration is active, and resizes the same map on return. Browser checks
  preserve the exact canvas, pinned map entries/colors, and camera.
- `EtymologyExplorer` uses the shared store for root, evidence selection, trail
  settings/expansion, comparison, search, and filters. `WordDiscovery` owns the
  search presentation and keyboard interactions; graph camera and the About
  disclosure remain local display state. No asynchronous default-word writes
  or component-local comparison resets were copied from the prototype.
- Search normalizes accents; `/`, Arrow Up/Down, Escape, Enter, and graph
  Enter/Space are supported. Examples are explicit actions. Word and relationship
  citations stay separate. Expansion increases graph membership, missing-entry
  filters reveal absent records, and hidden placeholder-only entries are labeled.
  Unknown IDs never silently become wine or another concept.
- The lexical loader caches in-flight/successful requests, retries failures,
  validates schema/adapter/provenance structures, field types and joins before
  indexing, and publishes only ready data. Unmounted consumers ignore completion;
  newer navigation is never overwritten. Runtime contract checks supplement
  build-time validation; independent release checksums remain ETY-05. Requests
  start in a committed effect with rejection handling attached immediately,
  including when React abandons or replays a workspace render.
- Dataset failures recover within the affected workspace. Atlas request failures
  previously stayed cached forever; failed promises are now evicted and
  `atlasDataAtom` supports refresh. Retrying atlas data preserves the lexical store.
  Unexpected render errors have workspace boundaries; unrecoverable code-load
  failures retain a full reload action.
- Feature styles are nested under `.lexical-panel`; current global/map styling
  was not replaced. Keyboard focus and scrolling were checked on desktop, a
  500px native window, and exact 320/390px same-origin frames. Firefox headless
  clamps the outer window to 500px, so reports record actual sizes.

Validation:

| Check | Result |
| --- | --- |
| `npm run check`, `npm run typecheck` | Passed |
| `npm test` | 247 passed, no skips; four new loader/validation tests include malformed payload variants, request sharing, and retry |
| Strict standalone typecheck of new loader tests and snapshot tests | Passed |
| `npm run test:etymology-snapshot` | Three passed, including runtime validation of the complete real bundle |
| `npm run build` | Passed; existing large-chunk warning remains |
| Production `tests/browser/etymology.py` | 16 checkpoints passed against real lexical/current atlas data; screenshots and request counts saved |
| Existing production `tests/browser/catalog.py` | Passed, including working selection, source/period groups, comparisons, exact inspection, pinned coverage, and narrow sidebar checks |
| Existing production `tests/browser/focus.py` | Passed, including pointer/keyboard previews, profile camera, pinned context, style recovery, and aggregate framing |
| Python browser-script Ruff formatting/lint | Passed |
| Data preservation | All 62,629 baseline geographic files and compiled lexical bundle retain their recorded hashes |

The lexical browser suite uses a local HTTP proxy for failed/delayed/incompatible
responses without editing installed assets or adding application test hooks.
The catalog suite still reports the existing unsupported full Sino-Tibetan source
comparison as informational coverage; this stage does not claim that case works.
The full Python pipeline and remaining geographic browser suites were not rerun.
The ETY-00 warm-republication failure remains unresolved and must still be addressed
before closing the later geographic integration gates.

Logs, data-preservation verification, and browser reports/screenshots are under
ignored `app/test-results/etymology-03/`; existing regression reports are in
`app/test-results/catalog/` and `app/test-results/sidebar-focus/`. The production
JS now changes intentionally because the explorer is integrated; ETY-02's
byte-identical production-JS criterion no longer applies.

For manual review, run `npm run dev` in `app/`, select **Word histories**, and try
wine/water/tooth, search, word/link evidence, expansion, and comparison controls.
Switch to Geography and back with customized selections and filters; use native
Back/Forward and refresh. Generated data from ETY-01 is already installed locally.
Setup and reproduction commands are in
[app/README.md](app/README.md#word-histories-port-preview):

```sh
cd app
npm run test:etymology-snapshot
npm run test:etymology-browser
```

Map overlay rendering, show-current-trail actions, and language cross-navigation
are deliberately left to ETY-04. Artifact delivery/deployment and performance
measurement remain ETY-05. No publication, deployment, push, or original-branch
merge has occurred.

### ETY-04 — Integrate map overlays and cross-navigation

Port `WordTrailLayer` and `WordTrailMapSummary` against current map APIs. Add small
integration points to current `WorldMap` and `LanguageInspector`.

- [x] Render lexical points/links in separate layers, preserving current geometry
  display, inspection highlights, backgrounds, and polygon hit testing.
- [x] Use the canonical trail specification; map state controls overlay visibility
  and explicit navigation, not a second stale trail snapshot.
- [x] Fit the map on an explicit show/focus action. Prevent delayed camera requests
  from overriding newer actions, and respect reduced-motion preferences.
- [x] Preserve antimeridian splitting and access to overlapping historical stages.
  Report absent coordinates without removing those words from the graph.
- [x] Label the map action as showing the current word trail. Concept-wide mapping
  is outside this port. Returning from the map restores the same trail session.
- [x] Resolve atlas matches against the full catalog, then use current availability
  and pinning actions, including `showLanguagesAtom` or a narrowly extended action.
  Respect source/period filters, overrides, and supported area representations.
- [x] Preserve existing pinned entries and count actual additions. Distinguish
  added, already-present, unmatched, and currently unavailable entries.
- [x] Add lexical navigation alongside existing pinned-inspector actions. Use the
  represented catalog entry, including for aggregate and source-defined areas.
  Missing or ambiguous lexical matches must leave a useful search path available.

Acceptance: browser checks with current atlas data cover forward/reverse navigation,
historical stages, ambiguous IDs, missing matches, source-defined entries, aggregates,
pre-existing comparisons, repeat additions, overlay clearing, and navigation round
trips. Verify that lexical overlay actions alone do not change polygon selections,
geometry/cache identities, or trigger polygon recomputation. Adding areas should
use the normal atlas selection pipeline.

#### ETY-04 execution record — 2026-11-11

Implemented from the reviewed ETY-03 commit `74d3809`, with the separate geographic
republication prerequisite in `63870b7` (see the ETY-00 follow-up). Presentation
references remain from `58a6c1a`; its stale trail snapshots, raw-variant polygon
filtering, unconditional camera effects, and misleading addition counts were not
ported.

- `WordTrailLayer` reads the same derived trail as the graph. Independent GeoJSON
  layers and HTML markers do not enter polygon selection, coverage/cache keys, or
  hit-testing layers. Existing map settings, inspection highlights, and backgrounds
  remain. `WordTrailMapSummary` sits above the existing finder in a bounded sidebar.
- **Show current word trail** maps the currently traced root, even from comparison
  view. It never maps an entire concept. Markers and the complete form list inspect
  evidence without changing root, depth, expansion, or comparison preferences.
  The list exposes overlapping stages and forms without coordinates. Ordinary
  **Return to exploration** preserves the chosen view. Clearing only removes the
  lexical overlay; polygon comparisons and colors stay pinned.
- Camera focus is an explicit, one-shot request, using the existing minimal-arc
  bounds helper and antimeridian-split links. `mapCameraIntentAtom` arbitrates
  profile, trail, and user-originated navigation. Camera consumers recheck request
  identity after bounds/style/frame readiness; newer intent cancels older work.
  Reduced-motion requests use zero duration. Style restoration does not refit, and
  completed-camera cleanup leaves subsequent user motion alone. Browser checks
  require actual focus movement and no map/browser errors, including Firefox's
  native frame callback receiver requirements.
- `planTrailAreas` resolves identities on full catalogs first, then uses current
  availability, overrides and preferred own/descendant modes. The explicit async
  addition action rechecks the captured session/trail and reads current geography
  settings before calling `showLanguagesAtom`. It counts actual entry additions,
  deduplicates repeats, and reports already-present, unavailable, and unmatched
  records. Pre-existing comparisons retain their identity/color/provenance. A
  same-turn workspace change cancels an in-flight addition before it writes.
- **Browse word entries** appears alongside existing profile/pinned-popup actions.
  It passes the represented catalog identity, including aggregates and source
  entries, and navigates before lexical loading. Exact unique Glottocodes scope
  search; ambiguous or missing matches explain the fallback. Real checks include
  English, Ancient Greek's multiple lexical stages, the Indo-European aggregate's
  exact lexical match, and source-defined Danzhou with no exact match.

Validation and limits:

| Check | Result |
| --- | --- |
| Frontend lint/typecheck, strict standalone typecheck of new tests | Passed |
| `npm test` | 257 passed, no skips; includes nine new bridge/camera checks plus the prerequisite controller regression |
| `npm run test:etymology-snapshot` | Three passed against unchanged real data |
| Production build | Passed; existing large-chunk warning remains |
| Production `tests/browser/word_trail.py` | 17 integrated checkpoints passed; canonical trail, actual focus, area addition/cancellation, pinned comparisons, reverse joins, style/projection/narrow behavior |
| Existing production explorer UI suite | All 16 checkpoints passed, including independent load/error/retry and exact mobile viewports |
| Existing production catalog and focus suites | Passed; the catalog's unsupported full Sino-Tibetan source comparison remains an explicitly reported pre-existing limitation |
| Existing production geometry suite | Passed for direct/aggregate outlines through fast LOD changes |
| Final cold/warm republication | Passed, including coverage/fallback injected-failure recovery |
| Selection continuity observer | Eight period/selection transitions and unchanged-selection recomputation passed with zero counted blank frames |
| Broader inspection lifecycle/benchmark | Passed after observer correction: lifecycle plus 12 period/projection/view cases (48 hover samples) |
| Data preservation | All 62,629 baseline geographic files and the compiled lexical bundle retain their recorded hashes |
| Python browser-script lint/format | Passed |

The broader inspection run passed hover, pin/close, style replacement, aggregate
outlines and contemporary hover cases, then exposed a period-transition diagnostic
race. An isolated build of pre-overlay `63870b7`, using the same data, reproduced
one counted frame at every small contemporary/time-of-contact transition (seven
across eight selections). The rendered selection changes before the observer's
old effect-updated ref. Diagnostics now read a cached current-selection atom and
prime continuity only with coverage committed for that selection; production
geometry behavior is unchanged by this observer correction. The initial forced
recompute repair remains a separate real coverage-lifecycle fix. An unchanged
selection's actual disappearance still fails the continuity gate.

The isolated full-catalog baseline benchmark also hit its existing computation
deadline; the final integrated run completed all 12 cases after the observer fix.
The baseline deadline is recorded as a baseline limitation rather than an etymology
regression or a performance result. Baseline build/probe evidence is in
`pre-overlay-{inspection,transition}/`; the scratch build only skipped copying
public assets and served the same installed data through a link. Diagnostic probe
instrumentation was confined to that scratch archive.

The pinned lexical snapshot has no missing focal points. Missing-point and
antimeridian browser cases therefore use a clearly labeled, in-memory modified
response through the test proxy; installed source/bundle files are never edited.
Own/descendant preferences and geometry overrides have focused pure-domain checks;
real area additions use the existing pinning action. Geometry identity/no-recompute
checks compare fixed-camera workspace/clear/repeat actions. Explicit camera moves
may load normal viewport/LOD coverage; no lexical action changes polygon membership
except **Add matched language areas**.

The full Python pipeline and unrelated geographic browser suites were not rerun.
Data delivery, source notices, deployment and measured performance remain ETY-05;
this stage makes no slower-device performance claim and publishes nothing.
Ignored evidence is under `app/test-results/etymology-04/`, with existing catalog,
focus and geometry reports in their normal test-results directories.

For review, use the already installed data:

```sh
cd app
npm run dev
# Reproduce the dedicated production gate:
npm run test:word-trail-browser
```

Choose wine, customize depth/branches, then **Show current word trail**. Inspect a
historical stage from the panel, return, and try adding areas twice with other
comparisons present. Clear the overlay, then use **Browse word entries** in a
language profile or pinned polygon popup. Detailed commands and expected behavior
are in [app/README.md](app/README.md#word-histories-port-preview).

### ETY-05 — Complete data delivery and measure performance

- [x] Publishable artifacts include an independently versioned lexical browser
  bundle, a checksum/schema/provenance manifest, and source notices. Preserve the
  pinned raw inputs needed for reproduction outside Git.
- [x] Reuse appropriate release utilities while keeping lexical validation and pins
  separate from geographic manifest validation. A lexical update must not require
  rebuilding or republishing geography.
- [x] Provide explicit source restore, lexical build, and browser-bundle restore
  commands. Document their final names and destinations here and in setup docs.
- [x] Extend `.github/workflows/deploy-pages.yml` to restore and verify the lexical
  bundle alongside geography before testing/building. Use the project base path.
- [x] Avoid the branch's full-data `predev`, `pretest`, and `prebuild` hooks. Keep
  lightweight tests independent; run full-snapshot checks explicitly in CI.
- [x] Verify bundle checksums and referenced contents before exposing installation.
  Interrupted/invalid restores must not replace a working dataset.
- [x] Measure transfer bytes/time, parse/index cost, first usable render, long tasks,
  and search latency for first and repeat visits. Record browser, device, cache state,
  and any network/CPU throttling alongside results.
- [x] Use those results to decide whether indexing needs a worker or the payload
  needs splitting. Record the decision and acceptable responsiveness before closing
  this item; neither adding a worker nor keeping one JSON file is assumed upfront.

Acceptance: a clean checkout restores pinned artifacts and builds successfully for
`/lang-viz/` without source preprocessing during deployment. Missing, corrupt, and
incompatible data fail clearly. Performance evidence and any resulting fixes exist.

Release publication and site deployment are explicit actions after the artifacts
and implementation are ready for review; they are not prerequisites for the early
local port stages.

#### ETY-05 execution record — 2026-11-11

Based on `80fd8fa`; selected source remains `58a6c1a`. Implementation and local
acceptance checks are complete. **Do not mark the release gate complete yet:**
publication was explicitly separated from local port work above, and this candidate
has not been uploaded. The workflow now requires it, so publish before merging.
The producer commit must also be reachable on GitHub (push `port/etymology` first).
No remote push, release creation, site deployment, or changes to geographic data
were performed in this stage.

Delivery:

- `etymology-release.json` independently pins
  `word-trails-diacl-2026-10-24-v1`, lexical schema/adapter 1, source snapshot
  `diacl-2026-10-24`, and producer `80fd8fa913e1f106e4f926a443ea14d97db9cd45`.
  That producer contains the adapter that reproduces the reviewed bytes.
- Browser archive: 2,368,385 bytes, SHA-256
  `ab92976293566024407c135cae4cfab710be987138d000fbdef14bc6e7ad2042`.
  It includes compiled JSON, a checksum/schema/counts/provenance manifest, the
  source pin, and source notice. The JSON stays 21,794,225 bytes with SHA-256
  `a5d02a88885dad90ec2fd8dbe14d3ffc5b6c52eaa37dee63966d1cdfbe0494a6`.
- Raw-source archive: 3,253,568 bytes, SHA-256
  `38bd395831dcc9eea06ae795a722d9c7cdb8933f81c9b3bb7c13cde47af12876`.
  It includes both unchanged pinned inputs, the source pin, and notice; deployment
  never downloads it. Restoring it and running the adapter reproduced the exact
  browser JSON above. Immutable original-commit restoration remains available.
- `pipeline.release_utils` shares only archive/path/hash primitives; lexical
  manifest validation stays separate from geographic validation. Geographic
  release behavior is unchanged and its 22 existing release tests pass.
- Packaging reproduces the pinned build and rejects stale output. Restoration
  verifies archive size/hash, member names/types/sizes, exact file set, individual
  hashes, manifest/schema/provenance/counts, and input hashes before staged rename.
  Existing valid directories are no-ops; differing/modified directories are
  preserved with an explicit error. Source and browser destinations are separate.
- The publisher's [CompLing portal](https://compling.eu/) declares CC BY-NC-SA 4.0
  for the databank. The lexical notice preserves that declaration, attribution,
  export dates, original citations, and describes adaptations. The exports embed
  no snapshot-specific license; the notice uses the databank-level declaration.
  `About the data` links to the notice through the configured base path.
- The Pages workflow restores both prebuilt pins, runs typecheck and the explicit
  lexical snapshot gate, then builds with `/lang-viz/`. No npm preprocessing hooks
  or new dependencies were added. Generated lexical assets are excluded from Vite
  file watching alongside geographic assets.

Final commands and destinations are documented in
[pipeline/etymology/README.md](pipeline/etymology/README.md#independent-release-delivery).
Artifacts are prepared under ignored
`.data-releases/word-trails-diacl-2026-10-24-v1/`. The installed lexical directory
now contains the complete verified browser release; its former single-file version
is preserved as `previous-browser/` beside those archives.

Performance decision:

The first instrumented production visit showed 59ms parsing + 52ms validation +
71ms indexing consecutively on the main thread, after loading a 21.8 MB expanded
JSON. A worker now receives transferred response bytes, decodes/parses/validates/
indexes, returns a prepared repository through structured clone, then terminates.
Successful repositories remain cached across workspace switches. Fetch, worker,
parse, and validation errors evict failed attempts and permit Retry. The explorer
regression suite exercises incompatible-data failure inside the real worker.

An initial worker probe also exposed a roughly 490ms input-to-render delay for
`a`. Reusing one `Intl.Collator('en', {numeric: true})` preserves ranked numeric ID
ordering and avoids repeatedly constructing collation options while sorting.

Measurement environment: Linux x86_64, AMD Ryzen AI 7 350 / Radeon 860M,
16 reported logical processors, Firefox 156.0/geckodriver 0.37.1 headless,
1440×1000 requested outer window, software rendering, native CPU speed with no
CPU throttle. Node 24.14.0/npm 11.9.0; restoration/build scripting used Python
3.12.3 and pytest used the existing venv's Python 3.13.5. No mobile CPU was tested.

A test-only proxy observes the production app from before startup, serves the
lexical response with gzip level 9 and explicit HTTP caching, and optionally
throttles **that response only** to 10 Mbit/s +150ms TTFB. JS/CSS are unthrottled.
Three independent origins per network condition, each with cold + cached load,
yielded 12 samples. These are controlled local measurements; actual Pages/CDN
compression and caching were not measured. First usable means the graph exists
followed by two animation frames; search latency similarly ends after result DOM
changes and two frames.

| Measurement | Observed range |
| --- | --- |
| Gzip lexical response body | 2,365,310 bytes; 21,794,225 decoded |
| Cold loopback response transfer | 6–11ms |
| Cold throttled response transfer | 2,073–2,076ms |
| First usable graph, cold loopback | 941–2,336ms |
| First usable graph, cold throttled | 3,000–3,800ms |
| First usable graph, HTTP-cache reload | 940–959ms; zero lexical HTTP requests/transfer bytes |
| Worker decode / parse | 20–44ms / 52–97ms |
| Worker validation / index | 54–104ms / 69–134ms |
| Input-to-render search, including repeated `wine` and broad `a` | Maximum 116ms |
| Largest >50ms timer gap across samples | 150ms |

Firefox does not expose Long Tasks entries. The harness explicitly reports this
and records 10ms timer gaps >50ms as a scheduling/GC/blocking proxy, rather than
claiming direct Long Tasks measurements. Timer gaps around repository handoff/rendering still reach roughly 140–150ms;
the timer probe cannot isolate structured-clone cost from rendering, GC, and
scheduling. Worker preparation does not remove all main-thread pauses.
The observed results meet this stage's desktop review budgets: first usable graph
under 5s locally / 7s with the lexical throttle, search rendering under 250ms,
and pre-ready event-loop gaps below 250ms. The harness asserts those budgets.
In-session revisits reuse a single prepared repository with no lexical request
or new worker. HTTP-cache reloads prepare again, as expected for a new document.

Keep one lazy JSON for this release: the compressed size and throttled first-use
measurements meet these budgets. Retain the worker to move the measured preparation
work off the main thread. Payload partitioning or a worker-owned repository API
would need evidence from slower/mobile CPUs, memory measurements, or a tighter
handoff budget; this stage does not establish phone responsiveness or eliminate
all >50ms work. No worker was added before the initial timing probe.

Validation:

- 259 frontend tests passed, zero skipped; three real-snapshot checks passed.
- 75 relevant Python checks passed: 31 adapter/source, 22 lexical release, and
  22 geographic release tests. Full pipeline tests remain ETY-06.
- Lint, app and strict changed-test typechecks, Ruff checks/format, and production
  build passed. The existing large-chunk warning remains.
- Twelve performance samples and 16 production explorer checkpoints passed;
  the explorer checks include independent failures/retry, navigation, state
  retention, keyboard interaction and narrow layouts. All 17 map integration
  checkpoints also passed with the worker-prepared repository, including areas,
  cross-navigation, cancellation, projections, style restoration, and narrow layout.
- A fresh source tree with no raw lexical inputs installed both pinned local
  geographic/browser archives, passed the snapshot gate, and built `/lang-viz/`
  without preprocessing. It reused installed `node_modules`; a fresh `npm ci`
  and real GitHub downloads were not performed. Firefox checked the actual
  project paths for the payload/worker, notice/manifest, independent loading,
  and incompatible-data rejection/retry on that build.
- All 62,629 active geographic file sizes/hashes still match ETY-00, and the
  lexical JSON remains byte-identical. The added lexical manifest/notices/source
  pin are verified against the separate lexical release.

Evidence: ignored `app/test-results/etymology-05/` contains checks, builds,
`python.log`, `source-archive-rebuild.log`, `data-preservation.json`, the initial
probes, final `performance/report.json`, `explorer-regression/report.json`, and
`project-delivery/report.json`, and `map-regression/report.json`. Early performance probes that failed the search
budget are preserved separately from the final passing measurements.

Release gate, completed in ETY-06 after user authorization:

- [x] Push the port branch so producer commit `80fd8fa` is available on GitHub.
- [x] Publish the exact prepared browser + raw-source archives and pin using the
  documented `pipeline.etymology.data_release publish` command.
- [x] From a clean checkout, run real `restore` downloads and the `/lang-viz/`
  build/snapshot check. Record the published tag and evidence, then mark ETY-05
  complete. Site deployment remains a separate action.

### ETY-06 — Validate the integrated feature and document it

- [x] Run the full frontend checks and relevant Python tests after integration.
- [x] Run the new etymology browser suite against real lexical and current atlas data.
- [x] Run affected existing catalog, selection, focus, inspection, and geometry
  browser suites. Include prepared coverage checks if geometry delivery changes.
- [x] Exercise style restoration, both projections, narrow layouts, keyboard focus,
  and simultaneous pinned comparisons plus a lexical overlay.
- [x] Verify geographic and lexical failures independently, URL refresh/Back/Forward,
  and repeated workspace round trips with customized exploration state.
- [x] Update `README.md`, `app/README.md`, `ARCHITECTURE.md`, and `DATASETS.md` as
  applicable: setup, commands, state ownership, source provenance, payload behavior,
  supported interactions, and known limits.
- [x] Review the final diff for copied legacy shell/map behavior, unused exports,
  duplicate implementations, and unrelated changes. Update this checklist/evidence.

Acceptance: all applicable checks pass against recorded code and data revisions;
remaining limitations are documented. A compile-only compatibility check or a run
without geographic data does not satisfy integrated map acceptance.

#### ETY-06 execution record — 2026-11-11

Application revision: `ba2313f106d07ce6ded81a5121f1952b8357a476`.
Original feature reference: `58a6c1a`; reviewed main remains `35ee521` after a
fresh fetch. This stage changes documentation and one browser assertion; it
makes no production behavior, dependency-version, geometry-delivery, or data changes.

The user authorized proceeding and normal pushes to main, without force. Pushed
`port/etymology`, then published the exact prepared
[word-trails-diacl-2026-10-24-v1 release](https://github.com/maximemulder/lang-viz/releases/tag/word-trails-diacl-2026-10-24-v1).
GitHub reports both uploaded archive sizes and SHA-256 digests matching the pin.
The release targets producer `80fd8fa`; it is published, not a draft, and was not
made the repository's latest application release. ETY-05's remote release gate
is now complete. The historical ETY-05 record above describes its earlier local-only state.

A separate clean Git checkout of the application revision downloaded the actual
geographic browser release, lexical browser release, and lexical source archive
from GitHub through the real restore commands. No local archives substituted for
downloads. Restoring/building the source archive reproduced the exact published
lexical JSON hash. Fresh `npm ci`, frontend tests, lint, typecheck, explicit snapshot
checks, and the `/lang-viz/` build passed. Firefox verified project-path worker/data
requests, lazy geographic loading, source notice/manifest delivery, and incompatible
schema rejection followed by successful Retry. Installed geographic files were
also compared against the fresh verified remote bundle: 62,629 files, no differences.

| Final check | Result |
| --- | --- |
| Frontend unit tests | 259 passed, zero skipped |
| Full Python pipeline suite | 136 passed |
| Real lexical/atlas snapshot | Three passed |
| Lint, typecheck, production build | Passed locally and in the clean checkout |
| Explorer / lexical map browser suites | 16 / 17 checkpoints passed |
| Session/URL fixture | 11 checkpoints passed |
| Catalog and selection | Passed, including pinned source/period comparisons and colors |
| Profile focus and geometry | Passed, including asynchronous camera navigation and outline continuity |
| Inspection | Interaction lifecycle and all 12 period/projection/view benchmark cases passed; 48 hover samples |
| Prepared colors | Defaults, overrides, undo, global/regional solves, source switching, and failure isolation passed |
| Coverage selection | Eight period transitions plus unchanged-selection recomputation passed |
| Ordinary overlap suite | All six scenarios cold/warm passed; slow-publication and zoom checks recorded zero disappearing coverage; both injected failures recovered through Retry |
| Clean project-path browser delivery | Three checks passed |

Initial failures are retained, not counted as passes:

- The first full Python collection lacked installed `mapbox-vector-tile` and
  `shapely`. `uv sync --locked` installed locked dependencies without changing the
  lockfile; the complete suite then passed.
- The first inspection benchmark hit `request-deadline` in a dense Asian view while
  other checkout/build work was running. Interaction checks had passed. A full
  isolated rerun passed all cases without changing production code or relaxing
  deadlines. The concurrent work is a possible contributor, not a proven cause.
- Prepared-color failure checks still expected the removed atlas error heading.
  Updated the assertion for the workspace boundary and additionally checked the
  specific underlying error, Retry, and workspace navigation. The full suite then
  passed, including missing and corrupt metadata.

Final diff review checked state ownership, independent loading/retry, stale camera
cancellation, atlas identity/availability/pinning, runtime data validation, source
and release boundaries, and unrelated geographic changes. No additional production
fix was required. There are no raw exports or standalone prototype in the port's
history; the original feature commit is not an ancestor. Existing helper exports
remain used by production or focused tests. The optional macOS bootstrap change
was left for its separate portability review.

Documentation now provides the shortest published-data setup, lexical interactions
and review commands, session/navigation ownership, provenance, and performance
limits. `DATASETS.md` and the lexical notice already document the reviewed source
contract and remain applicable. ETY-05 performance evidence remains valid because
this stage does not change production code. Slower/mobile CPU behavior and real
Pages/CDN compression/cache timings remain unmeasured. The existing full mixed-source
Sino-Tibetan renderer budget limit is explicitly reported by catalog/selection checks;
it is not counted as successful complete mixed-source coverage.

Evidence is under ignored `app/test-results/etymology-06/`: `checks.json`,
`python-complete.log`, `browser-checks.json`, `reruns.json`, `clean-checks.json`,
`final-review.json`, `data-preservation.json`, individual logs, and browser reports
and screenshots. First-attempt failures are preserved separately from successful
reruns. A direct main integration was authorized, so this execution record serves
as the final review description instead of opening a PR. A normal main push starts
the existing Pages workflow; its remote outcome is reported separately.

## Validation commands and evidence

Existing frontend checks, run from `app/`:

```sh
npm run check
npm run typecheck
npm test
npm run build
```

Run Python checks from the repository root, using the relevant test scope during
adapter development and the full pipeline suite at the final gate:

```sh
uv run pytest
```

The existing browser harness is documented in
[app/tests/browser/README.md](app/tests/browser/README.md). Reuse its browser/server
lifecycle for the etymology suite. Give lightweight tests and real-snapshot/browser
checks distinct documented entry points. Do not silently count skipped required
integration checks as a successful final gate.

Keep generated reports/screenshots under ignored test-results directories. Record
the following in each completed item or in the PR validation record:

| Item | Code revision | Data pins/checksums | Checks and results | Evidence / remaining work |
| --- | --- | --- | --- | --- |
| ETY-00 | `35ee521a88dd80c1bf1f62d5901d1b56449cd09d` | `atlas-data-2026-11-10-metadata`; full hashes above | Lint/typecheck/206 tests/build/data verification passed; browser warm republication failed | See ETY-00 execution record and local `app/test-results/etymology-baseline/`; feature implementation not started |
| ETY-01 | Based on `b34860f`; source `58a6c1a` | `diacl-2026-10-24`; source hashes in pin; output hash above; unchanged geography | 53 relevant Python tests, 221 frontend tests, three snapshot tests, lint/typechecks/build/reproducibility passed | See ETY-01 execution record and local `app/test-results/etymology-01/`; state/UI/map port pending |
| ETY-02 | Based on `86aedf7`; source-state reference `58a6c1a` | Existing lexical and geographic pins unchanged; navigation checks use synthetic data | 243 frontend tests, three snapshot tests, 11 Firefox checkpoints, lint/typechecks/build passed | See ETY-02 execution record and local `app/test-results/etymology-02/`; app shell/UI/map integration pending |
| ETY-03 | Based on `15b26f6`; presentation reference `58a6c1a` | Existing lexical/geographic pins and generated bytes unchanged | 247 frontend tests, three snapshot tests, 16 integrated Firefox checkpoints, existing catalog/focus suites, lint/typechecks/build passed | See ETY-03 execution record and local `app/test-results/etymology-03/`; map overlay/cross-navigation pending |
| ETY-04 | Based on `74d3809`; prerequisite `63870b7`; source presentation `58a6c1a` | Existing geographic/lexical pins and generated bytes unchanged; labeled coordinate fixtures for edge cases | 257 frontend tests, three snapshot tests, 17 map + 16 explorer Firefox checkpoints, geographic regression evidence in execution record | Map overlay/cross-navigation complete |
| ETY-05 | Based on `80fd8fa`; same source reference | Candidate lexical release `word-trails-diacl-2026-10-24-v1`; archive hashes above; geographic pin unchanged | 259 frontend + three snapshot + 75 Python checks; 12 performance samples, 16 explorer + 17 map checks, fresh-tree project-path build and delivery checks | Complete; published release and clean-checkout real remote restore verified in ETY-06 |
| ETY-06 | Application `ba2313f`; source `58a6c1a`; final documentation/assertion commit follows | Published lexical release and existing geographic pin; bytes unchanged | 259 frontend + 136 Python + three snapshot tests; integrated browser suites; clean remote restore, source reproduction, project-path build/delivery | Complete; initial failures and successful reruns recorded above; deployment status separate |

## Separate portability fix

The feature's `pipeline/atlas/bootstrap-tippecanoe.sh` changes address macOS SDK
headers and Bash 3.2 empty-array behavior. Handle these in a separate commit if
still applicable. Preserve main's build of both `tippecanoe` and `tile-join`; verify
the supported platform paths and record any platform that could not be tested.
This fix should not be mixed into lexical feature behavior.

## Completion checklist

- [x] ETY-00 through ETY-06 satisfy their acceptance checks.
- [x] Word histories and family comparison work with the recorded real snapshot.
- [x] Graph, map overlay, URL, and workspace navigation behave consistently.
- [x] Existing geography, colors, inspections, and pinned comparisons retain their
  behavior with current atlas data.
- [x] Clean-checkout data restoration and production build are reproducible.
- [x] Raw source exports and the standalone prototype have not been imported into
  main's history through a merge of the original feature commit.
- [x] The final execution record describes the resulting behavior, source commit,
  validation, and known limits. Direct integration replaces a PR under user
  authorization. Data publication and deployment status are stated separately.
