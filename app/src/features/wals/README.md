# WALS repository, session, and atlas integration

WALS-02 supplies data and navigation contracts; WALS-03 supplies the published,
independently pinned release and deployment gate. WALS-04 mounts the profile
cards, loading data automatically when a language profile is opened. Retry and
errors stay inside this section. Source/schema instructions remain
in [the pipeline documentation](../../../../pipeline/wals/README.md).

`data/walsRepository.ts` fetches `wals/features.json` relative to Vite's production
base path only when called. A loader shares its in-flight request and successful
validated/indexed repository; network, HTTP, JSON, validation and synchronous
request failures evict the promise for retry. The browser validates both schema
and adapter version 1, source fields, links, coordinates, foreign keys,
citations/examples, category membership, duplicate observations and category
numbers. Source strings remain plain text, including literal bibliography markup
and errata. Render them as text, never as injected HTML.

`domain/wals.ts` owns source-only types and indexes. `bySource` includes every
record, even those without observations, and maps feature IDs to observation IDs.
`byFeature` and `byCategory` index observations; `byGlottocode` and `byIso` index
all source records. Auxiliary `isoCodes` are preserved evidence, not automatic
fallback identifiers. Indexes are built once in stable ID order. Counts for UI
eligibility should be derived from these indexes; upstream diagnostics describe
the export, not map eligibility or a representative sample.

`loadWalsAtom` publishes only repository/loading state. Pending publication and
errors are store-local; the default repository loader can share data work across
stores. It reports errors through `walsLoadStateAtom` and resolves its action
promise after either success or failure. Calling it again retries an error.
It never initializes a selected variety, profile, overlay, workspace or camera.
Do not clear session atoms when a component unmounts or a request finishes.

## Associations and profile selection

`integrations/wals/languageMatching.ts` receives the complete ready atlas catalog
and computes associations in memory. The integration's `walsAtlasCatalogAtom`
holds that catalog reference; `LanguageFinder` publishes the complete ready
`atlas.languages` there, independently of geometry, filters and visible profiles.
`walsAssociationsAtom` recomputes if the
repository or catalog reference changes. No atlas IDs are saved in the source
bundle and no join can outlive its catalog reference.

Matching uses declared Glottolog classification metadata, never opaque catalog
IDs. An explicit missing/ambiguous Glottocode stays unresolved. Primary ISO is
eligible only without a Glottocode and when unique in both complete catalogs.
Multiple WALS varieties sharing a Glottocode remain separate source records under
one profile; they do not make an otherwise unique target ambiguous. Source-defined
catalog entries can associate by eligible ISO, with explicit `source-defined`
scope, but their IDs cannot masquerade as Glottocodes.

Every association has a source ID, method, catalog level, scope and explanation.
Family/group entries have `broader` scope, keep their own atlas ID, and never
substitute a descendant. `exact` means the declared identifier resolved to one
language/dialect entry; it does not imply identical coverage across all its WALS
varieties. All explanations retain the recorded source-variety scope. Unresolved
results distinguish missing identifiers, missing targets and ambiguity and retain
candidate IDs. Diagnostics count status, method, level, scope and failure reason.

Reviewed overrides are optional explicit data with a reason and expected original
Glottocode/ISO. Unknown/duplicate source or target IDs, stale identifiers and empty
reasons fail. None are shipped. The [association review](../../integrations/wals/ASSOCIATION_REVIEW.md)
records all 37 prototype family links, ten ISO fallbacks and the one new broader
ISO association. Do not edit identifiers or collapse source records to force a match.

`resolveWalsProfile` derives a stable default from associated source IDs without
writing session state. Saved choices take precedence. An unavailable saved choice
remains identifiable with an explanation; it does not silently select another
variety. A saved inspected feature is exposed even when outside a later UI card
summary. There is no feature inheritance.

## Profile cards

`LanguageDetails` places `LanguageFeatures` after the existing profile actions and
word-entry navigation, within the existing scrollable profile body. Selected
varieties and inspected features live in session atoms, never component state.
The recorded source name stays visible; variety choice is inside a disclosure.
A saved unavailable source ID remains explicit. Defaults prefer a variety with
recorded sentence order, then the most recorded shortlisted features.

`cards.ts` selects at most three **observed** features. It prioritizes sentence
order (81A), followed by the best-covered regional comparison feature if recorded,
then other recorded shortlisted features. Missing observations do not take a slot.
An explicitly inspected feature replaces the last card instead of creating a fourth.
The regional comparison is an editorial summary, not a claim that all languages
in a region share a value. Coverage is cached per validated repository identity.

Each card provides a plain-language definition, chapter citation and links, plus
the exact observation's references, pages, comments and supplied examples.
Missing observations and recorded values without references have distinct copy.
The source bibliography stays separate from observation references. Missing
reference titles remain explicit; bibliography/LaTeX/errata strings render as
plain React text. Reordered English words illustrate only the six dominant 81A
categories, with explicit subject/verb/object roles and no translation claim.
Unknown and non-dominant values receive no invented illustration. Orok 87A keeps
its published value alongside the source-erratum warning. Version, original source
commit, citation, license, adapter notice and full supplied errata remain accessible.

Each card offers **Find languages like this**. Definitions, exact labels,
references and supplied examples are inside **What this means & sources**.
Sources and data remains a separate disclosure. Native buttons, disclosures and
selects support keyboard use; profiles retain their internal scrolling.

## Session and navigation actions

`features/wals/session.ts` stores per-profile source/feature choices, standalone
inspection and one overlay specification above component lifetimes. A new Jotai
store starts a new session. WALS has no URL fields or reload persistence. Existing
Geography/Word histories history remains owned by the explorer navigation adapter.

UI callers should use the validated actions in `integrations/wals/state.ts`:

| Action | Contract |
| --- | --- |
| `selectWalsVarietyAtom` | Requires a ready association to the requested profile; saves that profile's source choice, clears its previously revealed feature when the variety changes, cancels pending camera intent, preserves overlay origin |
| `inspectWalsObservationAtom` | Requires the exact source/feature observation; retains both IDs, saves an associated profile choice, opens that atlas profile with `moveMap: false`, cancels prior focus |
| `showWalsExamplesAtom` | Requires an observation; establishes one visible source/feature specification, opens Geography and issues explicit camera intent |
| `focusWalsExamplesAtom` | Issues fresh intent for the current visible specification; no-op without one |
| `setWalsOverlayVisibilityAtom` | Changes visibility, cancels WALS focus without replaying it when shown again |
| `clearWalsOverlayAtom` | Removes only the WALS overlay and owned focus request; retains profile choices, source inspection, lexical state and newer external camera intent |

Inspection with an unmatched/ambiguous association, or before the atlas catalog
is ready, retains the WALS record and observation in `walsInspectionAtom` with an
explanation. It leaves the current atlas profile untouched. The UI
uses `WalsStandaloneInspection` to present this source evidence, labelled with its source identity,
rather than render it as evidence for that previous profile. A later catalog
completion may resolve the explanation but cannot open a profile; another explicit
inspection is required. The inspection stores the profile ID opened by the
original explicit action, if any, so late association cannot hide a standalone
inspection or reopen a closed profile. Closing standalone inspection clears only
that inspection, preserving profile choices and the overlay. Inspection and variety selection stay in the current
workspace; show/focus explicitly opens Geography.

The overlay stores the selected source/feature IDs and visibility. The current
map uses `areaMatching.ts` and `areaState.ts` to match the exact recorded category
against explicit language/dialect associations and the already-built atlas variants
for the active geographic source and period. Broader family associations are never
expanded into descendants. Conflicting varieties are excluded from whole-area
claims; missing areas, unresolved links and conflicts are counted in the disclosure.

`WalsLayer` references the existing language-area vector source and original
variant IDs, preserving language colours. There are no WALS markers, flight lines,
country fills or generated replacement boundaries. The sidebar starts with a brief
summary; its keyboard-accessible language list renders only when expanded.

Map hover outlines an existing area and previews name, family and countries without
replacing the open profile. Click opens information. Double-click isolates the
language's existing areas; **Show all again** or Escape restores the view. Isolation
changes paint only and preserves pinned selections. Overlapping languages offer a
chooser. An isolation button is also available inside a profile's **More details**.

`integrations/map/overlayCamera.ts` is shared by both overlays. The WALS consumer
re-reads `walsCameraRequestAtom` and compares the original request identity after
style readiness and the animation-frame wait, immediately before moving the
camera. Projection-dependent bounds resolve only then. The request is
null after newer manual/profile/lexical/WALS navigation, a workspace switch,
overlay replacement, hide or clear. Style/projection changes, rendering and loading
must not create a request. Workspace return and unhide do not replay it.

## Checks

From `app/`:

```sh
node --test --test-isolation=none tests/wals-*.test.ts
npm test
npm run check
npm run build
```

The ordinary WALS tests use synthetic fixtures without downloads or generated
data. They cover retry/concurrency, late completion, store isolation, ambiguous
identifiers, source-defined catalogs, broad scope, missing/zero coordinates,
multiple varieties, exact observation navigation and camera arbitration.

After restoring the complete WALS browser release and atlas data, run the separate
full-snapshot check:

```sh
npm run test:wals-snapshot
```

This writes `test-results/wals-02/associations.json`, including input fingerprints,
all associations and reasons, prototype comparison and Node timing measurements.
It verifies the complete release inventory/provenance, current source pin and
seven-feature counts, then the reviewed v2020.6 associations and the real Donegal,
Kyuquot and Eastern Aleut regressions. A future source/catalog update must review those
expectations. It does not fetch/build datasets and is excluded from `npm test`.

Run `npm run test:wals-profile-browser` after restoring all three browser datasets
and installing Firefox/geckodriver. It builds a separate acceptance fixture using
the production components and a production `/lang-viz/` application build. The
fixture checks missing values/references, delayed/error/retry loading, multiple
varieties, inspected extra cards, safe bibliography text, standalone evidence and
keyboard/narrow-layout behavior. The full app checks the published snapshot,
Donegal navigation, broader Albanian scope, Orok errata and workspace/profile
round trips. Reports and screenshots are ignored under `test-results/wals-04/`.

For the offline WALS-05 points/arcs design review, run `npm run review:wals-examples`
with restored WALS/atlas browser data and the reviewed source Git object present.
It writes five real comparisons and exact observation tables to
`test-results/wals-05/review.html` and fingerprinted evidence to `review.json`. The
full-snapshot gate also checks example selection and point geometry for every
exported observation. Ordinary tests remain fixture-only.

## Map controls and coexistence

**Find languages like this** highlights all eligible existing language areas with
the selected recorded category and explicitly focuses Geography. Inspection retains
the overlay origin and does not move the map. Clearing highlights retains language
choices, word-history state and pinned entries. No new workspace is added.

The initial projection is Mercator; users can still change projection. Reduced
motion uses zero-duration focus. Overlay loading, style changes and geographic
filter changes do not replay a consumed camera request.

The historical WALS-04/05/06 browser and measurement scripts below document the
previous manual-loading and point-marker UI. Their UI expectations require updating
before use as acceptance gates for this revision. Current checks include the unit
suite, full snapshot integration test, build, and manual browser interaction checks.

## Measurements and handoff

`npm run measure:wals` explicitly reads the restored full snapshot and atlas
catalog, fingerprints both, and measures parsing/UTF-8 decoding, validation,
indexing, catalog association, first/cached card policy and selection/geometry for
five real origins. It does not fetch data or enter ordinary tests.

`npm run measure:wals-browser` builds the production application and performs
three cold-origin runs for each of loopback gzip delivery and WALS-only
10 Mbit/s +150 ms latency. It verifies no WALS request during ordinary atlas
browsing, one successful preparation/request across subsequent use, and times
first cards, cached atlas-profile and variety switches, and initial/subsequent
overlay paints. Input and matching render commits are timed inside the browser;
two animation frames include paint without WebDriver polling latency. Overlay
paint excludes completion of the optional camera transition. The runner can reuse
the final build directly with `python3 tests/browser/wals_performance.py`; use
`--runs` and `--output` to select repetition and ignored evidence destinations.

The production loader records `wals:receive` (request/body/decode), `wals:parse`,
`wals:validate`, `wals:index` measures and a `wals:prepared` mark once per
successful load. These are local User Timing entries with no reporting service.
Cache hits add no timings. Firefox's 10ms timer-gap probe includes scheduling,
garbage collection and map work; it is not a Long Tasks API measurement. The
desktop software-WebGL scenario does not establish slower-device CPU performance.

The [roadmap handoff](../../../../WALS_PORT_PLAN.md) records the environment,
results, clean-restoration evidence, remaining limits and separate publication,
integration and deployment statuses. URL/reload persistence and a profile
ergonomics redesign remain outside this port.
