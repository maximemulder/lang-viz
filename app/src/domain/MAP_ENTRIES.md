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

`mapEntryGeometryKey` compares languoid, mode, and the sorted set of variant IDs.
Explicit groups also include their group ID in `mapEntryKey`. Legacy ungrouped APIs
retain their original deduplication behavior. Adding
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

## Working selection and groups

Explore checkboxes use `searchSelectionAtom`, independently of map entries. The
`searchCoverageAtom` and `searchColoringAtom` configure the next Add to map.
`addSearchSelectionToMapAtom` builds groups from all checked identities, skips and
reports unavailable coverage, and leaves the working selection intact.

`mapGroups.ts` builds pinned entries with a shared `MapGroup` descriptor: stable ID,
selected root, coverage (`branch` or `own`), coloring (`hierarchy` or `uniform`), and
optional base color. A branch includes all own polygons across the complete subtree,
including ancestors, with overlapping requested roots normalized to the topmost root.
Own coverage only pins each requested entry's own variant.

`addMapGroupEntries` preserves all independent groups. Repeating a group with the
same root, coverage, and geometry preserves identity, provenance, styles, and entry
overrides. A partially removed group can be restored with the same styling. Changed
source variants create independent comparison groups. Native variant IDs are retained
when unique, preserving prepared-tile eligibility. A polygon already in another group
gets an aliased entry ID for independent colors, inspection, and refinement.
`mapEntryGeometryKey` identifies the underlying representation; `mapEntryKey` also
includes explicit group identity. Legacy ungrouped APIs retain their original keys.

## State API

`state/atlasState.ts` exposes the canonical `mapEntriesAtom`, derived `mapGroupsAtom`,
and resolved `selectedMapAreasAtom`. `removeMapEntryAtom` removes a constituent area;
`removeMapGroupAtom` removes a complete group, including members hidden by a query.
`clearMapSelectionAtom` clears the map independently of the working selection.
`setMapGroupStyleAtom` changes coloring/base color; `setMapEntryColorAtom` overrides
one area, with `null` restoring its group color. Custom hierarchy base colors create
local semantic palettes without recoloring other source/period groups. Individual
entry overrides take precedence. The ordinary palette is shared across automatic
groups rather than copied per group.

The existing `showLanguagesAtom`, `toggleVisibleLanguageAtom`, `hideLanguagesAtom`,
`showBranchAtom`, and `selectedDraftLanguageIdsAtom` remain compatibility APIs for
fixtures and offline preparation. Their own/descendant aggregate modes are still
supported by the rendering model; Explore's primary UI uses groups instead.

## Rendering

`resolveMapEntries` resolves ancestor relationships within each intentional group,
pinned context, and actual temporal view. Other groups remain comparisons. The
worker subtracts descendant footprints from ancestors while preserving the complete
union, holes, outlying descendants, and sibling overlaps. Removing a child restores
ancestor fill. Fully covered ancestors remain pinned and inspectable.

Memberships and refinement enter geometry cache identity; colors never do. Aliased
own-area comparisons also request composition, even for a single source polygon.
Source/fallback hit targets expand to group memberships before refinement, while
computed coverage retains its exact surviving owners. Map popups and details therefore
inspect the precise group entry rather than accidentally restoring hidden ancestors
from another group.

Full source/period branch views with native entry IDs remain eligible for prepared
branch tiles. Independent groups sharing a polygon can use prepared coverage parts
or the existing bounded live engine. Existing geometry budgets, publication deadlines,
and fallback behavior remain unchanged. Group/entry state currently lasts until reload;
persistence and import/export are not implemented.
