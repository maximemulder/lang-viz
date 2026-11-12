# WALS port roadmap

Last updated: 2026-11-12.

Port the useful behavior from `swedha-wals` onto current `main` in small,
independently reviewable changes. Do not merge or cherry-pick the original
data-heavy commit wholesale. Fix the data, identity, navigation, and delivery
issues as their corresponding pieces are introduced.

This document is the execution checklist. WALS-00 through WALS-03 are complete;
source/data/navigation contracts and independent delivery are implemented without
mounted WALS UI.
Update each item's status, implementation decisions, and validation evidence as
work proceeds. Mark an item complete only when its acceptance checks pass.
Record skipped checks and pre-existing failures separately from regressions.
Source publication, integration, and deployment results must be recorded as
distinct outcomes, rather than inferred from a successful local build.

## Scope and reviewed baseline

Reviewed local revisions:

- Main: `49dc003f62b5e16f5126ac1ee249d7a354f288d2`.
- Source branch: `origin/swedha-wals`,
  `3b7078614efcfebc1c471fea2c4ab7fb336745a6`.
- Common ancestor: `02dfbc32f8b08fb9046f3463621f10879f39a300`.

The source branch adds one commit; main has advanced 29 commits since the common
ancestor. Refresh the relevant findings if either revision changes. These are
local review references, not a claim that remote heads were freshly verified.

Retain:

- Approachable feature cards in language profiles, with explanations, recorded
  varieties, explicit missingness, and usable citations.
- The seven-feature shortlist: word order (81A), tone (13A), syllable structure
  (12A), number of genders (30A), adjective–noun order (87A), definite articles
  (37A), and question particles (92A).
- Optional geographic exploration of examples sharing one exact WALS category,
  with a bounded display and a keyboard-accessible list.
- Source variety identity and representative WALS locations, independently of
  catalog associations and polygon availability.

A general typology workspace, regional comparison table, similarity score,
inferred ancestry/contact, feature inheritance, Grambank/PHOIBLE integration,
and automatic polygon recoloring are outside this port. Points versus arcs is a
design decision within the map stage; shared-feature exploration remains in
scope whichever representation is selected.

Initial review evidence:

- The branch preserves 2,662 source records and 76,475 observations in its cleaned
  tables. Its seven-feature browser supplement is approximately 1.1 MB expanded.
- Building against the local atlas catalog yielded 2,572 language associations,
  46 dialect associations, 37 family-node associations, and seven unmatched
  records. These describe the old policy, not acceptance targets for a safer join.
- All eight added tests and the branch typecheck passed after manual generation,
  using installed dependencies. The changed frontend files failed Biome with
  six errors. Browser acceptance was not performed.
- The generated file is absent from deployment preparation. Current atlas
  packaging would also omit it because it is not part of its manifest contract.
- Connection navigation carries only an atlas ID. Irish (Donegal), selected for
  complex syllable structure, can therefore open the default Irish record where
  that value is missing. Kyuquot/Nuuchahnulth and Eastern Aleut/Aleut provide
  additional regression examples.
- The antimeridian helper produces nonfinite coordinates for the input
  `[[-180, 10], [180, 20]]`.
- The source-cleaning code is absent. The committed audit records checks that
  the supplement builder does not reproduce; bibliography keys are displayed
  without the bibliography needed to resolve them.

## Architecture and behavior contracts

1. **WALS observations belong to source records.** Keep WALS IDs, original
   Glottocodes/ISO codes, names, feature/category IDs, and references. An atlas
   association is a separate object with a method and scope. A family association
   must never become a family-wide feature assertion or propagate to descendants.
2. **Matching is explicit and conservative.** Match against atlas classification
   metadata, not the assumption that every catalog ID is a Glottocode. Distinguish
   exact association, broader catalog scope, reviewed override, ambiguous, and
   unmatched. Do not silently replace an unresolved explicit Glottocode with ISO.
   Permit automatic ISO fallback only when the Glottocode is absent and the code
   is unique in both complete source and target catalogs. Review exceptions as
   data with reasons; do not merge source varieties to make a match unique.
3. **Delivery remains independent of geographic preprocessing.** Use a separate
   WALS browser bundle and release pin. Prefer resolving associations against the
   loaded atlas in an integration module, keeping the compiled WALS data independent
   of atlas revisions. If precomputed joins prove necessary, bind them to an atlas
   catalog fingerprint and reject or recompute stale associations explicitly.
4. **Loading, domain logic, and UI have separate owners.** The repository validates
   and indexes data; feature state owns selected source IDs; the integration owns
   catalog navigation and map composition. React components do not define fetch
   caches. Neither the geometry pipeline nor the map core imports WALS algorithms.
5. **One overlay specification determines the examples.** Store source-record ID,
   feature ID, display settings, and visibility; derive targets from ready data.
   Do not keep independent copies of full records in map state. Selecting another
   profile does not silently replace the overlay's origin.
6. **Navigation preserves evidence.** Remember the selected WALS variety per atlas
   profile for the session. Inspecting an example carries its WALS record and
   feature, even when that feature is outside the normal three-card summary.
   In-session choices survive workspace switches and profile remounts. New WALS
   URL parameters and reload persistence are outside the first port; existing
   Geography/Word histories routes must retain their behavior.
7. **Camera changes require explicit intent.** Show/focus actions use the shared
   `mapCameraIntentAtom`. Profile inspection, rendering, retry, workspace return,
   style/projection changes, and data completion do not issue new camera moves.
   Newer manual, profile, lexical, or WALS navigation supersedes older work.
8. **Existing map state remains intact.** WALS does not alter pinned groups,
   source/period context, coverage, colors, or exploration selection. Keep the
   user's projection by default. WALS errors remain local to WALS controls.

## Work sequence and integration checkpoints

| Item | Deliverable | Depends on | Status |
| --- | --- | --- | --- |
| WALS-00 | Baseline and port setup | — | Complete |
| WALS-01 | Reproducible sources and validated supplement | WALS-00 | Complete |
| WALS-02 | Repository, matching, and session/navigation model | WALS-01 | Complete |
| WALS-03 | Independent release delivery and CI | WALS-01; join checks need WALS-02 | Complete |
| WALS-04 | Language profile cards | WALS-02, WALS-03 | Planned |
| WALS-05 | Shared-feature selection and map design | WALS-04 | Planned |
| WALS-06 | Map integration and navigation | WALS-05 | Planned |
| WALS-07 | Final acceptance and documentation | WALS-03, WALS-04, WALS-06 | Planned |

Use short-lived branches based on current main, such as `port/wals-data`,
`port/wals-profiles`, and `port/wals-map`, or separately reviewable commits on
`port/wals`. Recheck the base when each change lands. Each stage must leave main
buildable and deployable; do not expose controls that depend on unpublished data
or unfinished navigation. Data/domain stages can land without visible UI.
The profile cards are the first user-facing checkpoint; map exploration is the
second. Carry the source commit reference in implementation commit/PR descriptions.

### WALS-00 — Establish the current baseline

- [x] Verify working-tree state, main/source revisions, installed dependencies,
  and the geographic and lexical data pins. Preserve unrelated work.
- [x] Start the port from current main and refresh changed integration assumptions.
- [x] Run existing frontend unit, lint, typecheck, and production-build checks.
- [x] Run representative profile-focus, selection, and word-trail browser checks
  against the existing app; record failures before introducing WALS.
- [x] Record environment, revisions, pins, commands, results, and artifact paths.

Acceptance: the starting state is reproducible and pre-existing failures are
identified. No WALS application behavior has been introduced.

### WALS-01 — Make the source data and supplement reproducible

Candidate material: `data/wals-cleaned/` and `scripts/build_wals.py` on the source
commit. Reimplement the adapter under `pipeline/wals/`; do not import the large
cleaned CSVs into main's history.

- [x] Pin recoverable inputs by immutable revision, size, and checksum. Preserve
  the original cleaned snapshot as a comparison artifact outside Git. Include
  the raw tables and bibliography needed to reproduce observations and citations.
- [x] Implement source restoration/verification and an explicit build command.
  Reproduce the cleaning from pinned raw inputs, or independently compile raw
  inputs and reconcile every difference from the reviewed cleaned snapshot.
  A historical audit alone is not proof of reproducibility.
- [x] Define a versioned internal schema for source records, feature definitions,
  categories, observations, references/page locators, and provenance. Keep source
  identity independent of atlas IDs; retain records with no shortlisted values.
- [x] Validate IDs, duplicate observations, foreign keys, category membership,
  reference resolution, and finite/in-range coordinate pairs. Preserve valid
  zero coordinates and distinguish missing coordinates from invalid ones.
- [x] Separate factual feature definitions from editorial labels and the card
  selection policy. Preserve source qualifications needed to interpret values;
  render source content safely without injecting raw HTML.
- [x] Generate deterministic output with atomic replacement and a report of
  counts, omissions, provenance, and checks. Failures preserve the prior artifact.
- [x] Add source notices and resolvable bibliographic entries. Retain full source
  observations in the recoverable archive even though the browser uses seven
  features. Document the scope of the export.
- [x] Add small synthetic pipeline tests and a separate full-snapshot check.

Acceptance: pinned sources reproduce the supplement; differences from branch
data are explained; invalid inputs fail meaningfully; citations resolve. Ordinary
tests do not download sources or require generated browser files.

### WALS-02 — Introduce the repository and identity-aware navigation

Candidate material: `app/src/domain/wals.ts` and the matching logic in the branch
builder. Suggested owners are `data/walsRepository.ts`, `domain/wals.ts`,
`features/wals/state.ts`, and `integrations/wals/`.

- [x] Create a lazy, retryable repository loader with runtime schema validation
  and reusable indexes by source ID, feature/category, and identifiers. Share
  successful/in-flight work without letting loading callbacks change navigation.
- [x] Implement the association policy above in the atlas integration. Produce
  diagnostics by match method, ambiguity, and catalog level. Explicitly review
  the old 37 family associations and ten ISO fallbacks; count changes need reasons,
  not forced agreement with the prototype.
- [x] Keep broad associations visibly scoped to the recorded variety. Do not
  automatically substitute a descendant catalog language for a family node.
- [x] Model actions for selecting a variety, inspecting a source observation,
  showing/focusing examples, and clearing the overlay. Preserve per-profile
  choices above component lifetimes; keep WALS state separate from lexical state.
- [x] Specify inspection behavior for unmatched records: retain WALS evidence
  and show an explanation instead of opening an unrelated atlas profile.
- [x] Cover ambiguous IDs/ISO, unresolved explicit Glottocodes, source-defined
  atlas entries, broader scope, zero/missing coordinates, and multiple varieties.
  Include the Irish (Donegal), Kyuquot, and Eastern Aleut navigation regressions.
- [x] Test HTTP failure, invalid JSON/schema, retry, concurrent consumers, late
  completion, and store isolation with fixtures, without full datasets.

Acceptance: navigating to an observation preserves its exact source record and
feature; loading cannot reset current choices; missing/ambiguous associations
remain explicit. These contracts pass without rendering the map or profile UI.

### WALS-03 — Complete delivery before exposing the feature

- [x] Add an independent `wals-release.json` and ignored browser/source output
  directories, proposed as `app/public/wals/` and `data/wals/`.
- [x] Implement explicit pack, verify, restore, and offline-install operations
  under `pipeline/wals/`, reusing appropriate `pipeline/release_utils.py` helpers.
  Keep source recovery separate from the browser asset. Avoid a broad release
  framework refactor merely to add this dataset.
- [x] Record source/schema/adapter versions, producer commit, file inventory,
  sizes, hashes, and notices. Verify complete bundles before exposing restored
  output; preserve existing modified installations on mismatch.
- [x] Prepare and publish the reproducible artifacts through the repository's
  release workflow; verify restoration from the actual published pin.
- [x] Add restoration to deployment and an explicit `test:wals-snapshot` gate.
  Keep `npm test` fixture-based; no npm hook should silently download or compile
  WALS. Data restore must not rebuild or republish geographic/lexical bundles.
- [x] Check the seven-feature snapshot and current catalog associations together.
  If joins are embedded, enforce the catalog fingerprint contract here as well.
- [x] Verify the production base path, a clean installation, corrupted/missing
  artifacts, and rollback to a retained pin. Do not replace unrelated data pins.

Acceptance: a clean checkout can obtain the complete WALS browser data from its
pin and build the deployable site. Missing/corrupt release data fails CI clearly.
Source recovery remains possible without shipping raw tables to the browser.

### WALS-04 — Port the profile cards as the first visible increment

Candidate material: `features/wals/LanguageFeatures.tsx`, explanatory copy, and
styles. Rebuild their loading and state ownership using WALS-02.

- [ ] Add the section to the current profile layout without obscuring pinned-area
  actions, classification, or lexical navigation. Load WALS on first feature use;
  failures and retry stay inside the feature section.
- [ ] Use one documented card policy: word order and the regional comparison
  feature retain their slots with explicit unknown values; the optional third
  slot selects an observed shortlisted feature deterministically. Display source
  region and explain that the shortlist is editorial, not a uniqueness ranking.
- [ ] Preserve the selected variety per profile. Keep its identity and any
  broader catalog association visible, rather than only inside a disclosure.
- [ ] When inspecting a particular observation, reveal that feature even if it
  is outside the summary's three slots. Distinguish an unrecorded value from a
  recorded observation whose reference is unavailable.
- [ ] Provide usable citations, source/version information, definitions, and
  accurate English-only word-order illustrations. Retain unknown/non-dominant
  categories without fabricating an example.
- [ ] Add keyboard and narrow-layout checks, plus browser coverage for multiple
  varieties, broader associations, absent records/values, delayed loading, retry,
  profile closure/reopening, and workspace round trips.
- [ ] Check actual rendered cards as well as selection helpers: the prototype's
  helper tests did not detect that the UI hid an unknown comparison slot.

Acceptance: cards and citations work in the deployed-data build; session choices
survive navigation; existing atlas and word-history interactions still work.
No map action is exposed until WALS-06 makes it functional. This increment can
land and ship independently of the map visualization.

### WALS-05 — Define shared-feature exploration and its representation

Candidate material: `domain/featureConnections.ts`. Keep reusable pure selection
and geometry functions after repair; remove the unused regional-comparison helper
unless a concrete caller is introduced within this scope.

- [ ] Compare categorized points with the prototype's arcs using the same real
  examples. Recommended default: points and an explicit origin, with a list of
  observations. Retain arcs only if their explanatory value warrants the visual
  similarity to word-history links. Record the chosen representation and rationale
  before implementing the final map UI.
- [ ] Keep exact feature/category matching and a maximum of 12 examples with
  deterministic geographic spacing. State that this is an illustrative selection,
  not a representative sample, similarity ranking, or relationship graph.
- [ ] Define eligibility and counts separately: matching source records, located
  records, grouped candidates, and displayed examples. Retain records without
  atlas matches where they have usable points; those can still open WALS evidence.
- [ ] If grouping multiple records by atlas association, keep the exact selected
  source record and disclose grouping. Do not present an atlas-deduplicated count
  as a count of all WALS observations. Handle colocated records explicitly.
- [ ] Test stable selection, missing/invalid locations, no candidates, limits,
  and distinct varieties. For retained arcs, repair the exact +/-180 case and
  cover identical points, antipodes, poles, and both dateline directions.
- [ ] Derive static geometry once per selection; if animation is retained,
  measure its update cost and honor reduced motion. Avoid recomputing full
  great-circle paths on every animation frame.

Acceptance: the representation, sampling, grouping, and count meanings are
documented and backed by deterministic tests. A representative review shows how
this overlay differs from actual recorded word-history relationships. If arcs
are dropped, record that scope decision rather than claiming they were ported.

### WALS-06 — Integrate the map without replacing current behavior

- [ ] Compose optional WALS layers and summary through `GeographyWorkspace`'s
  existing slots. Move app-level composition to a neutral owner if necessary so
  it can host both lexical and WALS integrations. Preserve lazy loading and the
  mounted map; do not import WALS implementation into `WorldMap` or copy the old
  `InspectionHighlight` rename.
- [ ] Add explicit show, focus, inspect, and clear controls. Show establishes the
  source/feature specification; inspection preserves it. Clearing WALS leaves
  lexical state, pinned entries, and profile choices intact.
- [ ] Use shared camera intent, cancellation, and dateline-aware bounds. Opening
  a WALS example's atlas profile should use inspection without an automatic map
  move; focus remains an explicit action. No delayed bounds/data result may
  override a newer manual, profile, lexical, or WALS action.
- [ ] Support the user's globe/Mercator choice without automatic projection
  switching. If the chosen visualization requires an exception, document and
  review that interaction before introducing it; do not restore a stale saved
  projection over a newer user choice.
- [ ] Allow lexical and WALS overlays to retain independent visibility/state,
  with clearly distinct labels, legends, and clear controls. Define hit priority
  so an observation click does not also activate the underlying polygon inspector.
  Do not silently clear one exploration when showing the other.
- [ ] Provide keyboard-equivalent inspection for every displayed record and an
  understandable empty state. Avoid adding an unexamined dependency on the demo
  font server; use the existing marker approach or explicitly supplied font assets.
- [ ] Run production browser scenarios for origin/feature changes, exact-variety
  clicks, unmatched examples, simultaneous overlays, pinned polygons, style and
  projection changes, reduced motion, late loading, and interrupted camera moves.

Acceptance: shared-feature exploration works with existing Geography and Word
histories; the Irish (Donegal) click reveals the same observation that produced
the marker. No WALS action corrupts pinned comparisons, lexical exploration,
camera ownership, or the user's projection. The map increment can now ship.

### WALS-07 — Finish acceptance, documentation, and handoff

- [ ] Run frontend unit/lint/typecheck/build gates, WALS pipeline/release tests,
  the explicit snapshot gate, and the WALS production browser suite against the
  final pins. Run affected profile-focus, selection, and word-trail regressions.
  Broaden testing when changed shared code or failures justify it.
- [ ] Measure cold feature loading, parsing/indexing, profile switching, selection,
  and overlay rendering on a recorded environment. Check that unrelated browsing
  does not eagerly load WALS. Add workers/sharding only if measurements warrant
  them; the prototype's 1.1 MB size alone does not justify either.
- [ ] Repeat clean-checkout restoration and deployment preparation for the final
  app/data combination. Record actual publication and deployment outcomes.
- [ ] Update root/frontend READMEs, `DATASETS.md`, architecture/session ownership
  documentation, and `pipeline/wals/README.md`. Explain matching scope, missingness,
  citations, sampling, session persistence, restoration, rebuild, and rollback.
- [ ] Remove abandoned prototype paths, duplicate policy definitions, dead helpers,
  and unnecessary map renames. Do not change unrelated geometry/color systems.
- [ ] Record remaining limitations and the status of every stage in this roadmap.

Acceptance: required checks pass or have an explicitly resolved scope decision;
the final artifact can be restored and served independently of development data;
documentation describes the delivered behavior. Passing unit tests alone does
not complete the port.

## Validation and execution records

Use synthetic fixtures for normal tests and explicit integration commands for
the full snapshot. New command names in this plan, including
`test:wals-snapshot`, describe deliverables and do not exist yet. Record runnable
commands when their stages are implemented. Existing frontend baseline commands
are `npm test`, `npm run check`, `npm run typecheck`, and `npm run build` from
`app/`; existing browser runners are documented in `app/tests/browser/README.md`.

Store generated evidence under ignored paths such as
`app/test-results/wals-00/` through `app/test-results/wals-07/`. Keep concise
durable results here; do not commit generated datasets or browser artifacts.

For each stage, append:

- Date, implementation revision, source/data pins, and environment.
- Delivered behavior and design decisions, including deviations from this plan.
- Commands and outcomes; distinguish fixtures, snapshot checks, and browser runs.
- Remaining limitations, artifact paths, and the next concrete action.
- Integration/publication/deployment status where applicable.

### WALS-00 execution — 2026-11-12

Scope: baseline only, as clarified by the user. Application code, data pins,
and installed datasets remain unchanged. Work began on existing `main` at
`49dc003f62b5e16f5126ac1ee249d7a354f288d2`; the only initial working-tree
change was this untracked roadmap. The source revision and common ancestor
still match the reviewed baseline (29 main commits versus one source commit).
Remote heads were not refreshed. No implementation branch or commit was created
for this documentation-only baseline; create the port branch when implementation
begins. No publication or deployment was performed.

Environment: Linux, Node 24.14.0, npm 11.9.0, Python 3.12.3, Firefox 156.0,
geckodriver 0.37.1. `npm ls --depth=0` passes with installed dependencies.
The environment record includes the platform, package-lock checksum, revisions,
pin contents, and pin-file checksums.

Data baseline:

- Geographic pin: `atlas-data-2026-11-10-metadata`, archive SHA-256
  `88a2e1c239465a1c6ca8fe64a959833ca2b15af99292b5dff1c5cbb76a1ec8ff`.
  `pipeline.atlas.data_release.release_files` validates the active schema and
  inventory: 62,629 files, 325,819,478 bytes, 27,180 catalog entries, and 14,357
  geometry variants. The catalog checksum and manifest are recorded. This checks
  the installed inventory, not byte-for-byte equivalence to the release archive;
  no clean restoration or geographic preprocessing was performed.
- Lexical pin: `word-trails-diacl-2026-10-24-v1`, browser archive SHA-256
  `ab92976293566024407c135cae4cfab710be987138d000fbdef14bc6e7ad2042`.
  `python3 -m pipeline.etymology.data_release verify` passes against the installed
  browser bundle, including its pinned file sizes and hashes.
- The optional local `datasets/wals` checkout is at `v2020.5`, commit
  `f97440d6edbaed0097d1bd307a5a20ea3f09e271`, and does not contain the branch
  audit's `v2020.6` tag. WALS-01 must recover and verify the intended immutable
  source snapshot; it must not silently reuse this older local checkout.

Integration assumptions rechecked against unchanged main:

- `GeographyWorkspace` retains its mounted map and accepts generic map-layer and
  sidebar-header slots. `GeographyWithWordTrail` owns lazy lexical composition.
- `LanguageMapCamera` and `WordTrailLayer` honor shared `mapCameraIntentAtom`
  ownership. `openLanguageDetailsAtom` supports inspection with `moveMap: false`.
  The planned WALS integration still fits these boundaries.

Frontend checks, run from `app/`:

| Check | Result |
| --- | --- |
| `npm test` | 261 passed outside the sandbox; none skipped |
| `npm run check` | Passed; 205 files checked, no fixes |
| `npm run typecheck` | Passed |
| `npm run build` | Passed; existing large-chunk and plugin-timing warnings |

The first sandboxed unit run failed two architecture-boundary tests because
`spawnSync node` returned `EPERM`. Firefox/geckodriver also could not start through
Snap inside the sandbox. The authorized runs outside the sandbox resolve these
environment restrictions; they are not application regressions. Both unit logs
are retained so the initial failure is not mistaken for an unqualified pass.

Browser checks reuse the production build and installed real atlas/lexical data,
with the runners' normal headless settings and basemap disabled. Profile-focus
and selection checks passed using their existing `check_focus`/`check_selection`
functions with `browser_session` and `open_atlas`, redirecting evidence to this
stage's directory. Canonical rerun commands from `app/` are
`python3 tests/browser/focus.py` and `python3 tests/browser/selection.py` (these
write to their standard report directories).

Word-trail acceptance passed all 18 checkpoints with
`python3 tests/browser/word_trail.py --output test-results/wals-00/word-trail`.
This includes stale profile-bounds cancellation, explicit camera focus, preservation
of pinned comparisons, missing-coordinate/antimeridian fixtures, both projections,
style restoration, and narrow-layout workspace round trips. No application test
failures remain in the baseline checks; no WALS behavior was introduced.

Evidence is under ignored `app/test-results/wals-00/`: `environment.json`,
`atlas-inventory.json`, `checks.json`, `unit-unsandboxed.json`, command logs,
`browser-checks.json`, and the `focus/`, `selection/`, and `word-trail/` browser
reports/screenshots.
The sandboxed result in `checks.json` is superseded by `unit-unsandboxed.json`.
At the end of this baseline run, WALS-00 was complete and WALS-01 was next.
See the subsequent execution record below for current progress.

### WALS-01 execution — 2026-11-12

Complete on local branch `port/wals-data`, based on main
`ab16007a34999308c70670ff2704ff5b65f66b9c` (the baseline roadmap commit).
The user explicitly requested the latest available WALS snapshot, regardless of
the local checkout or prototype. Upstream's latest release, its annotated tag,
and current `master` all resolve to **v2020.6**, commit
`81298aa26d01fdc11b769bcc7fa87ad9e43d7ccd`, published 2026-09-28. The publisher's
download page agrees. No newer default-branch data was available at verification.
The version therefore happens to match the prototype audit; the local v2020.5
checkout remains untouched and is not an adapter input.

Delivered under `pipeline/wals/`:

- `sources.json` pins the immutable upstream archive (12,264,263 bytes) and 20
  extracted files by size/SHA-256. Restoration retains the complete archive,
  including raw tables, full CLDF observations, bibliography, notices and errata.
  Network and offline-archive restoration both verify before atomic installation;
  an existing modified installation is rejected and preserved.
- `comparison.json` separately pins all four historical cleaned/audit files from
  source commit `3b7078614efcfebc1c471fea2c4ab7fb336745a6`. They are recovered outside
  Git for comparison, not used to generate the new supplement.
- `build.py` independently compiles the upstream CLDF tables into schema/adapter
  version 1. It validates all IDs, declared foreign keys, category memberships,
  value codes, bibliography references, unique observation pairs and coordinates
  before applying the seven-feature export scope. No atlas dependency or joins
  are embedded. Missing source values and all 2,662 source varieties are retained.
- The bundle carries factual feature/chapter definitions, exact observations,
  bibliography and page locators, cited examples, provenance, notices, errata
  and validation diagnostics. Descriptive markup becomes plain text. The narrow
  normalized-BibTeX reader rejects unsupported syntax rather than guessing;
  five sparse published citations without titles remain explicit diagnostics.
- `snapshot.py` independently reconstructs every field in all three historical
  cleaned tables and writes complete added/removed/changed rows before enforcing
  reviewed counts. It found **zero semantic differences** across 2,662 language
  records, 76,475 observations and 1,143 categories. All 12 CSV hash discrepancies
  are explained by LF versus CRLF endings; the metadata JSON and bibliography
  hashes agree exactly. This is a fresh comparison, not reliance on the old audit.
- Source/build/schema instructions and CC BY 4.0 attribution are in
  `pipeline/wals/README.md` and `NOTICE.md`. Root documentation now describes
  this stage and explicitly preserves source-variety scope instead of rolling
  WALS values up to atlas parents.

The supplement contains 5,517 observations, seven features, 33 categories,
5,915 bibliography entries and 46 cited examples. All 935 varieties without
shortlisted observations remain present. The 70,958 observations outside the
shortlist are validated and retained in the recoverable source archive. The
published errata flag Orok / 87A; this stage keeps the published value and its
caveat rather than silently applying a correction. WALS-04 must make these
caveats available alongside the cards.

Validation on Python 3.12.3 and the WALS-00 frontend environment:

| Command/check | Result |
| --- | --- |
| `python3 -m pipeline.wals.sources restore --archive /tmp/wals-01/upstream.tar.gz` | Passed; pinned offline recovery |
| `python3 -m pipeline.wals.sources restore --output /tmp/wals-01/network-restore` | Passed; fresh download through the implemented restore path |
| `python3 -m pipeline.wals.sources restore-comparison --from-git .` | Passed; verified four historical inputs |
| `python3 -m pipeline.wals.build` | Passed; full validation and atomic supplement generation |
| `python3 -m pipeline.wals.snapshot` | Passed; full counts and zero unexplained differences |
| `.venv/bin/pytest -q pipeline/tests/test_wals.py` | 39 passed; fixture-only, no downloads/generated-data prerequisites |
| `.venv/bin/ruff check pipeline/wals pipeline/tests/test_wals.py` | Passed |
| `.venv/bin/ruff format --check pipeline/wals pipeline/tests/test_wals.py` | Passed |
| `npm run build` from `app/` | Passed; existing chunk-size/plugin-timing warnings |
| Repeated build and independent fresh-restoration build | Identical bytes; unchanged output mtime for an identical rebuild |

Tests cover invalid/partial/nonfinite coordinates, evidence outside the shortlist,
broken joins/references, duplicates, malformed bibliography, source identity and
missingness, complete field-level comparison, modified installations, corrupted
archives, unsafe members/paths, and preservation of the old output when validation
or atomic replacement fails. No frontend code changed, so the WALS-00 browser
baseline was not repeated. No new dependencies or npm hooks were added.

The current bundle is 4,948,094 bytes (836,639 bytes with local gzip), SHA-256
`5ed6085ae55662cce317a0183fb122fad37caca026b43c6a1b9a57e2a3c0a580`.
It is larger than the prototype because it retains the bibliography, examples
and source evidence. These are file-size measurements, not browser performance
results; loading/indexing measurements remain for frontend integration.

Generated evidence lives under ignored `app/test-results/wals-01/`, including
`upstream-check.json`, `snapshot.json`, `reproducibility.json`, and build logs.
Inputs are under ignored `data/wals/`; output is ignored
`app/public/wals/features.json`. No large input tables were added to Git. Existing
atlas/lexical pins and application code are unchanged. The work is local and
uncommitted; no release publication, main integration or deployment occurred.
Independent release packaging/restoration remains WALS-03.

WALS-01 completed the source/adapter stage. WALS-02 follows below; independent
release delivery remains WALS-03.


## WALS-02 execution record

Completed 2026-11-12 on `port/wals-identity`, based on the user's committed
WALS-01 revision `c1b6f33`. The working tree was clean before this stage.
The reviewed source branch remains
`3b7078614efcfebc1c471fea2c4ab7fb336745a6`; no branch code was merged wholesale.

Implemented:

- `domain/wals.ts` and `walsValidation.ts` define and validate schema/adapter v1
  before indexing source records, observations by feature/category and complete
  source identifiers. Coordinates, citations, examples, category membership,
  foreign keys and duplicate observations are checked at the browser boundary.
- `data/walsRepository.ts` loads lazily from the production base path, shares
  in-flight/successful work and retries HTTP, network, JSON, schema or synchronous
  request failures. `features/wals/state.ts` publishes only data/loading status;
  its completion cannot initialize or overwrite navigation. Errors and pending
  publication remain scoped to each Jotai store.
- `integrations/wals/languageMatching.ts` resolves classification metadata against
  complete catalogs. Explicit unresolved Glottocodes never fall back to ISO.
  Primary ISO requires an absent Glottocode and uniqueness on both complete sides.
  Source-defined entries and broader family/group links have explicit scope;
  observations remain on source varieties, with no descendant substitution.
  Optional reviewed overrides require reasons and unchanged expected identifiers;
  none are shipped.
- `features/wals/session.ts` stores per-profile source/feature choices, standalone
  inspection and one source/feature/visibility/max-example overlay specification.
  `integrations/wals/state.ts` validates explicit actions, inspects associated
  profiles without moving the map and retains unmatched/ambiguous evidence with
  an explanation. Late catalog resolution cannot open a profile. Choices survive
  profile closure, component remounts and workspace switches; stores stay isolated.
- Show/focus models use shared camera-intent identity. Newer navigation/manual
  motion, workspace changes, hide/clear and overlay replacement invalidate older
  requests. Unhide, workspace return and data completion never replay focus.
  Sampling, geometry and the actual map consumer remain WALS-05/WALS-06.

The [association review](app/src/integrations/wals/ASSOCIATION_REVIEW.md) explicitly
records all 37 prototype family associations and ten ISO fallbacks. All retain
their targets and methods. The only target availability change is Albanian
(`alb`): absent Glottocode, unique primary ISO `sqi`, associated with family node
`alba1267` with broader scope. The prototype's language-only ISO lookup omitted
that node. No identifier was edited and no variety merged to obtain these counts.

| Association check | Current result |
| --- | --- |
| Source records | 2,662 |
| Associated / unmatched / ambiguous | 2,656 / 6 / 0 |
| Glottocode / unique ISO / overrides | 2,645 / 11 / 0 |
| Catalog language / dialect / family | 2,572 / 46 / 38 |
| Exact identifier scope / broader scope | 2,618 / 38 |
| Changed prototype target availability | Albanian only |

The six unmatched records have neither a Glottocode nor a primary ISO: Arrernte,
Azerbaijani, Lesser Antillean French Creole, Mambila, Marquesan and Tasmanian.
Their evidence is retained. Fixture tests exercise ambiguous and source-defined
cases absent from this snapshot; matching the counts alone is insufficient.

Validation in the WALS-00 Node/frontend environment:

| Command/check from `app/` | Result |
| --- | --- |
| `node --test --test-isolation=none tests/wals-*.test.ts` | 23 fixture tests passed; no generated data/download prerequisite |
| `node --test --test-isolation=none tests/integration/wals.test.ts` | 2 full-data checks passed; complete association report and real navigation regressions |
| `npm test` | All 284 tests passed, including the 261 existing tests; subprocess access used as in WALS-00 |
| `npm run check` | Passed; generated WALS directory excluded alongside other generated data |
| `npm run build` | Passed, including TypeScript; existing chunk-size/plugin-timing warnings |

Tests cover retry/concurrency, malformed payloads, late completion, store isolation,
ambiguous source/target IDs and ISO codes, unresolved explicit Glottocodes,
source-defined catalog entries, broader scope, zero/missing coordinates, per-profile
choices and the Donegal / 12A, Kyuquot / 37A and Eastern Aleut / 12A regressions.
The explicit full-data check also verifies these cases against actual source
observations whose default associated varieties lack the requested value.

Evidence is in ignored `app/test-results/wals-02/`: `unit.log`, `build.log` and
`associations.json`. The latter records input SHA-256 fingerprints, every source
association/reason and the prototype comparison. Local Node validation, indexing
and matching timings are included as diagnostics; they are not browser performance
acceptance. Browser UI checks were not rerun because no WALS controls, map effects
or production imports were mounted and existing behavior was unchanged.

[Frontend contracts](app/src/features/wals/README.md) document action behavior,
unmatched evidence, catalog publication, loading ownership and the later camera
consumer's cancellation obligation. Existing geographic/lexical pins, application
entry points and URL schemas remain unchanged. The work is local and uncommitted;
no release was published, no main integration or deployment occurred.

WALS-02 completed the repository/identity contracts. Independent delivery follows
in the WALS-03 record below.


## WALS-03 execution record

Completed 2026-11-12 on `port/wals-release`, based on the user's committed WALS-02
revision `edd09ee446c46f7bc1749fdfb5e8e4582722112d`. The working tree was clean
before this stage. That unchanged adapter producer was already available on
GitHub; publication required no code push or main merge.

Published independent data release:
[`wals-v2020.6-v1`](https://github.com/maximemulder/lang-viz/releases/tag/wals-v2020.6-v1).
It targets the adapter producer above, uses upstream v2020.6 commit
`81298aa26d01fdc11b769bcc7fa87ad9e43d7ccd`, and did not become the repository's
latest application release. Both actual published archives and the uploaded pin
were downloaded and verified, independently of the local packaging directory.
The selected `wals-release.json` was written only after publication succeeded.

| Asset | Compressed bytes | SHA-256 |
| --- | --- | --- |
| `wals-browser.tar.gz` | 849,232 | `cbcbbe0920841485c574414258d4655af2cb1a9ee8a17353b832aa23343da35e` |
| `wals-sources.tar.gz` | 14,162,857 | `97ec60b3ab83bc35e85b389aaa5373e4da920846351fda6936c2b0e069f5cdb2` |

Implementation and decisions:

- `pipeline/wals/data_release.py` implements explicit pack, verify, restore,
  offline install and publish operations using the existing shared archive/hash
  utilities. The atlas and lexical release implementations are unchanged.
- The browser archive has six files: compiled source evidence, a provenance/count/
  inventory manifest, source pin, attribution notice, complete license and errata.
  The separate source archive has all 20 pinned extracted inputs, the complete
  original upstream archive, source pin and notice. Neither raw inputs nor a source
  archive are deployed. Source restoration/building remains independent of release
  installation.
- Packaging recompiles the pinned sources and rejects stale/modified compiled
  output. Repeated packaging produces identical archive and pin bytes. The release
  pin records source/schema/adapter versions, producer commit and complete per-file
  and archive inventories. Verification cross-checks schema, source identity,
  manifest counts, provenance, notices and sizes/hashes before installing.
- Installation stages within the destination filesystem, rejects unsafe/duplicate/
  missing/extra archive members, links and corrupt bytes, and exposes only a
  verified complete directory. Existing different/modified installations are
  preserved. The previous one-file local browser build was retained at ignored
  `.data-releases/wals-03-before-release/` before installing the published files.
- Publication rejects existing tags, verifies both assets before external writes,
  uploads a draft, publishes with `--latest=false`, then selects the pin. Failed
  create/publish operations leave the selected pin unchanged. No unrelated data
  release or pin was rebuilt or published.
- Deployment now restores the WALS browser pin independently and runs the explicit
  `npm run test:wals-snapshot` gate. It authenticates the full release, checks the
  current source pin, seven feature/count expectations, complete current catalog
  associations and exact-variety navigation. No joins are embedded in the source
  bundle, so no atlas fingerprint is needed to invalidate stale precomputed joins.
- `npm test` remains fixture-only. No npm lifecycle hook downloads/builds WALS.
  The development watcher excludes generated WALS files alongside other data.
  A separate production-build test consumer exercises the real repository loader;
  it adds no application route or WALS controls.

Validation:

| Check | Result |
| --- | --- |
| WALS adapter/release fixture tests | 39 + 35 passed; no data/download prerequisites |
| WALS plus existing lexical/geographic release tests | 118 passed |
| Ruff lint and format checks | Passed for WALS pipeline/tests and browser runner |
| `npm test` | All 284 frontend tests passed |
| `npm run check` / typecheck | Passed; production builds also run TypeScript |
| `npm run test:wals-snapshot` | 3 full-data checks passed against installed published data and isolated clean installation |
| Existing `npm run test:etymology-snapshot` | 3 checks passed in the isolated clean installation |
| Package twice with identical producer/source | Both archives and pin byte-identical |
| Restore/build from packaged complete upstream archive | Output byte-identical to selected browser payload |
| Rebuild directly from downloaded published source asset | Output byte-identical to selected browser payload |
| Restore both actual published assets and download published pin | Complete inventories and pin bytes verified |
| Missing/corrupt installation through actual npm snapshot gate | Both failed as expected with missing-file/checksum diagnostics |
| Firefox delivery under `/lang-viz/` | Five checkpoints passed for candidate and downloaded published data |
| Main and isolated clean `GITHUB_PAGES=true npm run build` | Passed; existing chunk-size/plugin-timing warnings |
| Both production `dist/wals/` inventories | Exact release matches; no raw/source archives or test-only consumer shipped |

The isolated check used a local clean clone with the candidate code changes copied
in, no generated datasets or dependencies, and a fresh `npm ci` with a temporary
cache. It restored WALS from GitHub through the selected pin. Existing pinned atlas
and lexical archives were installed offline and verified, without preprocessing or
republishing them. The checkout had no WALS source directory. Frontend lint, both
snapshot gates and the production project-path build passed. Dependency lockfile
and existing atlas/lexical pins are byte-identical to the starting commit.

The Firefox runner uses the actual production repository loader in a separate
compiled fixture: lazy loading, concurrent request sharing and successful caching;
manifest/pin/license/errata serving; HTTP 404, invalid JSON and incompatible schema;
and retry. Requests use `/lang-viz/` and no geographic/lexical/source archives.
This is delivery acceptance, not WALS profile/map UI or performance acceptance.

Rollback was verified with two fixture releases containing different payloads:
install the newer release, reject an attempted overwrite with the retained old
pin, preserve newer data, and successfully restore/verify the old pin in a fresh
directory. This is the first published WALS release, so there is no earlier live
WALS pin to roll back to; retain v1 and its assets for future rollback.

Evidence is under ignored `app/test-results/wals-03/`: publication metadata,
verification summary, pipeline/unit/build/snapshot logs, association report,
expected CI-failure logs, clean build/dependency logs and Firefox reports/screenshots.
Local archives are under `.data-releases/wals-v2020.6-v1/`. Documentation in the
pipeline, frontend contracts and root guides records restore, offline install,
source recovery, production checks and rollback procedures.

The data release is published and verified. Code, selected pin and workflow edits
remain local and uncommitted; no main merge, remote CI run or Pages deployment was
performed. WALS-00 through WALS-03 are complete. WALS-04 is next: mount the language
profile cards using these repository/session/delivery contracts.
