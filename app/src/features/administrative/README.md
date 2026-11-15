# Administrative feature (ADM-03 through ADM-05)

The observation repository reads `administrative/observations.json` only when
its loader is called. It has no import from the atlas repository or boundary
package. A missing or invalid supplement affects only its own load state; the
atlas can load normally.

`repository.ts` validates schema version 2, provenance fields, coverage counts,
all foreign keys, and unique source territory/language pairs before indexing.
Concurrent loads share one request and failures may be retried. The supplement
contains 251 territories, 761 source language codes, 57 named families and
1,488 observations in the pinned snapshot. `model.ts` retains source IDs and
numeric strings. Family names come from the same pinned Glottolog catalog as
the language associations; they are not atlas family names.

`selectors.ts` exposes pure search, detail, and metric functions. Reported
speaker counts are estimates. Family totals are sums of reported estimates,
and script variants can overlap. A territory's language percentages can exceed
100%; the selector exposes that condition for the panel to disclose. No selector
maps a territory to a polygon or a language to an atlas geometry.

`state.ts` stores repository load state separately from a small session of query,
selection IDs, and metric choice. A selection or load completion never changes
the map camera. An explicit territory focus creates a request in the shared
`mapCameraIntentAtom`; `BoundaryLayer` resolves a reviewed representative
point for that request. Header view changes keep the current map camera
position.

`AdministrativePanel.tsx` is loaded only when the Administrative header view is
first opened. It then stays mounted across header switches, preserving search,
selection, and scroll state. Its search covers source territory codes and
browser-localized area names, source language names/codes, and Glottolog family
names/IDs. Details use ranked per-row estimates rather than exclusive shares;
the UI explains overlap, source lineage, and the unknown CLDR release. The
panel never calls atlas language-detail actions. It has a local data failure
and retry state. The map and language catalog have independent error boundaries
so their failures do not hide this panel.

The app header and URL route own Geography / Administrative / Word histories.
The map workspace stays mounted between Geography and Administrative. The
existing language sidebar is hidden, not unmounted, while the administrative
panel is visible.

`boundaryRepository.ts` loads the reviewed crosswalk and representative points
from the separate ADM-02 package on first Administrative view or area hover.
It fetches and decodes the pinned TopoJSON only when Borders is enabled. The
boundary package never alters CLDR observations. `BoundaryLayer.tsx` renders
markers, opt-in outlines and eligible metric fills, plus source and viewpoint
notes. Every outline uses the same paint, regardless of whether its association
is viewpoint-sensitive or has no matched CLDR area. Geometry selection and a
focus request require an explicit matched crosswalk entry; ambiguous or
unmatched CLDR areas remain searchable without a shape. Fetch failures stay
within this optional layer and can be retried.

The current boundary package contains only one Natural Earth view. The static
GitHub Pages deployment has no client-country signal, so it always renders that
view. A future location-aware choice requires separately reviewed alternative
geometry and crosswalk packages plus a country signal supplied to the app by
its host. The app must not request browser geolocation or treat browser language
as a reliable country location. A missing or unsupported signal uses the
documented source view; it must never silently reassign CLDR observations.

`GeographyExplorations` owns the optional layer and supplies a small generic
interaction adapter to `WorldMap`. The map host chooses exactly one pointer
picker at a time. Borders off removes the polygon source and its hit layer;
area mode can then pick only visible markers. The border icon and Language / Area
segmented button sit beside map settings, with borders off and Language selected
by default. The two top-left controls do not
modify atlas language selections, filters, CLDR values, or the camera.
