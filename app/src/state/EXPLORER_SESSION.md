# Explorer session and navigation

ETY-02 defines session state and an explicit browser adapter. ETY-03 connects them
to the app shell/explorer; ETY-04 renders the atlas overlay and consumes camera
requests. Importing these modules does not read `window`, fetch data, change the
URL, or touch geographic selections.

## Ownership

`explorerSessionAtom` is a read-only view of a Jotai store-scoped session. Components
send typed actions through `explorerActionAtom`. The session survives workspace
component unmounts; a new Jotai store starts a new session. Existing geography
atoms retain ownership of pinned entries, representation, filters, and camera.
The session action adapter coordinates camera intent with language navigation;
geographic selection and filters remain outside it.

The lexical data loader publishes ready data to `etymologyRepositoryAtom` in
`features/etymology/state.ts`. That feature module owns `trailSpecificationAtom`,
`wordTrailAtom`, `atlasWordTrailAtom`, and `resolvedExplorerAtom`; its pure
resolution helpers live in `features/etymology/session.ts`. The shared session
contract, reducer, state, and URL adapter have no runtime dependency on lexical
traversal, resolution, or data loading. Repository caching/loading/retry remains
data-layer work; session actions and URL parsing do not wait for it.
`resolvedExplorerAtom` resolves the
**current** IDs and language target against ready data. A loading callback must
never initialize the word, comparison, scope, or workspace: that could overwrite
navigation performed while loading.

`trailSpecificationAtom` contains the root, ancestry depth, nearby-branch and
placeholder flags, and expanded IDs. `wordTrailAtom` derives the graph once from
that specification and ready data. When enabled, `atlasWordTrailAtom` returns
the same derived object, including after tracing another word. Clearing the
overlay leaves exploration state intact. A missing root yields no trail; an
unknown root yields an empty trail and an explicit resolution issue.

## Action behavior

| Action | Effect |
| --- | --- |
| `workspace` | Changes workspace; retains trail, evidence, comparison, query, and filters |
| `trace` | Opens word history; selects the new word; clears expansion, query/scope, and explicit concept/collection; preserves depth and global display/filter preferences |
| `view` / `select` | Changes visualization or selected word/relationship evidence |
| `expand` / `trail-options` | Updates the one canonical trail; expansion opens history |
| `comparison` | Opens comparison; explicit concept wins over root defaults; changing collection alone resets concept to a derived compatible default |
| `comparison-filter` | Retains family and include-missing preferences across navigation |
| `search` | Edits query/scope; editing text preserves scope, choosing a scope replaces an atlas target |
| `language-words` | Opens lexical exploration with a target classification and empty query; keeps the existing trail and comparison |
| `show-trail` | Enables the live overlay, opens Geography, and issues an explicit camera request; no-op without a root |
| `clear-overlay` | Hides the overlay and cancels pending camera focus |
| `restore-route` | Applies URL navigation; changing root resets word-specific evidence/expansion/discovery, while a workspace-only change preserves them |

Language targets use a unique exact Glottocode, never ISO-only reverse matching.
Ambiguous or source-defined targets produce an unscoped search and an explicit
match status, so the UI can provide a useful fallback. Unknown words, concepts,
collections, evidence, and lexical scope IDs remain identifiable as issues; they
are not replaced with an unrelated default word. An incompatible concept and
collection is reported without rewriting the requested IDs.

Only `show-trail` creates a camera request. After any asynchronous preparation,
the map consumer must call `isCurrentTrailFocus` with the original request and
the latest session before moving the camera. A newer focus, trail change,
workspace/view/comparison navigation, evidence selection, or clear invalidates it.
The camera consumer lives in `integrations/etymology/WordTrailLayer.tsx`.

## URL contract

Canonical example:

```text
#workspace=etymology&word=69562&view=family&concept=1001&collection=1
```

The encoded fields are `workspace`, optional decimal word ID, `view` (`history`
or `family`), optional concept ID, and optional collection ID. Geography URLs
explicitly say `workspace=geography`, even when lexical navigation fields are
retained. Legacy `#word=...&view=...` links open etymology. Concept-only comparison
links are also supported. Unset comparison IDs use deterministic defaults from
the focused word and chosen collection after data is ready.

Depth, display flags, expansions, selected evidence, search text/language scope,
family/include-missing filters, overlay visibility, and camera requests stay in
memory. They survive workspace switches but are not restored by a shared link or
reload. Back/Forward restores encoded navigation; it does not reconstruct past
unencoded detail for a different root. Graph camera state may remain component-local.

`parseExplorerRoute` and `serializeExplorerRoute` are pure. Parsing reports malformed
encoding, duplicate known parameters, invalid identifiers, and unknown enum values.
Well-formed unknown IDs survive until data-layer resolution can report them.
Unknown parameters are ignored and removed during canonicalization.

`connectExplorerNavigation(store, window)` reads initial location, subscribes to
store changes, and listens for both `popstate` and `hashchange`. It returns a
cleanup function. Mount one connection above both workspaces. It preserves the
pathname, query string (including diagnostics), and host history state. Navigation
that changes encoded fields pushes history; canonicalization replaces the current
entry. Unencoded edits do not write history. Duplicate browser events are deduplicated
and applying a browser route does not push a new entry.

## Review and tests

From `app/`:

```sh
node --test --test-isolation=none tests/explorer-session.test.ts tests/explorer-navigation.test.ts
npm run test:explorer-navigation-browser
```

Both use synthetic data, without atlas or lexical downloads. The Firefox command
reuses the existing Vite/WebDriver lifecycle and writes an ignored report and
screenshots to `test-results/explorer-navigation/` by default.

For manual review, run `npm run dev` and open
`/tests/browser/explorer-navigation.html` on Vite's displayed origin. The test-only
page has Wine/Water and workspace buttons plus a session readout. Edit fragments,
use Back/Forward, and refresh Geography. A link with `concept=1001&collection=1`
must retain that comparison rather than defaulting to the focused wine concept.
This fixture is not part of the production app. ETY-03 now connects the same
adapter once in `App.tsx`, before mounting either workspace. The lexical loader
validates the compiled browser contract, caches successful/in-flight requests,
and publishes only ready data. Unmounted consumers ignore completion; remounts
reuse the request. It never writes session defaults from asynchronous callbacks.
Geography remains mounted after its first visit and is resized on return. Data
failures retry independently; a rejected atlas request is evicted and its async
atom can refresh without resetting the exploration store.

## Feature integration boundary

`integrations/GeographyExplorations.tsx` composes the generic
`GeographyWorkspace` using its optional `mapLayers` and `sidebarHeader` slots.
`WorldMap` renders injected children within the map context. Neither geography
component imports the lexical or WALS feature. The neutral owner also composes
WALS points and its summary independently of the lexical overlay. The integration
lazily loads the trail layer and summary only when the session enables the overlay, so ordinary geography
loads no lexical traversal or resolution code. Geography stays mounted while the
optional overlay is added or removed.

The integration directory owns the trail layer, summary, area
planning/pinning, and catalog matching. Both overlays use the neutral
`integrations/map/overlayCamera.ts` controller, which checks current request
identity after style/frame waits. Lexical hide/show state lives in
`integrations/etymology/visibility.ts`; hiding cancels only owned focus and retains
the trail. A new show/focus sequence makes the trail visible again. The combined
summary container scrolls within 45% of the sidebar, preserving finder access.
`languageMatching.ts` bridges atlas and lexical identities; the core lexical domain has no atlas dependency. Language
profiles can still dispatch the shared `language-words` navigation action without
loading the lexical implementation. Language locations and data releases retain
their current contracts.

For real-data UI acceptance use `npm run test:etymology-browser`; map integration
uses `npm run test:word-trail-browser`. ETY-04 derives map points/links directly
from `atlasWordTrailAtom`; the graph
and map never keep separate trail snapshots. Marker/panel inspection changes
selected evidence while preserving the trail root/options and comparison filters.
The panel's ordinary return action preserves the current view. Showing/focusing a
trail creates an explicit request; clearing, newer navigation, and workspace changes
invalidate it.

`mapCameraIntentAtom` holds the identity of the latest explicit atlas/trail camera
request. Both camera consumers check ownership after asynchronous readiness/bounds
work; user-originated map movement invalidates pending navigation. Finished focus
cleanup does not stop later user motion. Style replacement does not replay a fit.

`addTrailAreasAtom` in `integrations/etymology/state.ts` reads the complete catalogs
before availability, awaits atlas readiness, checks that the captured session/trail
is still current, then reads the
latest source/period/override/mode state and calls `showLanguagesAtom`. Actual entry
count differences determine additions; existing representation keys determine
already-present counts. Stale results are hidden after trail or geography-setting
changes. There is no polygon state write when showing, inspecting, focusing, or
clearing the lexical overlay.

Language profiles/popups dispatch `language-words` with the represented catalog
name/classification immediately. Lexical loading resolves that request against the
latest session, including ambiguous/no-match fallbacks.
See [frontend review instructions](../../README.md#word-histories-port-preview).

WALS-02 adds a separate source-variety session in `features/wals/`, with ready-data
navigation and catalog association owned by `integrations/wals/`. It adds no URL
fields or shared lexical session fields. Explicit WALS show/focus actions use the
same `mapCameraIntentAtom`; inspection/variety navigation cancels pending intent
without moving the camera. WALS visibility/clear only cancels a request it still
owns. Data completion and workspace return never issue WALS focus. No WALS UI or
map consumer is mounted yet. See [WALS contracts](../features/wals/README.md).
