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
No geography atom is imported or written by these modules.

The lexical data loader publishes ready data to `etymologyRepositoryAtom` in a
separate module. Repository caching/loading/retry remains data-layer work; session
actions and URL parsing do not wait for it. `resolvedExplorerAtom` resolves the
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
The real camera consumer remains ETY-04 work.

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
This fixture is not part of the production app. Full UI, loading/error boundaries,
and real-data graph/map browser acceptance remain ETY-03/ETY-04 work.
