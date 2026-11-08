# Pinned map entries

A languoid is a catalog/classification identity. A `MapEntry` in `mapEntries.ts`
is an independently selected representation of that languoid. Several entries
can share a languoid while using different geometry variants or representation
modes. Geometry variants already identify their source and temporal coverage;
no catalog or archive rebuild is required.

## Pinning and identity

`pinMapEntry` captures the exact variant IDs chosen by geography availability,
the representation mode, uncovered descendant branches, and the source/period
filter context used to add it. Later changes to filters, draft source overrides,
or draft representation modes do not modify this snapshot. Own representations
use their variant ID as the entry ID. Aggregate entries receive independent IDs
which stay stable while selected and identify grouped overlap memberships.

`mapEntryKey` compares languoid, mode, and the sorted set of variant IDs. Adding
identical geometry deduplicates even if reached through different filter contexts
or contributor order. It preserves the existing entry ID, color, and original
context. Own and descendant representations stay distinct even if they happen
to cover the same polygon. Re-adding a removed aggregate creates a new identity.

`resolveMapEntries` looks up pinned variants without consulting current filters.
If any pinned variant is missing from the loaded catalog, the entire entry is
unavailable; partial aggregates are never silently substituted. On map retains
such entries for inspection/removal. Contexts are source/period categories, not
arbitrary historical instants; source period labels and proxy/mixed-period
qualifications remain visible in Details and map popups.

## State API

The Jotai atoms in `state/atlasState.ts` expose:

- `mapEntriesAtom`: canonical, serializable in-memory entries.
- `selectedMapAreasAtom`: pinned geometry and resolved per-entry colors used by
  rendering, overlap membership, and inspection.
- `showLanguagesAtom` / `toggleVisibleLanguageAtom`: add or toggle the current
  draft representations. `hideLanguagesAtom` removes only those representations.
- `removeMapEntryAtom`: remove one entry by ID; `clearMapSelectionAtom`: clear all.
- `setMapEntryColorAtom`: `{entryId, color}`; an opaque CSS color is normalized
  before writing. `null` restores the languoid's color. Entry overrides take
  precedence over the semantic/categorical palette and languoid overrides.
- `visibleLanguageIdsAtom`: read-only unique languoid IDs for genealogy/palettes.
- `selectedDraftLanguageIdsAtom`: languoids whose current draft matches an entry;
  drives Explore checkboxes rather than collapsing all comparison entries.

The existing `areaModesAtom`, `geometryOverridesAtom`, `temporalViewAtom`, and
`geographyDatasetFilterAtom` now configure what to browse and add next. They are
not settings on existing map entries. To change an entry's geometry, prepare
and add the replacement, then remove the original.

`showBranchAtom` captures every mapped entry's own geometry, color root, and
`branchRootId`. This includes mapped ancestors. A branch root plus its pinned
geography context identifies an intentional composition group. Descendants refine
only ancestors in that group and temporal view; other entries remain comparisons.
`replaceSubtreeMapEntries` replaces entries in the visited subtree only when
their source/period filter context equals the current context. Source order and
duplicates are ignored in this comparison. An `all` context remains distinct
from a specific source/period context; broad browsing must not erase narrower
comparisons. Exact replacements retain their IDs/colors and acquire the new branch
and color root only within the replaced context. Other comparison contexts remain selected.

`branchColorRootsAtom` derives roots from surviving entries, so removing the
last entry from a group also releases that inferred root. Explicit palette
configuration remains independent. Entries and color configuration currently
live until reload; persistence/import/export are not implemented.

## Rendering

`resolveMapEntries` resolves selected ancestor relationships through a per-group
classification index. These relationships are part of coverage cache identity,
independent of colors. The worker processes descendants first and subtracts their
combined footprint from ancestors. It preserves the union of available coverage,
including descendants outside ancestor polygons. Siblings and other groups retain
their overlap. Removing a descendant restores its ancestor automatically.
Fully covered ancestors remain pinned and inspectable in Details/On map.

Original and clipped fallback fills sort ancestors before descendants. Fallback
inspection applies the same refinement rule, while stripe/blend coverage already
contains resolved contributors. Both modes therefore use the same branch policy.

Own source polygons and aggregate contributor groups feed the existing overlap
pipeline. Aggregate IDs distinguish snapshots of the same family, including
when one source polygon belongs to several aggregates or a selected child.
Inspection resolves these entry memberships and opens the corresponding pinned
card in Details. Search/viewport hit targets still use browsing geography.

Colors never enter geometry selection keys. Per-entry recoloring updates solid
fills and stripe textures without recomputing coverage, just like languoid
palette edits. Separate entries inherit the same languoid color initially;
the entry color controls let the user distinguish sources/periods explicitly.

## Costs and current limits

Entries store variant IDs and provenance rather than copies of polygon coordinates.
Resolving them costs O(total pinned variant references) when entries or colors
change. Browsing filters do not invalidate selected geometry or coverage caches;
ordinary search/availability preparation remains separate.

Aggregate comparisons still use the renderer's existing geometry budgets and
publication deadline. Broad views of large families can reach these limits (for
example, a Sino-Tibetan source comparison with over 200 contributing variants).
The renderer reports its normal coverage error and preserves available fills.
This selection refactor does not increase those budgets or replace the geometry
engine. Zoomed regional comparisons and individual source variants have dedicated
browser coverage.
