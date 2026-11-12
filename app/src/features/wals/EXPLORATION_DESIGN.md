# Shared WALS category exploration

WALS-05 decision, 2026-11-12. The implementation contract for WALS-06 is **static
points, a distinct origin marker, and a keyboard-accessible list of the exact
selected observations**. No connecting lines, animation, inferred relationship
graph or polygon recoloring. Existing profile ergonomics are unchanged in this step.

## Representation review

The offline `npm run review:wals-examples` command compares points with the actual
prototype's great-circle arcs from source commit
`3b7078614efcfebc1c471fea2c4ab7fb336745a6`. Each pair uses the same real origin,
category, selected observations and equirectangular graticule. The generated
`test-results/wals-05/review.html` contains five pairs and exact observation tables;
`review.json` records identities, geometry, counts and source/catalog fingerprints.
These are design artifacts, separate from the deployed application.

Reviewed against the pinned WALS v2020.6 release:

| Origin | Exact category | Matching records | Located records | Candidate records | Candidate positions | Displayed observations | Prototype candidate total |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| English (`eng`), 81A | SVO | 488 | 488 | 487 | 487 | 12 | 485 |
| Irish (Donegal) (`ird`), 12A | Complex | 151 | 151 | 150 | 150 | 12 | 150 |
| Kyuquot (`kyq`), 37A | Definite affix | 92 | 92 | 91 | 91 | 12 | 90 |
| Aleut (Eastern) (`aea`), 12A | Complex | 151 | 151 | 150 | 150 | 12 | 150 |
| Mambila (`mla`), 81A | SVO | 488 | 488 | 487 | 487 | 12 | 486 |

The historical candidate totals apply its selection policy to the same current
source data and current catalog associations. They exclude unmatched records,
other varieties of the origin's atlas entry, colocated candidates, and duplicate
atlas associations. They are not counts of all matching WALS observations.
Mambila demonstrates an unmatched origin that can still supply exact source
evidence and a usable WALS location.

In all five arc panels, lines add origin-to-target connections without additional
evidence. Long arcs dominate the geographic distribution, and the Eastern Aleut
example crosses the dateline. Static points convey the examples' distribution
without suggesting transmission or direction. The list supplies the actual
source identity and recorded value; geographic proximity is not evidence of
ancestry or contact.

Actual Word histories lines have a different meaning: `WordTrailLayer` renders
recorded DiACL lexeme edges, with line colors for relationship types. WALS points
will use one category color, an outlined diamond for the origin and round example
markers. Shape, accessible labels and the list distinguish roles without relying
on color. Copy must say “Recorded examples sharing [feature]: [category]” and
“Illustrative geographic selection; not a representative sample, similarity
ranking, or evidence of ancestry, borrowing or contact.” The origin is a viewing
reference, not a historical source.

The unused regional-comparison helper and all legacy arc/animation code are
deliberately not ported. The review also reproduces the prototype's nonfinite
geometry for `[[-180, 10], [180, 20]]`; there is no line interpolation or dateline
splitter in the chosen WALS representation. This does not claim a repair of the
discarded arc path.

## Eligibility and selection

`domain/walsExamples.ts` owns pure selection and static GeoJSON. It takes a
validated repository plus exact origin source ID and feature ID. An absent origin
observation returns `null`: no inference from a default variety, parent or family.

Candidates have the **same feature ID and exact category ID**, a distinct source
ID, and finite WALS longitude/latitude in [-180, 180] and [-90, 90]. Atlas matches,
catalog scope, polygons, pinned areas, filters, workspace, source names and feature
card policy do not affect eligibility. Unmatched and ambiguous records stay
eligible. Separate varieties with the same atlas association remain separate.
Broader associations never turn a source observation into a family-wide claim.

Select at most **12 source observations in addition to the origin**, using greedy
farthest-first spacing on the sphere. Seed with the origin point, then repeatedly
maximize distance to the nearest previously selected point. Squared chord distance
has the same ordering as great-circle distance and needs no path interpolation.
Precompute unit vectors once and update each candidate's nearest distance after
each choice: O(records × limit) distance work, plus source-ID sorting.

Sort by source ID using code-unit order before selecting. Distances within 1e-12
in squared chord units are ties; retain the first source ID. This small tolerance
prevents symmetric floating-point cases from choosing arbitrarily. Selection is
stable under input/index reordering and smaller limits are prefixes of larger
ones. Finite limits are floored and clamped to [0, 12]; nonfinite limits use 12.

An unlocated origin still provides evidence and does not suppress located
examples: the first candidate source ID seeds the selection, followed by the same
spacing policy. Do not invent or substitute a catalog coordinate for the origin.
No candidates yields an empty example list, with origin evidence retained.
These rules produce illustrative geographic spread; they do not optimize coverage
of linguistic families or correct the source dataset's sampling biases.

## Count and grouping meanings

All counts refer to exact-category source records; one observation per source and
feature is enforced by repository validation.

| Field | Meaning |
| --- | --- |
| `matchingRecords` | All matching source records, **including the origin** and unlocated/unmatched records |
| `locatedRecords` | Matching records with usable WALS coordinates, **including a located origin** |
| `candidateRecords` | Located matching records **excluding the origin**, before the display limit |
| `groupedCandidates` | Distinct coordinate positions among candidates; a position shared with the origin still counts |
| `displayedExamples` | Selected source observations **excluding the origin**, at most 12 |

For example: “12 examples shown from 487 located candidates; 488 matching WALS
records, 488 located (including the origin).” Label location counts as locations,
never as languages or records. The rendered point count can differ from both
`groupedCandidates` and `displayedExamples`.

Grouping is by exact canonical position **only for rendering**. Normalize signed
zero, +180 to -180, and pole longitudes to zero. Do not round nearby coordinates,
cluster by atlas ID, jitter locations or merge source evidence. Geographically
distinct candidates are normally selected before additional colocated records;
if fewer positions exist than the limit, additional source records can fill the
remaining slots in stable order, including records colocated with the origin.

Each GeoJSON point carries all selected source IDs and observation IDs at that
position. A point shared by the origin and examples has the explicit role
`origin-and-example`. WALS-06 must disclose the number of displayed observations
at shared points and offer every one in the accessible list; clicking a shared
point must not silently inspect an arbitrary source record. Unselected colocated
records remain in the candidate counts, not in the displayed list. The limit
always bounds source observations, not just marker count.

## Integration and remaining work

`walsExampleSelectionAtom` derives the selection from the repository and the
overlay's source ID, feature ID and limit. `walsExampleGeometryAtom` derives its
static point collection. Primitive dependencies preserve object identity through
profile inspection, catalog completion, visibility and workspace changes: no
resampling or geometry rebuild for those operations. Only IDs/settings remain in
session state. Geometry has at most 13 points and no animation frame loop;
reduced-motion handling for animated paths is therefore unnecessary. WALS-06
camera motion must still honor reduced motion and shared intent cancellation.

WALS-06 will consume these atoms through Geography's composition slots, provide
show/focus/inspect/clear actions and the accessible observation list, label missing
origin/empty results, disclose associations and shared points, and preserve the
current map projection. Hidden overlays retain their selection but must not render
or replay focus on return. Camera consumers must check current request identity
after asynchronous work. No map consumer or control is exposed by WALS-05.

Fixture tests cover exact categories, ties/reordering, limits, invalid/missing/zero
locations, no candidates, missing origin locations, distinct and unmatched
varieties, colocation, dateline spellings, poles, antipodes, mutation and derived
identity. The separate full-snapshot gate checks all 5,517 exported observations,
including the 14 observations belonging to unmatched origins. The visual review
requires restored browser data and the historical Git object, and does not run in
ordinary unit tests or deployment.
