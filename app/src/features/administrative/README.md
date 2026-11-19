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

`AdministrativePanel.tsx` is loaded only when Regions mode is first opened.
It then stays mounted across map mode switches, preserving search,
selection, and scroll state. Its search covers source territory codes and
browser-localized region names, source language names/codes, and Glottolog family
names/IDs. Details use ranked per-row estimates rather than exclusive shares;
the UI explains overlap and source lineage. The CLDR source is pinned to release 49.
The panel has a local data failure and retry state. The map and language catalog
have independent error boundaries so their failures do not hide this panel.

Language details use the same panel in either map mode. Its Regions section loads
CLDR observations when opened, and exact Glottocodes connect reviewed CLDR
language codes to atlas records. Script variants remain separate. CLDR records
without a reviewed Glottocode retain their source identity and cannot show atlas
features or word histories.

The header switches between Languages and Etymologies. The map's Languages / Regions
control switches both the sidebar and map picker, and the URL records the selected
map mode. The map stays mounted across modes. The language sidebar is hidden,
not unmounted, while the administrative panel is visible.

`boundaryRepository.ts` loads the reviewed crosswalk, label positions, representative points, and
main-polygon focus bounds (so overseas islands do not pull a mainland focus away)
from the separate ADM-02 package when Regions mode is first selected.
It fetches and validates the pinned GeoJSON when borders are visible or Regions mode is
enabled. The boundary package never alters CLDR observations. `BoundaryLayer.tsx`
renders zoom-dependent region names, hover outlines, borders and eligible metric fills.
The map information control always carries boundary source credits and
interpretation notes, including when the optional boundary sources are hidden.
Loading and retry messages appear only while needed. Selection-specific viewpoint
notes appear in the detail panel. Every full
border uses the same paint, regardless of whether its association is
viewpoint-sensitive or has no matched CLDR region.
Every Natural Earth source shape is inspectable in Regions mode. Shapes without a
reviewed CLDR match open a source-shape sidebar with a no-data message and can
still be focused. Unmatched CLDR regions remain searchable without a shape. Fetch failures
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
picker at a time. Regions mode shows borders, uses a transparent polygon hit layer,
and outlines the region under the pointer. Hover previews the region; click opens
its dedicated sidebar without moving the map. Double-click zooms to its supplied
administrative boundary, following the same interaction pattern
as Languages mode (which uses language polygons instead).
Languages mode inspects language polygons;
its border button optionally shows the administrative boundary network. The border
button stays selected and disabled in Regions mode. The
Languages / Regions control sits beside map settings, with Languages selected by
default. Switching modes preserves the camera, searches, and selections.

## Selection and isolation

`navigation.ts` owns explicit sidebar navigation. Choosing a region opens its details without moving the camera.
Double-clicking zooms to its reviewed administrative boundary. Choosing a language follows the validated CLDR
Glottocode link, switches to Languages, opens language details without moving the camera or changing
the displayed language colours. An unlinked CLDR record stays in its source
sidebar; it is never turned into a guessed atlas language or country fill.

`mapInteraction.ts` stores temporary language/region isolation separately from
pinned map groups. The map's colour picker edits only the isolated fill; Show all
again or Escape restores the previous fills. Existing WALS and word-trail overlays
are hidden during isolation and restored afterwards. Geography source and period
filters still apply. No extra geography build or replacement boundary is used.

Regions uses a light casing with a dark border and an orange selection outline.
These styles do not change the optional administrative lines in Languages mode,
nor the atlas language outlines. Language details has no Map controls section;
map settings, selection controls and isolation controls remain on the map/browser.

## Country clipping and progressive detail

Country isolation retains the original language-colour layer and masks its exterior
with the exact supplied administrative boundary. The mask is computed in a small
worker using the existing GEOS dependency. Islands, enclaves and date-line cuts
remain intact; language polygons are neither guessed nor rebuilt. A new mask must
finish loading before language colours are restored, preventing outside-colour flashes.
Hovering within the selected country uses the same language tooltip as Languages.
Overlapping languages are listed; the most specific first hover entry is the
consistent direct click/double-click target in Languages mode.

At closer zooms, the existing OpenFreeMap/OpenMapTiles source adds state/province
lines and names, then cities, towns and district detail. Country geometry continues
to come from the reviewed Natural Earth package. These extra layers are Regions-only.

A persistent Clear colours / Show all button lives beside the Languages/Regions
control. The active mode uses a dark treatment and the alternative is muted grey.
Search checkboxes prepare a set; Show selected on map displays and frames that set
instead of invisibly adding duplicate entries to the already-full initial map. The
advanced Add options disclosure has been removed. Data Sources is below Search.

## Selected-country gesture routing

The initial Regions click selects a country. Once selected, hits on language areas
inside that country use the same language click and double-click path as Languages:
single-click opens language details and double-click zooms into that language.
Country and language identities use the same gestures. Isolation is an explicit
language-details action, separate from all pointer zoom gestures. Family isolation uses the mapped descendants rather than requiring an unavailable
family polygon. Normal language-colour
layers are unmounted during language isolation, rather than only faded.

Region checkboxes persist across searches; Show selected on map masks the exterior
of their combined original country shapes. Speaker bars use the recorded population
percentage directly (41 means 41% of the track), independent of the largest row.
The primary sidebar contains facts and language rows, with sources in a disclosure.


### Current pointer interactions

Hover shows the floating summary. Single click opens details without moving the
camera. Double click zooms into the clicked language or country without isolating
or changing map colours. The language details panel has an explicit **Isolate
language** action and **Show all languages** to restore colours. Focus on map is
removed. Selecting a CLDR language opens the language details without automatically
isolating or zooming. World-scale labels show the catalog's existing family names without a subtitle. Zooming past 2.6 switches to individual language names.
Labels use recorded member-language coordinates and adapt to available screen space;
no family boundary, homeland or administrative affiliation is inferred. All original
language polygons stay visible and interactive.
