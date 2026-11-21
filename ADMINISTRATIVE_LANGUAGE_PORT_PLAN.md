# Administrative language visualization port plan

Last updated: 2026-11-15. ADM-00 through ADM-06 implementation recorded below.

This is a historical port record. The current implementation uses CLDR 49
observations and Natural Earth Admin-0 countries 5.1.1; see
[administrative data](pipeline/administrative/README.md) and
[boundary view](pipeline/administrative/boundaries/README.md) for current pins
and coverage.

Integrate the useful CLDR language and territory statistics from
`origin/aastha/speaker-stats` into the current geography workspace. Keep the
administrative exploration independent of the main language map: CLDR territory
codes identify statistical records, while a separately versioned boundary source
determines how, or whether, those records appear as geographic areas. Borders are
off by default. The existing language visualization remains the default view.

This plan also records the completed integration and its validation results.

## Baseline and scope

Reviewed local revisions:

- Current checkout at ADM-00 audit: `345fb82f69dc2ff75910f1d7910e39f2f2ac93d5`.
- Source branch: `origin/aastha/speaker-stats`,
  `4cb95badf12d64d9a0ff7be5535c43fbaebb1aa9`.
- Common ancestor: `f043e87d5a3e1a5c887ca3139e7683533f2fe0d4`.

These are local references; refresh them before later stages if either branch
has advanced. Port selected data and behavior onto current main rather than
merging the branch's separate map and app shell. The current app has a persistent
`WorldMap`, optional layers composed by `GeographyExplorations`, a top-level
workspace header, and Explore / On map tabs within the language sidebar. The
branch instead builds a separate CLDR map using CARTO Voyager,
`world-atlas/countries-50m`, and a direct polygon-to-CLDR join.

Retain the CLDR observation export, Glottolog identifiers, territory and language
search, reported estimates and official status, and useful detail views. Rework
the political geography, statistical graphics, interaction ownership, data
delivery, and large `CldrMapView` component before integrating them.

## Architecture and behavior contracts

1. **Administrative data has its own owner.** Keep the CLDR repository, domain
   calculations, sidebar content, state, and map layers under an administrative
   feature/integration directory. The main atlas repository and language controls
   do not import CLDR records. The map host accepts an optional layer and a small
   interaction adapter; it does not contain CLDR-specific calculations.
2. **A territory code is not a polygon.** Store observations by CLDR territory
   code and source language identifier. Keep language-to-atlas associations and
   territory-to-boundary associations in separate, reviewable crosswalks. An
   unmatched or ambiguous territory stays searchable in the administrative
   view's sidebar even if it cannot be drawn. Do not infer that a language's
   atlas polygon is the area where its reported speakers live.
3. **Geometry is a presentation choice.** Package the boundary source, version,
   license, territory IDs, disputed-area treatment, and optional viewpoint ID
   separately from CLDR. The presentation layer resolves a territory code to a
   geometry under an explicit boundary view. Changing that view must leave CLDR
   values unchanged. Do not silently assign disputed or unmatched shapes to a
   statistical record. Show the source and viewpoint in the map legend/details.
4. **Borders are opt-in.** Put a visible Show borders icon button beside map
   settings at the top left of the map, initially off. Off means no administrative
   outlines, fills, labels, or invisible polygon hit targets from this feature.
   Administrative statistics remain available in the administrative view and,
   where a defensible representative point is available, through clearly labeled territory
   markers. On enables the selected boundary layer and optional metric shading.
   Avoid a political basemap style that can show different borders or labels
   beneath this layer.
5. **Hover has one owner at a time.** Put a segmented Language / Area button
   beside the border button, initially Language. Language mode uses the existing
   language picker and inspector. Administrative area mode inspects territory
   markers with borders off and visible territory polygons with borders on. The
   same mode determines click precedence and cursor/tooltip behavior. Switching
   modes clears stale hover, but not pinned selections. This plan interprets
   "area" as an administrative territory.
6. **Administrative is a header view.** Add Administrative to the app header's
   keyboard-accessible workspace navigation, alongside Geography and Word
   histories. Geography stays the default. Selecting Administrative reuses the
   mounted geography map but shows the administrative sidebar content instead
   of the language sidebar; Explore and On map remain internal to Geography.
   Its lazy-loaded panel owns its query, selected territory/language/family,
   metric, and errors. The app shell owns the active header view, while
   `GeographyExplorations` supplies the optional panel and map layer. Switching
   header views preserves pinned language areas, atlas filters, camera, and
   administrative selections.
7. **Statistical labels match the source.** Show speaker counts as estimates
   derived from CLDR population and percentages where applicable. The branch's
   percentages may overlap across languages and exceed 100% in a territory, so
   replace population-share pies with ranked estimates or bars that do not imply
   exclusive groups. Do not expose the branch's normalized diversity score until
   its meaning and suitability for overlapping language shares are reviewed.
   Family totals must be labeled as sums of reported estimates, not unique people.
8. **Failure and delivery stay local.** Publish the CLDR browser asset through
   an explicit, reproducible build or separately pinned release restored during
   deployment. The source branch's generated JSON is ignored and is not restored
   by the current deployment workflow. Missing CLDR or boundary data produces a
   local administrative error and leaves the main language map usable.

## Proposed work sequence

| Item | Deliverable | Depends on | Status |
| --- | --- | --- | --- |
| ADM-00 | Refresh baseline and audit the branch data | — | Audited; lineage and geometry gaps documented |
| ADM-01 | Reproducible CLDR supplement and provenance | ADM-00 | Implemented; source release remains unknown |
| ADM-02 | Boundary package and explicit territory crosswalk | ADM-00 | Implemented |
| ADM-03 | Independent repository, domain model, and state | ADM-01 | Implemented |
| ADM-04 | Administrative header view and sidebar details | ADM-03 | Implemented |
| ADM-05 | Optional map layers and top-left controls | ADM-02, ADM-03, ADM-04 | Implemented |
| ADM-06 | Delivery, regression, and documentation | ADM-01–ADM-05 | Implemented |

Each item is independently reviewable and leaves main buildable. Administrative
data errors stay local to the panel or boundary layer.

### ADM-00 — Refresh the baseline and audit data

- Confirm current branch heads, clean working tree, installed data pins, and
  existing map/sidebar behavior.
- Trace how `cldr_glottolog_joined.csv` was produced. Record the CLDR release,
  source file, preprocessing steps, license/attribution, and any manual mapping.
- Audit the language crosswalk, duplicate script rows, nulls, CLDR territory
  codes without geometry, geometry IDs without CLDR observations, and disputed
  territory cases. Record representative examples for regression checks.
- Decide the first supported boundary source and treatment of disputed areas.
  `world-atlas` can be an initial candidate, but its embedded Natural Earth
  choices are not a neutral definition of CLDR territory codes.

Acceptance: the source and join are reproducible or their gaps are documented;
the first boundary view and its limitations have an explicit policy.

### ADM-01 — Build an independent CLDR supplement

- Port and tighten `pipeline/atlas/build_cldr.py`; keep the browser output
  separate from the atlas geometry release. Validate ranges, codes, identifier
  joins, and duplicates before export.
- Preserve raw CLDR language/territory codes and source values. Store Glottolog
  and atlas associations separately, with match method and unresolved status.
- Include a manifest with schema, CLDR and Glottolog releases, source hashes,
  producer revision, coverage, and attribution. Restore or build this asset in
  CI/deployment and check it before the app build.

Acceptance: a clean checkout can obtain the same validated browser asset; a
missing or stale supplement fails its own gate rather than disabling Geography.

ADM-00/01 result: [the administrative data audit and build guide](pipeline/administrative/README.md)
records snapshot counts, problematic joins, source-lineage gaps, the provisional
boundary-view policy, and reproduction commands. The joined CSV is restored to
ignored local data from the pinned source branch commit and hash; it is not added
to main's Git tree. Its original CLDR release and preprocessing recipe are
unknown and are represented as `null` in the manifest. The build verifies
every supplied Glottocode against the pinned Glottolog catalog, keeps original
CLDR code/script rows, and exports associations separately. Deployment restores
both sources, builds the supplement, and verifies the ignored browser asset before
building the app. ADM-02 still owns the complete boundary crosswalk audit.

### ADM-02 — Package boundary geometry independently

- Pin a boundary dataset and resolution appropriate to the map; document its
  worldview and disputed-feature policy. Package it as its own browser asset,
  with feature IDs and representative points. Use vector tiles if the GeoJSON
  payload or client conversion is too large.
- Maintain a versioned CLDR-code-to-boundary-feature crosswalk with explicit
  match, ambiguous, and unmatched outcomes. Keep crosswalk decisions separate
  from statistics and geometry files.
- Use one visual style for all boundary outlines. Credit the boundary source
  and include the political disclaimer in the map information control. Only
  reviewed matches receive a statistical fill.
- Verify the current plain, biomes, terrain, and satellite backgrounds do not
  inject political lines or labels while borders are off. Replace or constrain
  a background if that guarantee does not hold.

Acceptance: swapping the boundary asset or view changes geometry and map
attribution, not CLDR observation values or IDs.

ADM-02 result: [the boundary-view audit and build guide](pipeline/administrative/boundaries/README.md)
records the pinned `world-atlas` 2.0.2 / Natural Earth 4.1.0 topology,
the independent 251-territory crosswalk, 241 geometry features and their
representative points, explicit unmatched/ambiguous cases, and basemap audit.
The geometry, crosswalk, and index are separate ignored browser assets restored
in deployment. No CLDR values or IDs change when the boundary view is built.
The source does not include disputed-segment metadata; ADM-05 can flag
viewpoint-sensitive areas but cannot draw a distinct line for every dispute
from this package alone.

### ADM-03 — Add the administrative feature model

- Add a lazy repository that validates, indexes, and caches the CLDR supplement.
  Keep fetch/cache behavior out of React components.
- Add pure selectors for territory, language, family, and metric summaries.
  Do not duplicate the current atlas geometry selector inside the CLDR module.
- Store only IDs and display choices in administrative state. Route explicit
  navigation through the existing camera-intent system; loading or header view
  changes must not move the camera.

Acceptance: selectors work without a map, and the atlas can load and operate
without the administrative asset.

ADM-03 result: [the administrative browser model](app/src/features/administrative/README.md)
validates and indexes the supplement lazily, keeps queries, selection IDs and
metric choices in feature-local state, and exposes pure territory, language,
family and metric selectors. A failed fetch is retryable and remains local to
the administrative feature. The supplement now includes 57 family names from
the already pinned Glottolog catalog (schema version 2), so family search does
not depend on the atlas catalog. Loading and selection never request a camera
move; only an explicit focus action issues a shared camera intent. ADM-04/05
will connect the panel and its eventual camera consumer.

### ADM-04 — Add the administrative header view

- Extend the app header navigation to Geography / Administrative / Word
  histories, including keyboard and accessible active-view behavior. Keep
  Geography and Administrative inside one mounted map workspace so switching
  between them does not recreate the map or reset its camera.
- Show a lazy `AdministrativePanel` in the sidebar when Administrative is
  selected. Keep the existing Explore / On map language sidebar mounted and
  preserve its searches, selections, and scroll positions while it is hidden.
  Keep the administrative panel's state when another header view is selected.
- Offer territory, language, and family search and details. Distinguish a
  territory's CLDR observations from its optional displayed polygon.
- Use bars or a sortable list for overlapping language estimates; show source
  definitions, coverage, and estimate caveats beside the affected values.
- Keep administrative inspection from opening or replacing a normal atlas
  language detail unless the user explicitly follows a language link.

Acceptance: header navigation, search, selection, and detail flows are keyboard
usable and do not disturb existing language controls.

ADM-04 result: the header now routes Geography / Administrative / Word histories
through the existing URL session. Geography and Administrative reuse one mounted
`WorldMap`. The language sidebar remains mounted but hidden while a separately
lazy-loaded administrative panel shows territory, source-language, and Glottolog
family search and details. That panel requests only the observation supplement;
its load error and retry are local. The atlas map and language catalog have
their own error boundaries, so their data failures do not replace the
administrative panel. Source territory codes remain visible alongside
browser-localized area labels. Detail lists show ranked estimates and source
status, with explicit overlap, sum, coverage, and unknown-CLDR-release caveats.
No administrative selection opens an atlas language detail or requests a camera
move. The representative map layer, border switch, and hover ownership are
still ADM-05. Firefox checks covered search and keyboard selection, sidebar
state, URL switching, and persistence of the map canvas.

### ADM-05 — Integrate map layers and controls

- Compose an `AdministrativeLayer` into the persistent `WorldMap` through
  `GeographyExplorations`. Reuse the map camera, projection, and existing
  physical basemap. Do not port the branch's separate CARTO map or its
  zoom-dependent click rules unchanged.
- Add a top-left border icon button and Language / Area segmented button beside
  existing map settings. Defaults: borders off, hover Language. Keep them visible
  and understandable when the Geography header view is selected.
- Route pointer events through one active picker. With borders off, area mode
  targets visible markers only; with borders on, it may target visible polygons.
  Do not leave a transparent, politically meaningful hit layer active when
  borders are off.
- Draw boundary lines with one outline style and, only when a metric is selected,
  eligible fills from the chosen boundary package. Keep source viewpoint and
  no-data explanations visible. A territory selection may highlight its shape
  only while borders are on; otherwise identify it via its marker and
  administrative sidebar.
- Keep the main language overlays and their data state independent. If both
  visualizations are visible, use explicit layer order and opacity so neither
  appears to be the other's geographic evidence.

Acceptance: toggles change only presentation/interaction; neither modifies
CLDR values, pinned language entries, atlas filters, or camera state.

ADM-05 result: `GeographyExplorations` now composes a lazy boundary layer into
the persistent map. The top-left controls default to Borders off and Hover
Language. Administrative opens with representative markers from the separate
boundary index; Geography loads no boundary assets until the user enables
borders or area hover. The pinned Natural Earth 4.1.0 / world-atlas 2.0.2
topology is fetched only with Borders on. Matched polygons receive outlines,
selected territory highlights, and optional fills for reported population,
territory literacy, a selected language estimate, or a selected family estimate
sum. All source shapes have the same outline color and width; reviewed sensitive
matches retain source notes. Ambiguous/unmatched CLDR codes
stay available in the sidebar without a fill or marker. The legend and map
attribution name the boundary source and its viewpoint. Area hover/click uses
visible markers with borders off, and matched polygons with borders on; the
polygon hit layer unmounts when borders turn off. The language picker is
inactive in area mode, while atlas selections and the map camera remain
untouched by presentation changes. The explicit Focus mapped area button uses
a reviewed representative point and is disabled for unmatched codes.

The chosen first view and policy are the ADM-02 reviewed crosswalk. Markers
appear automatically in Administrative; no diversity formula or inferred
user-location viewpoint is included. The current static deployment has neither
alternative boundary packages nor a passive client-country signal, so it uses
the pinned source view for every client. A future host-supplied country code
could select a separately reviewed alternative view when both are available;
it must not trigger a geolocation prompt or use browser language as location.
Focused boundary decoding and crosswalk tests plus Firefox pointer checks cover
marker-only and polygon selection,
opt-in topology fetching, metric fill, and persistent controls. ADM-06 retains
the broader data/deployment and basemap/error/mobile verification work.

### ADM-06 — Verify and hand off

- Run data validation, focused selectors, frontend typecheck/lint/build, and
  representative browser checks for the new header view and controls.
- Check default border-off behavior on every basemap, hover/click exclusivity,
  missing boundary matches, disputed cases, mobile layout, keyboard controls,
  and a failed CLDR/boundary fetch.
- Check ordinary deployment restores the CLDR and boundary assets, including
  their manifests and attribution. Record the actual source versions, known
  coverage limits, and decisions in `DATASETS.md` and `ARCHITECTURE.md`.

Acceptance: the default map still renders and behaves as before; the
administrative header view remains useful with borders off; switching boundary
views does not change statistical values; deployment serves the same validated
assets used by the checks.

ADM-06 result (2026-11-15): the ordinary Pages workflow restores pinned input
snapshots, builds and verifies `observations.json`, then restores, builds and
verifies the three independent boundary assets before the frontend build. A
Pages-base production build contains the same four validated administrative
files; their bytes match the files in `app/public/administrative/`. Biome excludes
these generated JSON/TopoJSON files, as it already does other generated assets.
The 15 administrative pipeline tests and all 317 frontend unit tests pass;
frontend typecheck, Biome check, and Pages build pass. Firefox checks pass against
the built Pages app: initial borders off and language inspection, lazy geometry,
exclusive area picking, source-specific no-match behavior, CLDR and boundary
fetch failure/retry, metric fill, header persistence, both projections, keyboard
border control, narrow layout, and border-off behavior across all four physical
basemaps. The browser check uses a 500 px Firefox viewport; a physical phone was
not tested.

Only one boundary view ships, so statistical invariance when changing views is
supported by the separate data contract and crosswalk tests, not an end-to-end
view-switch check. The source CLDR release and joined CSV transformation remain
unverified; 20 area codes have no geometry and one is ambiguous in this view.

## Map-stage decisions and future choices

- Which boundary source and disputed-area policy should be the first shipped
  view? The code should permit alternatives without changing CLDR data.
- Which administrative metrics are defensible beyond raw CLDR estimates,
  literacy, and official status? Exclude the current diversity formula until
  reviewed.
- Should area markers appear automatically when the Administrative header view
  opens, or only after a territory/metric is selected? Either behavior must keep the
  default language map unchanged on initial load.
- If a future deployment supplies a passive client-country signal, define the
  supported country-to-view mapping against separately reviewed boundary
  packages. Fall back to the documented source view when either is missing;
  never request browser geolocation or infer location from browser language.
