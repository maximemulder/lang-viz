# Etymology port plan

Last updated: 2026-11-11.

This is the execution checklist for bringing Word Trails from `feature/etymology`
into the current atlas. Port the work in reviewable commits on `port/etymology`,
created from the reviewed `main` revision. ETY-00 through ETY-02 are complete;
explorer UI and app-shell integration in ETY-03 are next.

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
| ETY-00 | Port branch and baseline | — | Complete; browser failure recorded |
| ETY-01 | Source contract, adapter, and domain logic | ETY-00 | Complete |
| ETY-02 | Session state and navigation | ETY-01 | Complete |
| ETY-03 | Explorer UI and app shell | ETY-02 | Not started |
| ETY-04 | Map overlay and atlas bridge | ETY-03 | Not started |
| ETY-05 | Data delivery and performance | ETY-01; final checks need ETY-04 | Not started |
| ETY-06 | Regression checks and documentation | ETY-04, ETY-05 | Not started |

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

- [ ] Preserve current `App.tsx` structure, `MapProvider`, and geography behavior.
  Add workspace navigation and lazy loading for lexical code/data.
- [ ] Keep session state above workspace mounting/unmounting. Preserve the existing
  map instance and resize it appropriately when it becomes visible.
- [ ] Place boundaries so either workspace can recover independently. Retain useful
  error details and retry behavior; keep developer setup instructions in docs.
- [ ] Port search, keyboard interaction, examples, graph controls, word/edge selection,
  evidence, concept/collection selection, family filtering, and missing-entry states.
- [ ] Keep source evidence, reconstruction, placeholders, and omitted connections
  explicit. Do not reinterpret unspecified links as confirmed inheritance/borrowing.
- [ ] Scope styles and adapt to the current shell and sidebar rather than replacing
  main's global CSS. Check keyboard focus and narrow-screen scrolling.

Acceptance: browser checks cover search and tracing, edge evidence, comparison
changes, graph expansion, keyboard operation, loading/error/retry, and desktop/narrow
layouts. Switching away and back preserves selected evidence, trail settings,
expansions, concept, collection, and filters. Test lexical use without atlas data
and geographic use when lexical loading fails.

### ETY-04 — Integrate map overlays and cross-navigation

Port `WordTrailLayer` and `WordTrailMapSummary` against current map APIs. Add small
integration points to current `WorldMap` and `LanguageInspector`.

- [ ] Render lexical points/links in separate layers, preserving current geometry
  display, inspection highlights, backgrounds, and polygon hit testing.
- [ ] Use the canonical trail specification; map state controls overlay visibility
  and explicit navigation, not a second stale trail snapshot.
- [ ] Fit the map on an explicit show/focus action. Prevent delayed camera requests
  from overriding newer actions, and respect reduced-motion preferences.
- [ ] Preserve antimeridian splitting and access to overlapping historical stages.
  Report absent coordinates without removing those words from the graph.
- [ ] Label the map action as showing the current word trail. Concept-wide mapping
  is outside this port. Returning from the map restores the same trail session.
- [ ] Resolve atlas matches against the full catalog, then use current availability
  and pinning actions, including `showLanguagesAtom` or a narrowly extended action.
  Respect source/period filters, overrides, and supported area representations.
- [ ] Preserve existing pinned entries and count actual additions. Distinguish
  added, already-present, unmatched, and currently unavailable entries.
- [ ] Add lexical navigation alongside existing pinned-inspector actions. Use the
  represented catalog entry, including for aggregate and source-defined areas.
  Missing or ambiguous lexical matches must leave a useful search path available.

Acceptance: browser checks with current atlas data cover forward/reverse navigation,
historical stages, ambiguous IDs, missing matches, source-defined entries, aggregates,
pre-existing comparisons, repeat additions, overlay clearing, and navigation round
trips. Verify that lexical overlay actions alone do not change polygon selections,
geometry/cache identities, or trigger polygon recomputation. Adding areas should
use the normal atlas selection pipeline.

### ETY-05 — Complete data delivery and measure performance

- [ ] Publishable artifacts include an independently versioned lexical browser
  bundle, a checksum/schema/provenance manifest, and source notices. Preserve the
  pinned raw inputs needed for reproduction outside Git.
- [ ] Reuse appropriate release utilities while keeping lexical validation and pins
  separate from geographic manifest validation. A lexical update must not require
  rebuilding or republishing geography.
- [ ] Provide explicit source restore, lexical build, and browser-bundle restore
  commands. Document their final names and destinations here and in setup docs.
- [ ] Extend `.github/workflows/deploy-pages.yml` to restore and verify the lexical
  bundle alongside geography before testing/building. Use the project base path.
- [ ] Avoid the branch's full-data `predev`, `pretest`, and `prebuild` hooks. Keep
  lightweight tests independent; run full-snapshot checks explicitly in CI.
- [ ] Verify bundle checksums and referenced contents before exposing installation.
  Interrupted/invalid restores must not replace a working dataset.
- [ ] Measure transfer bytes/time, parse/index cost, first usable render, long tasks,
  and search latency for first and repeat visits. Record browser, device, cache state,
  and any network/CPU throttling alongside results.
- [ ] Use those results to decide whether indexing needs a worker or the payload
  needs splitting. Record the decision and acceptable responsiveness before closing
  this item; neither adding a worker nor keeping one JSON file is assumed upfront.

Acceptance: a clean checkout restores pinned artifacts and builds successfully for
`/lang-viz/` without source preprocessing during deployment. Missing, corrupt, and
incompatible data fail clearly. Performance evidence and any resulting fixes exist.

Release publication and site deployment are explicit actions after the artifacts
and implementation are ready for review; they are not prerequisites for the early
local port stages.

### ETY-06 — Validate the integrated feature and document it

- [ ] Run the full frontend checks and relevant Python tests after integration.
- [ ] Run the new etymology browser suite against real lexical and current atlas data.
- [ ] Run affected existing catalog, selection, focus, inspection, and geometry
  browser suites. Include prepared coverage checks if geometry delivery changes.
- [ ] Exercise style restoration, both projections, narrow layouts, keyboard focus,
  and simultaneous pinned comparisons plus a lexical overlay.
- [ ] Verify geographic and lexical failures independently, URL refresh/Back/Forward,
  and repeated workspace round trips with customized exploration state.
- [ ] Update `README.md`, `app/README.md`, `ARCHITECTURE.md`, and `DATASETS.md` as
  applicable: setup, commands, state ownership, source provenance, payload behavior,
  supported interactions, and known limits.
- [ ] Review the final diff for copied legacy shell/map behavior, unused exports,
  duplicate implementations, and unrelated changes. Update this checklist/evidence.

Acceptance: all applicable checks pass against recorded code and data revisions;
remaining limitations are documented. A compile-only compatibility check or a run
without geographic data does not satisfy integrated map acceptance.

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

## Separate portability fix

The feature's `pipeline/atlas/bootstrap-tippecanoe.sh` changes address macOS SDK
headers and Bash 3.2 empty-array behavior. Handle these in a separate commit if
still applicable. Preserve main's build of both `tippecanoe` and `tile-join`; verify
the supported platform paths and record any platform that could not be tested.
This fix should not be mixed into lexical feature behavior.

## Completion checklist

- [ ] ETY-00 through ETY-06 satisfy their acceptance checks.
- [ ] Word histories and family comparison work with the recorded real snapshot.
- [ ] Graph, map overlay, URL, and workspace navigation behave consistently.
- [ ] Existing geography, colors, inspections, and pinned comparisons retain their
  behavior with current atlas data.
- [ ] Clean-checkout data restoration and production build are reproducible.
- [ ] Raw source exports and the standalone prototype have not been imported into
  main's history through a merge of the original feature commit.
- [ ] The PR describes the resulting behavior, source commit, validation, and known
  limits. Data publication and deployment status are stated separately.
