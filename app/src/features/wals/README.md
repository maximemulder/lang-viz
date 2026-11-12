# WALS repository, session, and atlas integration

WALS-02 introduces data and navigation contracts without mounting controls or
fetching WALS from the running application. WALS-03 supplies independent release
delivery; WALS-04 mounts the first profile UI. Source/schema instructions remain
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
holds that catalog reference; the eventual UI/composition owner must publish
`atlas.languages` there, independently of geometry, filters and visible profiles.
There is currently no production caller. `walsAssociationsAtom` recomputes if the
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
summary. There is no feature inheritance or card policy in this stage.

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
explanation. It leaves the current atlas profile untouched. The forthcoming UI
must present this standalone source evidence, labelled with its source identity,
rather than render it as evidence for that previous profile. A later catalog
completion may resolve the explanation but cannot open a profile; another explicit
inspection is required. Inspection and variety selection stay in the current
workspace; show/focus explicitly opens Geography.

The overlay stores only source/feature IDs, visibility and a maximum of 12 examples.
Targets, counts, display design and geometry remain WALS-05. No map consumer is
mounted yet. WALS-06 must re-read `walsCameraRequestAtom` and compare the original
request identity after every asynchronous step, before moving the camera. It is
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

The ordinary 23 WALS tests use synthetic fixtures without downloads or generated
data. They cover retry/concurrency, late completion, store isolation, ambiguous
identifiers, source-defined catalogs, broad scope, missing/zero coordinates,
multiple varieties, exact observation navigation and camera arbitration.

After explicitly restoring/building WALS and restoring atlas data, run the separate
full-snapshot check:

```sh
node --test --test-isolation=none tests/integration/wals.test.ts
```

This writes `test-results/wals-02/associations.json`, including input fingerprints,
all associations and reasons, prototype comparison and Node timing measurements.
It checks the reviewed v2020.6 counts/changes and the real Donegal, Kyuquot and
Eastern Aleut regressions. A future source/catalog update must review those
expectations. It does not fetch/build datasets and is excluded from `npm test`.
