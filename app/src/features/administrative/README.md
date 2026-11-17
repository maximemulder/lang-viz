# Administrative feature (ADM-03 through ADM-05)

The observation repository reads `administrative/observations.json` only when
its loader is called. It has no import from the atlas repository or boundary
package. A missing or invalid supplement affects only its own load state; the
atlas can load normally.

`repository.ts` validates the schema version 4 release, provenance fields,
coverage counts, all foreign keys, and unique source territory/language pairs before indexing.
Concurrent loads share one request and failures may be retried. The supplement
contains 258 territories, 798 source language codes, 57 named families and
1,630 observations from pinned CLDR 49. `model.ts` retains source IDs and
numeric strings. 37 language codes lack a reviewed Glottolog association;
their CLDR observations remain available without a fabricated family.
Family names come from the pinned Glottolog catalog, not the atlas catalog.

`selectors.ts` exposes pure search, detail, and metric functions. Reported
speaker counts are estimates. Family totals are sums of reported estimates,
and script variants can overlap. A territory's language percentages can exceed
100%; the selector exposes that condition for the panel to disclose. No selector
maps a territory to a polygon or a language to an atlas geometry.

`state.ts` stores repository load state separately from a small session of query,
selection IDs, and metric choice. A selection or load completion never changes
the map camera. An explicit territory focus creates a request in the shared
`mapCameraIntentAtom`; `BoundaryLayer` fits precomputed geometry bounds for
that request. Map mode changes keep the current map camera
position.

`AdministrativePanel.tsx` is loaded only when Areas mode is first opened.
It then stays mounted across map mode switches, preserving search,
selection, and scroll state. Its search covers source territory codes and
browser-localized area names, source language names/codes, and Glottolog family
names/IDs. Details use ranked per-row estimates rather than exclusive shares;
the UI explains overlap and source lineage. The CLDR source is pinned to release 49.
The panel has a local data failure and retry state. The map and language catalog
have independent error boundaries so their failures do not hide this panel.

Language details use the same panel in either map mode. Its Areas section loads
CLDR observations when opened, and exact Glottocodes connect reviewed CLDR
language codes to atlas records. Script variants remain separate. CLDR records
without a reviewed Glottocode retain their source identity and cannot show atlas
features or word histories.

The header switches between Languages and Etymologies. The map's Languages / Areas
control switches both the sidebar and map picker, and the URL records the selected
map mode. The map stays mounted across modes. The language sidebar is hidden,
not unmounted, while the administrative panel is visible.

`boundaryRepository.ts` loads the reviewed crosswalk, label positions, representative points, and
main-polygon focus bounds (so overseas islands do not pull a mainland focus away)
from the separate ADM-02 package when Areas mode is first selected.
It fetches and validates the pinned GeoJSON when borders are visible or Areas mode is
enabled. The boundary package never alters CLDR observations. `BoundaryLayer.tsx`
renders zoom-dependent area names, hover outlines, borders and eligible metric fills.
The map information control always carries boundary source credits and
interpretation notes, including when the optional boundary sources are hidden.
Loading and retry messages appear only while needed. Selection-specific viewpoint
notes appear in the detail panel. Every full
border uses the same paint, regardless of whether its association is
viewpoint-sensitive or has no matched CLDR area.
Every Natural Earth source shape is inspectable in Area mode. Shapes without a
reviewed CLDR match open a source-shape sidebar with a no-data message and can
still be focused. Unmatched CLDR areas remain searchable without a shape. Fetch failures
stay within this optional layer and can be retried.

The current boundary package contains only one Natural Earth view. The static
GitHub Pages deployment has no client-country signal, so it always renders that
view. A future location-aware choice requires separately reviewed alternative
geometry and crosswalk packages plus a country signal supplied to the app by
its host. The app must not request browser geolocation or treat browser language
as a reliable country location. A missing or unsupported signal uses the
documented source view; it must never silently reassign CLDR observations.

`GeographyExplorations` owns the optional layer and supplies a small generic
interaction adapter to `WorldMap`. The map host chooses exactly one pointer
picker at a time. Areas mode shows borders, uses a transparent polygon hit layer,
and outlines the area under the pointer. Click opens sidebar details and double-click
also fits the shape on the map, following the same rule as Languages mode.
Languages mode inspects language polygons;
its border button optionally shows the administrative boundary network. The border
button stays selected and disabled in Areas mode. The
Languages / Areas control sits beside map settings, with Languages selected by
default. Switching modes preserves the camera, searches, and selections.
