# Administrative browser model (ADM-03)

This feature reads `administrative/observations.json` only when its loader is
called. It has no import from the atlas repository, geometry selectors, or
boundary package. A missing or invalid supplement affects only its own load
state; the atlas can load normally.

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
`mapCameraIntentAtom`; ADM-05 will add a consumer that resolves the selected
boundary view and representative point. Header view changes also leave camera
intent alone.
