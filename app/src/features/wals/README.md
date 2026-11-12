# WALS repository, session, and atlas integration

WALS-02 supplies data and navigation contracts; WALS-03 supplies the published,
independently pinned release and deployment gate. WALS-04 mounts the profile
cards, loading data only after the first **Load WALS features** action. Retry and
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
The variety selector, recorded source name/ID, source macroarea and any broader
catalog association remain outside disclosures. A saved unavailable source ID is
shown explicitly and is never silently replaced.

`cards.ts` owns the single editorial summary policy. Word order (81A) always has
a slot. The other required slot is the best-covered shortlisted feature in the
source macroarea, counting each WALS variety once, including unmatched records.
Equal coverage follows 13A, 12A, 30A, 87A, 37A, 92A. Even a zero-coverage region
retains the first available comparison feature. Neither required slot is removed
when its observation is absent. An optional third card is the first observed
extra in priority order 13A, 30A, 12A, 37A, 92A, 87A. An inspected observation
outside these slots is appended, without duplication. Coverage is cached per
validated repository identity. This is an editorial shortlist, not a uniqueness
ranking or a representative sample; the UI explains the policy.

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

The observation selector uses the validated inspection action to preserve exact
source/feature IDs. Each recorded card offers **Show recorded examples on map**;
unrecorded values have no show action. Keyboard controls use native buttons,
selects, disclosures and links. Narrow profiles retain the existing internal
scrolling and keep cards and selects within their container.

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

The overlay stores only source/feature IDs, visibility and a maximum of 12 examples.
WALS-05 derives exact-category examples and static point geometry through
`walsExampleSelectionAtom` and `walsExampleGeometryAtom`. Selection uses the source
ID, feature ID and limit, independently of atlas associations and UI visibility.
`integrations/GeographyExplorations.tsx` composes lazy WALS and word-trail layers
and summaries through Geography's slots. `WalsLayer` renders static DOM markers;
`WalsMapSummary` supplies counts, controls and an accessible list. Single markers
inspect exact source/feature evidence; shared positions open a chooser with every
displayed record. WALS markers sit above lexical markers; marker and popup mouse
events stop before the underlying polygon inspector. See the
[exploration design](EXPLORATION_DESIGN.md) for the points-versus-arcs decision,
deterministic spacing, count definitions and colocation policy.

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

**Show recorded examples on map** establishes the overlay and explicitly focuses
Geography. Subsequent inspection changes only source evidence/profile choices,
never the overlay origin or camera. **Focus WALS examples** issues fresh intent.
Hide/show preserves the selection and never replays focus; **Clear WALS overlay**
leaves word-history state, profile choices and pinned comparisons intact. The
keyboard list includes the origin (also when unlocated) and every selected source
observation. Missing origin locations and zero candidates are explicit.

The neutral composition keeps the mounted map and caps the combined summary
container at 45% of the sidebar; it scrolls independently of the language finder.
Word histories has its own hide/show control. Its hidden sequence lives in
`integrations/etymology/visibility.ts`; hiding cancels only owned focus, and a fresh
explicit show/focus restores visibility. Neither overlay changes the other's
visibility, source specification or pinned map entries.

Globe and Mercator are retained as selected. Focus uses shortest-arc longitude
bounds on globe. The map's existing single-world Mercator cannot fit an unwrapped
dateline arc, so those selections use world-width bounds, with a note in the
summary. No projection or world-copy setting is temporarily changed/restored.
WALS uses system-font DOM markers; it adds no map glyph/font-server dependency.
Reduced-motion focus has zero animation duration.

`npm run test:wals-map-browser` builds and exercises the deployed-base application
with the actual published data and explicitly labelled coordinate fixtures served
by a local proxy. Installed data is unchanged. Reports and screenshots are under
`test-results/wals-06/`. The shared word-trail regression runner accepts
`--base /lang-viz/` for use against this same production build.
