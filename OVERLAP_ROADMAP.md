# Overlap roadmap

Last updated: 2026-11-09.

This document tracks the limitations to lift after the browser overlap-hatching
proof of concept. Item IDs are stable so future sessions can refer to them.
Priorities and ordering below are proposed. Engine decisions and supporting
evidence are recorded as work completes; GPU and server architectures remain open.

When working on an item, update its status, record the result and evidence, and
leave a concrete next step if it remains open. Mark an item complete only when
its completion criteria are met. Update the implementation notes when behavior
changes.

## Starting point

An upstream shared-coverage prototype is now available through
`pipeline.atlas.build --shared-coverage`; the legacy builder remains the default
while geometry size and offline cost are tuned. It computes a canonical partition before LODs and
derives both source geometry and reusable parts from the same simplified faces.
Branch preparation composes those parts rather than repeating a geometric overlay.
Shared quantization and tile-cut nodes prevent independent simplification/export
from pulling adjacent boundaries apart. Coverage boundaries use a tighter error
tolerance than internal language borders. Source repairs and per-level geometry
costs are recorded in the generated report, with canonical and LOD caches kept
separate. Offline label transfer remains a significant cost on full Asher data.

The first full-data experiment built all seven dataset/period profiles through
zoom 8. Decoded checks validated 51 coarse Asher tiles and 55 additional fine/profile
tiles, with matching source/parts footprints and sampled membership geometry.
The production prepared-coverage suite passed 65 views plus five delayed LOD
transitions (370 sampled frames); all used prepared coverage with zero live input
or partition work. Worker composition times across the recorded views were
11–742 ms. Navigation retained fill through another 2,098 frames in both
projections. Inspection lifecycle checks passed, and 48 hover samples were
8–42 ms (median 19 ms) without geometry recomputation on this host.

The combined archive grew from about 29 MB to 64 MB. The initial 300k output cap
was raised to 600k after a real Asher zoom-2 view used 330,875 positions. Other
limits remain unchanged. Before default rollout, tune coarse boundary complexity
and offline label transfer, then measure representative devices and mixed-profile
fallbacks. The complete isolated preview is `app/test-results/topology/site`;
run `npm run preview -- --outDir test-results/topology/site` from `app/`.
Reports/screenshots are under `app/test-results/topology/` (ignored artifacts).

The current implementation resolves one geometry variant per selected language,
reads simplified vector tiles from the existing PMTiles archive, and computes
disjoint coverage regions in a browser worker using `geos-wasm@3.1.1`
(GEOS 3.13.0) and `RBush`. MapLibre renders single-language regions with native
solid fills; shared regions use `fill-pattern` images alternating every
contributor's color. Opacity is applied once over the basemap, defaulting to 82%.

Original language geometry remains available for picking. Navigation and failed
updates retain the last valid coverage; replacements load in a second source
before swapping into view. A clipped vector fallback streams language colors
outside computed tile interiors. Selection changes clear obsolete memberships.
Complete single-dataset branch views have optional offline coverage at zooms 0–3;
selection-independent prepared parts cover single-dataset/period subsets and
branches at all source zooms (currently 0–8). Mixed profiles and unavailable
optional assets still use bounded live computation.
Geometry operations run on the CPU; MapLibre drawing runs on the GPU.

See the [implementation notes](app/src/features/map/overlap/README.md) for the
data flow, libraries, and current mechanics.

Preserve these design decisions as the implementation evolves:

- Area definition, coverage partitioning, and visual styling are separate
  responsibilities. Query-defined areas belong upstream of partitioning.
- Rendered coverage has disjoint interiors and complete contributor memberships,
  including intersections of three or more areas. Tile fragments, holes, and
  disconnected pieces do not need to become one global polygon.
- Each region receives a solid fill or alternating stripes containing every
  contributor's color. Transparency reveals the basemap without tinting stripes
  with another language fill underneath.
- Styling changes such as opacity do not require geometry recomputation.
- Superseded results cannot restore old selections. Failed computations cannot
  publish an apparently complete but partial partition.

## Work items

### OVL-01 — Robust geometry for dense selections

**Status:** Complete for the known failures (2026-10-28).

Replaced `polygon-clipping` with GEOS/WASM default robust overlay. The worker
loads GEOS lazily, retains native intermediate geometry, validates source inputs,
and releases native allocations after each partition.

The [regression tests](app/tests/overlap-geos.test.ts) retain the two original
failing cases and check valid polygons, complete memberships, union preservation,
disjoint interiors, and cleanup on failure. Geometry budgets and the renderer's
separate pattern limit still apply. Add any new topology failure as a fixture
and reopen this item if needed.

### OVL-02 — Continuous coverage during navigation and updates

**Status:** Implemented; focused automated browser coverage added.

Movement no longer hides coverage. Two buffers pair computed coverage with a
vector fallback clipped to its complement. One buffer contributes opacity at a
time; replacements pass coverage identity and both source readiness checks.
Selection changes clear both buffers and reject old responses.

Up to 48 recently visited tiles at one detail level are retained, prioritizing
the viewport. Unchanged retained tile sets skip requests and source updates;
extensions reuse worker partition caches. Failures retain valid coverage while
the independent fallback continues streaming solid language colors elsewhere.
Boundary tiles are clipped per feature in a separate GEOS worker; whole covered
tiles are omitted and untouched tiles pass through unchanged. Fallback overlaps
use source-order solid fills until stripes are available, without claiming full
memberships. Normal vector-tile loading latency still applies.
Zoom changes retain the previous display until a matching snapshot at the new
detail level has completed the entire requested partition and its atomic coverage/fallback source
is ready. Cross-detail prefixes cannot replace existing striped coverage. Initial
loads and same-detail extensions still publish progressively. Snapshot swaps and
new requests wait until camera movement finishes. Reversing a zoom can reuse
native tiles from the visible snapshot without rebuilding its sources.

Continuity correction (2026-11-05): a new fixed-location browser probe reproduced
10 rendered frames in which an English/Welsh overlap reverted to solid fallback
after a partial zoom-out publication. The layer remained enabled, so the earlier
layer-activation assertion missed this regional loss. Holding cross-detail
replacement until completion removed the reproduced gap. Expanded Firefox checks
sampled 1,913 frames across four-language/all-language selections, globe/Mercator,
large zoom changes, interrupted zooms, and nearby pans: zero missing shared faces
and zero flat stripe patches at the probe. All 55 unit tests, lint, type checks,
and production build pass; five browser scenarios and source-failure recovery pass.
New-detail failures preserve the old snapshot and cache completed tiles for Retry.
Source geometry still changes with detail, and normal tile-loading latency,
unseen areas, and subpixel overlaps remain outside a universal no-pop guarantee.

Area lifecycle follow-up (2026-11-05): delayed-delivery browser probes reproduced
square areas exposing the background. Two independent causes were isolated:
MapLibre 6.14.0 discards deeper loaded siblings when any nearer generation is
available, and limits descendant retention to three levels; separately loaded
fallback masks can also advance before their coverage. Retention alone still
reproduced 37 missing frames in the four-language Mercator test, and 36 in the
all-language case with slow fallback. Coverage and clipped fallback now travel in
one atomic MVT/source. A version-guarded Vite correction retains the nearest loaded
tile per branch only for overlap sources. Source retirement also waits for actual
React detachment before releasing bytes/images. The library workaround requires
review on upgrades; newly exposed areas still have ordinary loading latency, and
old snapshots temporarily keep fallback at their own computation detail.
Production Firefox validation passed all five previously supported scenarios.
The expanded area probes sampled 2,719 rendered frames across both Britain
selections, both projections, 700 ms delays on each tile service, large zoom-outs,
and nearby pans: zero disappearing filled areas or exposed background pixels.
The separate stripe probes sampled another 1,896 frames with no lost shared face
or flat stripe patch. Source-error recovery, style restoration, selection clearing,
resource checks, and all 61 unit tests passed. These remain reference-location
regressions rather than a universal no-blank guarantee for never-loaded regions.
The Britain-small development-server run also passed. Its first run exposed a
Vite dependency-version query that bypassed the build transform; query handling
now has an integration regression. Navigation-cache assertions wait for projection
changes and their debounced coverage refresh to settle before recording the view.

Globe seam correction (2026-11-05): a fully filled synthetic vector map reproduced
thin background cracks at tile cuts in globe projection (207 exposed pixels across
native and assembled-parent control views), while Mercator controls were clean.
The render tiles now extend tile-cut edges into MapLibre's existing 1/128-tile
stencil border, joining each apron into its original polygon ring. Canonical
interiors remain separate and unchanged; parents assemble those bytes before
buffering only their own outer edge. Clipped fallback uses the same treatment.
This follows ordinary vector-tile buffering and adds no MapLibre workaround.
Native coverage retains a second encoded render payload; receiver and delivery
byte counters account for both. GEOS-based tests confirm identical canonical
coverage, holes, and masks, including retained parents. All 64 unit tests pass.
The browser regression scans 600×400 interior pixels in 32 loaded views across
both projections: five native/overzoom levels and three zoom-out parent levels,
each buffered and unbuffered. All 16 buffered views expose zero background pixels.
Production Firefox also passed Britain-small, Britain-all, and regional-all,
including 2,711 delayed-navigation area frames and 1,906 stripe frames
with no disappearance, style/inspection checks, resource bounds, and protocol
failure recovery. The development Britain-small run passed as well.
One navigation continuity point moved from longitude 0 to 0.1 degrees to remain
inside land rather than exactly on a tile cut: an apron can briefly color a newly
exposed cut before its neighboring tile ever loads. Fully loaded exact boundaries
are now checked separately by the stronger synthetic regression.

Verification: tile-retention regression test and Firefox checks across pans,
return navigation, zoom changes, selection clearing, and an injected worker
failure. All 150 sampled navigation frames kept one coverage layer active and
the original fills suppressed; the failed update preserved its previous opacity.
The zoom-out regression also selects all 4,062 Asher languages, retains a detailed
Britain partition, and forces a world-view update failure: newly visible language
colors load through the fallback without map errors. Clipping tests preserve
holes/properties and exclude computed tile interiors across detail levels.

The committed production-browser harness now checks cold/warm source publication,
animated zoom-out, selection clearing, and retained coverage plus loaded fallback
when a world-view update reaches a limit.

**Remaining:** Broaden automated navigation checks to more locations, boundaries,
and injected streaming failures. Focused spatial/pixel checks now cover the
reproduced zoom regression. Pans/return and dense-to-small selection supersession
now run in the production-browser harness.
Incremental tile delivery and batched partial publication are implemented (OVL-04).
Prefetching and selective in-place render-tile replacement remain possible improvements.

**Complete when:** Cached, valid coverage remains visible during navigation;
new coverage arrives without doubled opacity or stale memberships; and normal
navigation no longer requires switching to ordinary overlapping fills. Loading
and failure states are explicit and have browser regression coverage.

### OVL-03 — Generic area contributors for future queries

**Status:** Open. **Priority:** Next after the core is reliable.

**Current limitation:** The partitioning function accepts generic IDs and
geometries, but tile decoding, color lookup, selection, and inspection remain
tied to language variants. Arbitrary query-defined areas are not a supported
input yet.

**Work:** Define an input contract for area identity, geometry, style, and
inspection metadata. Keep query evaluation and formation of each query's area
upstream. Adapt the language selection path to that contract.

**Complete when:** Both individual languages and a supplied query group can use
the same partitioning/rendering path. Languages within one query area form one
contributor; intersections between distinct query areas retain their respective
memberships and colors. Inspection can explain the group and its members.
This item does not require implementing the full query language or query UI.

### OVL-04 — Measured performance, cancellation, and resource budgets

**Status:** Open; incremental delivery, cancellation supervision, bounded LRU
caches, and measured fallback shortcuts implemented. Remaining work is ordered below.

**Current architecture:** Workers stream encoded, native tile-space MVT results.
The receiver retains up to 48 same-detail tiles and sends a known-tile manifest,
so pans compute/transfer only additions. Two immutable vector snapshots pair
computed coverage with matching fallback masks; a 250 ms initial grace period
and 32 ms batching limit intermediate publication. Completed prefixes can survive
later failures, without claiming full completion. MapLibre still prepares visible
render tiles on each snapshot swap; there is no full GeoJSON transfer/re-tiling.

A lazy delivery worker assembles retained descendants into zoom-out parent tiles.
Its 48-entry/8 MiB LRU payload cache is keyed by relevant descendant identities.
Native/empty requests remain direct. Only newly referenced encoded tiles are copied
into the worker across snapshots, and release drops unused native references.
Fallback has separate raw/clipped byte caches; clipped identity uses archive,
tile, and sorted local mask, so unrelated coverage changes do not invalidate it.
Decoded/partition caches now refresh on use too.

Fallback bounds tests omit features wholly inside one covered rectangle and pass
through features wholly outside the mask and inside the tile. Boundary cases,
including source tile buffers, still use GEOS. Source order, IDs, properties, holes,
and visible geometry are preserved. No simplification or dataset change was made.

**Cancellation and deadlines:** Abort superseded fetches cooperatively. After
150 ms without a cancellation acknowledgement or replacement-start message,
terminate a blocked worker and restart only the latest request. Responsive
cancellation preserves caches. An 8-second computation deadline includes fetching
and initialization; a 12-second publication deadline also covers source staging.
Errors preserve available coverage and give feedback. These UI-thread watchdogs
are subject to browser timer scheduling/throttling; individual GEOS operations
remain synchronous. Termination releases the worker's WASM context and caches.

Recovery hardening (2026-11-05): fallback tile requests now also have an 8-second
watchdog and 150 ms cancellation acknowledgement grace. Blocked fallback workers
are terminated; cancellation restarts replay only live requests within their
original deadlines. Deadline/initialization failures reject outstanding requests
explicitly. Failed lazy initialization can retry; both worker clients discard
failed module registries before Retry. Cancellation is checked after initialization
before native clipping. Valid completed prefixes retain their
publication deadline even after a later tile fails. Unit regressions exercise
these recovery paths with deterministic clocks.

Verification (2026-11-05): all 52 Node tests, lint/type checks, and production
build pass. Five browser scenarios (`britain-small`, `regional-small`,
`world-small`, `britain-all`, `regional-all`) pass cold/warm runs and applicable
navigation, supersession, inspection, style replacement, solid pixel, and injected
source-failure recovery checks. Full style replacement recorded one temporary
blank-layer frame, separately from navigation, with no missing visible patterns
after restoration. The all-language world scenario intermittently exceeds the
unchanged 1.5-second tile deadline on this host. A temporary copy of the committed
app at `e1b47d4`, using the same installed dependencies and archive, also failed
on that deadline after two completed tiles. The required-stripes browser assertion
and production budget remain unchanged; the full browser command is therefore
not reliably green on this host. Next isolate the cold partition cost and confirm
the existing provisional targets on representative hardware before changing budgets.

**Evidence (2026-10-28):** Firefox 156, headless, 1440×1000 requested window,
basemap off; software rendering requested (actual backend not independently
verified). Local archive SHA-256 starts `0f55734c095a4e56`. Fresh baseline: two
runs; final: three. Full dispatch-to-ready medians, in milliseconds:

| Scenario | Cold before → after | Warm before → after |
| --- | --- | --- |
| Britain, all languages | 306 → 322 | 66 → 68 |
| Dense region, all languages | 1,516 → 1,524 | 298 → 326 |
| World, all languages | 3,026 → 2,941 | 348 → 357 |

These small differences are not evidence of a general speedup. Cold world worker
time remains about 2.47 seconds. During Britain-all's animated zoom-out, the bounds
shortcut reduced GEOS candidates to 2,926 of 12,137 features (76% avoided).
Cumulative fallback clipping time fell from a 1,282 ms median to 826 ms across
three runs before/after the shortcut. This includes initialization/awaiting and
is not pure CPU or end-to-end latency; concurrent tile timings can overlap.
Final decode/overlay/encode medians were 49/321/38 ms, and accumulated initialization
wait was 282 ms. Parent assembly was comparatively inexpensive (15–27 ms total
before the shortcut) and is now off the main thread. Clipped-cache hits were zero
on the first traversal; changing local masks still require work. Raw-byte reuse
occurred. A repeated-navigation clipping speedup is not claimed.

Earlier optimization milestones: grouped tile memberships and smaller textures
made dense regional/world stripes render within the pattern budget (world: 4,166
shared patterns). Incremental MVT delivery reduced measured world warm readiness
from 916 to 339 ms, cold from 3,309 to 2,969 ms, with first partial render at 722 ms.
Those are separate baseline runs, not directly comparable to the table above.

Thirty-two unit tests and all eighteen browser cases pass. Coverage includes
byte/entry budgets, local-mask invalidation, source order/holes/buffer clipping,
snapshot release, cooperative cancellation, blocked supersession, deadline failure,
and recovery. The browser harness checks resource limits, navigation/return reuse,
selection clearing, and dense-to-small selection supersession with membership
inspection. Cleared receivers retain zero registered snapshots.

**Proposed engineering targets:** On this reference setup, Britain cold readiness
under 500 ms and warm under 100 ms; dense/world first useful coverage under 1 second,
full cold readiness under 4 seconds and warm under 500 ms. Measured medians fit.
These are provisional development targets, not product SLAs or machine-independent
CI gates. Confirm them on representative devices. A total memory target requires
heap/GPU measurements rather than adding payload byte counts together.

**Remaining, in order:**

1. Further reduce fallback work during changing masks. Stage counters now separate
   decoding, initialization, GEOS import/Boolean/export, and encoding; isolate the
   remaining GEOS cost before retaining native geometry or changing clipping strategy.
2. Measure MapLibre preparation/atlas/drawing costs within snapshot swaps before
   replacing the two-buffer lifecycle with selective in-place GPU tile updates.
3. Improve cold GEOS partitioning. Complexity-aware preprocessing/detail reduction
   needs an explicit accuracy policy and tile-boundary regressions (OVL-05).
4. Account for JS objects/backing buffers, GEOS heap capacity, MapLibre tile atlases,
   and GPU allocations under repeated navigation. Current counters and bounded caches
   do not establish a total memory bound or prove absence of every leak.
5. Broaden injected failure and pixel coverage under OVL-08, and confirm provisional
   latency/resource targets. No worker pool or dataset format change was introduced.

**Complete when:** Reproducible benchmarks and agreed targets are recorded;
superseded work is abandoned within a defined bound; request work and resources
are controlled; repeated use does not accumulate unused resources; and remaining
limits have a documented reason and clear feedback. Full memory accounting and
representative-device targets remain necessary to close this item.

Reproduce with `npm run test:browser -- --runs 3 --output test-results/resource-bounds`.
Reports/screenshots are ignored local artifacts; useful results live here. See
[measurement semantics](app/tests/browser/README.md) and [implementation details](app/src/features/map/overlap/README.md).

Current POC limits, to revisit rather than simply remove:

| Resource | Current limit |
| --- | --- |
| Computation tiles | 48, at zoom 0–8; reduce zoom to fit |
| Decoded tile cache | 48 entries and 16 MiB of decompressed tile bytes |
| Native partition cache | 48 entries and 150,000 positions; encoded tiles cached weakly |
| Receiver tile retention | 48 desired tiles/600,000 positions, plus active/staging encoded snapshots |
| Fallback byte caches | Raw: 48 entries/16 MiB; clipped: 96 entries/16 MiB (local mask keys) |
| Parent delivery cache | 48 entries/8 MiB; native references follow active/staging snapshots |
| Request deadlines | 8 seconds computation; 12 seconds publication; 150 ms supersession grace, subject to UI timer scheduling |
| Selected input per tile | 100,000 positions |
| Intermediate regions per tile | 12,000 |
| Overlay time per tile | About 1.5 seconds, checked between operations |
| Complete output | 600,000 positions |
| Padded pattern texels | 4,194,304 per result; twice that across owned images during swaps (16/32 MiB RGBA, excluding atlas copies/overhead) |
| Pattern image size | 256 × 256 pixels; up to 42 contributors at unchanged spacing; solids allocate no images |

### OVL-05 — Consistent tile boundaries, detail, and inspection

**Status:** Open. **Priority:** After robustness; investigate visible defects sooner.

**Current limitation:** Simplified and quantized display tiles can remove small
overlaps or change them with zoom. Reducing computation zoom can make coverage
less detailed than the original language layer. Tile seams remain a potential
artifact. Inspection now reads explicit membership metadata from the active
coverage and clipped fallback layers, including retained detail, rather than
querying hidden original polygons. Unit regressions cover differing detail,
holes, inactive staging, and fallback; browser pointer clicks cover single/shared/
empty hits. Pinned outlines still use original source geometry. Boundary and
small-region accuracy risks have not all been captured as regression cases.

**Work:** Define the expected display accuracy and zoom policy. Add difficult
tile-edge, date-line, small-region, and projection cases. Align inspection with
the displayed region's membership while retaining access to source identities.

**Complete when:** Representative boundaries are visually continuous in globe
and Mercator views, inspection agrees with rendered membership, and the supported
detail/accuracy policy is documented and tested. Authoritative geographic analysis
or area statistics would require a separate accuracy decision; they are not
implicitly promised by this roadmap.

### OVL-06 — Stripe readability and scaling

**Status:** Open. **Priority:** Improve with visual feedback and measurements.

**Current limitation:** Pattern spacing scales with the map rather than staying
fixed on screen. Pattern zoom fades are disabled to avoid mixed colors, and
texture filtering softens stripe edges. Shared memberships allocate separate
images; single contributors now use native solid fills. This removes the visible
grid caused by sampling one-texel patterns. Framebuffer regressions check exact
solid colors at 100% intensity in globe and Mercator views. The previous 128-pattern
cap has been replaced by a padded-image-area budget; stripe images use one quarter
of their previous pixels at the same displayed spacing. Dense regional/world
scenarios now render thousands of combinations. The 42-contributor limit and
texture budget remain implementation limits, not established usability limits.

**Work:** Define stripe spacing and zoom behavior, assess legibility with many
contributors and similar colors, and review pattern allocation costs. Decide how
to explain dense overlaps when all colors cannot be read comfortably. A custom
shader is an option to evaluate if native patterns cannot meet the requirements.

**Complete when:** The chosen visual policy works across the supported zooms,
projections, and contributor counts. Solid and striped colors remain consistent
at each opacity, zooming introduces no false interior colors, and dense-overlap
behavior is explicit without silently dropping contributors.

### OVL-07 — Separate orchestration from rendering and controls

**Status:** Implemented for the current lifecycle; style-image restoration added
(2026-11-05). Broader component remount checks remain.

`controller.ts` now owns requests, retained coverage, explicit computation phases,
publication batches/deadlines, supersession, and failure/retry transitions.
`mapResources.ts` owns native snapshots, stripe images, layer ordering, and
MapLibre readiness/errors. `OverlapHatching` connects those services to React
and declares the layers; its size fell from 598 to 253 lines.

Readiness checks match both immutable coverage and revisioned fallback URLs.
Source errors block staging even when MapLibre reports loaded=true. Failed
staging releases its snapshot and preserves previous coverage; active streaming
errors restore original fills. On-map feedback and Retry expose degraded states.
Retry retains valid geometry instead of clearing the display.

Verification: eight controller/adapter regressions cover publication readiness,
coalescing, failures/recovery, stale selections/modes, deadlines, budgets, and
cleanup. The browser harness injects actual coverage/fallback protocol failures
and checks retained source identity, released staging, and Retry recovery.

Owned images now restore on `styleimagemissing` after style replacement without
repartitioning. A unit regression checks restoration, pruning, and listener cleanup;
the production browser harness checks a full style rebuild, unchanged snapshot
identity, image restoration, and inspection. Explicit style-rebuild blank frames
are recorded separately from navigation continuity.

**Remaining:** Broaden component remount and injected streaming
failure checks. Keep new transitions in the controller rather than rebuilding
an imperative lifecycle inside React.

**Complete when:** Those responsibilities can be exercised independently, and
source/layer remounts, repeated updates, and cleanup preserve correct ordering,
selection identity, and resource ownership without console errors.

### OVL-08 — Broader automated regression coverage

**Status:** Open. **Priority:** Begin with OVL-01 and extend with each work item.

**Current limitation:** Existing tests cover focused geometry cases, stripe
pixels, tile selection, budgets, and a real Britain example. A focused browser
harness covers six production-build scenarios, cache reuse, incremental pans/return,
zoom-out/failure retention, dense selection supersession, resource limits, and selection clearing. GEOS regressions cover the captured failures, invalid and
mixed-dimension inputs, and native ownership on success/failure/budget rejection.
Focused solid-color framebuffer assertions and injected source-loading failures
with Retry now run too. There is no broad randomized geometry corpus,
comprehensive visual suite, or full application performance regression suite.

**Work:** Add invariants for complete membership, disjoint interiors, union
preservation, and deterministic results across a broader corpus. Automate
selection changes, navigation, cached-result publication, opacity, projections,
inspection, error states, and cleanup. Keep real-data fixtures reproducible.

**Complete when:** Known bugs have committed reproductions; core invariants and
critical browser transitions run automatically; and benchmark results can be
compared across implementations. Extend coverage as new failure modes appear.

### OVL-09 — Coverage-preserving genealogy branches

**Status:** Implemented (2026-11-08).

“Show branch on map” selects mapped ancestors and descendants. Within the pinned
branch/context and temporal view, descendants replace ancestor colors locally;
unrelated and sibling overlaps remain. Parent geometry and provenance stay pinned,
and removing descendants restores their ancestor fill. Branch families share
their selected root's palette instead of each becoming a separate comparison root.

The live engine subtracts a batched descendant mask before processing an ancestor.
Complete dataset/period views optionally use offline tiles at zooms 0–3, keyed by
the exact archive and versioned selection/refinement signature. Mixed sources,
partial branches and higher zooms remain live. Prepared data never combines datasets.
CI builds the optional coverage after installing frontend dependencies.

Firefox checks cover Halh/Dariganga in both modes and projections and restoration
after child removal. A local software-rendered world run selected all 5,302 Asher
contemporary entries: four prepared tiles, zero live Boolean time, 402 ms worker
time, first coverage at 784 ms and complete publication at 1,319 ms. These are
observations from this machine, not latency targets. All seven dataset/period
profiles take about two minutes to prepare; repeated generation reused completed files.

The first full-world stripe run exceeded the existing texture budget. Larger
multi-color stripes now use tighter repeats with integer image pixel ratios;
that view uses 2,550,124 padded texels and stays below the unchanged limit.
Blending draws one composite face layer per buffer, avoiding thousands of layers.
The navigation regression initially reached the live deadline at zoom 3; extending
preparation through that zoom resolved it. The final Asher/DLAC navigation run
sampled 2,097 frames across globe and Mercator with no missing coverage, including
zooms 3–6.5. Frontend tests (120), pipeline tests (16), catalog/comparison browser
checks, branch browser checks, lint, type checks and the production build pass.
The renderer's other budgets remain in force. Reusable coverage parts now also
accelerate same-dataset/period subsets at low zoom, as described below;
mixed-source comparisons and higher zooms stay live.

Reusable coverage parts (2026-11-08) preserve every original membership, including
hidden ancestors, in a dataset/period partition at zooms 0–3. Runtime selection,
aggregation and refinement only remap memberships; identical shared edges can
cancel without general Boolean geometry. Exact full branch tiles remain preferred
for compactness. All seven profiles total 51,441,777 bytes locally, in addition to
the existing branch assets. Preparation is atomic/resumable and runs in deployment.

Production Firefox with software rendering, three runs on the development machine:

| Selection | Live worker median | Parts worker median | Live / parts first rendered coverage |
| --- | --- | --- | --- |
| DLAC regional full view | 389 ms | 72 ms | 465 / 141 ms |
| DLAC partial Sinitic branch | 143 ms | 54 ms | 200 / 100 ms |
| DLAC descendant aggregate | 246 ms | 55 ms | 275 / 81 ms |
| Halh and Dariganga | 40 ms | 90 ms | 98 / 138 ms |
| Asher European full view, zoom 3.5 | Tile deadline in all runs | 741 ms | No complete live view / 1,332 ms |
| Asher world with Dariganga removed | Engine benchmark hits tile deadline | 443 ms | 1,346 ms with parts |

Parts requests report zero partition and GEOS initialization time. Probe memberships
match between engines for tested branches and aggregates; child removal restores
parent fill. Changing selection reuses the prepared metadata cache. The world
subset passes both projections and render modes within existing geometry/texture
budgets. A single remaining language still uses native fills with no partition.
Tiny selections can be slower because loading a full prepared tile outweighs a
cheap live overlay. Cached results are already fast in both engines; gains concern
uncached selections and avoiding live geometry failures. HTTP/OS caches may be warm.

Reproduce with `npm run precompute:parts`, `npm run benchmark:parts`, and
`npm run test:parts-browser`. Reports live under `app/test-results/coverage-parts/`.
Further work: extend detail levels based on storage/runtime measurements, reduce
prepared tile transfer overhead for tiny selections, and measure remaining encoding,
MapLibre preparation and fallback costs. Existing display-accuracy and memory
limitations still apply.

Prepared delivery update (2026-11-08): DLAC now has reusable parts through zoom 5;
other profiles remain at zoom 3. Source polygons are filtered into dataset/period
PMTiles archives without re-tiling; workers and original fills read only profiles
required by their selections or browsing filters. Reusable preparation traverses
archive directories rather than the global grid, writes no empty MVT files, and
publishes a lazy, content-addressed availability index per completed profile.
Filtered runs preserve other profiles and higher-detail preparation. The source
and partition workers retain caches when selection profiles change. Geometry
provenance loads on demand in Details; search and availability metadata remain eager.
DLAC zooms 4–5 add 31 nonempty tiles and 121,595 bytes locally. All seven profiles
now occupy 51,582,869 MVT bytes across 244 nonempty files. The production delivery
browser check verifies zoom-5 parts with zero live overlay, source routing and
pan/return navigation; existing catalog and parts suites cover mixed sources,
refinement and cache reuse. The generator supports per-profile zooms up to source
zoom 8 using `--dataset`, `--period` and `--max-zoom`; extending every profile still
needs storage/runtime measurements. Mixed-source/period partitions remain live.

All-dataset intermediate detail (2026-11-08): the earlier DLAC-specific default
has been removed. Preparation now covers every source level supported by the
client, currently zooms 0–8, for all seven dataset/period profiles, including both
Asher contemporary and time-of-contact. Each complete zoom is published atomically;
an interrupted fine-detail build preserves the intermediate levels it completed.
The full local preparation produced 252,845,624 bytes across 61,992 nonempty MVT
files in approximately ten minutes, with lower levels and completed tiles reused.
Availability indexes and viewport tiles still load lazily; extending preparation
does not make clients download the entire output.

The Asher full-branch live engine reproduced tile deadlines at zoom 4 in tiles
8/7 (Africa) and 12/6 (Asia), and at zoom 5 in the African case. Engine measurements
on the development machine: prepared cold resolution/encoding took 116 ms,
55 ms and 70 ms respectively, with zero live overlay time. The corresponding
live requests failed at their existing 1.5-second tile deadlines. Time-of-contact
Africa at zoom 4 likewise changed from a deadline to 114 ms with parts. These
are local observations, not latency guarantees. `benchmark:parts` now includes
African and Asian detail levels 4–8 and the historical period; `test:prepared-browser`
checks actual source delivery, world-to-region navigation, both Asher periods,
subsets, globe/Mercator, and every other dataset through source zoom 8.

The new navigation checks also exposed receiver history pressure: a cold Asher
Asia zoom-4 viewport fitted the output budget, but panning there from Africa
retained offscreen geometry and exceeded 200,000 positions. The controller now
evicts offscreen history before rejecting visible positions or pattern memory.
The visible view retains its requested detail and existing budgets; worker caches
remain available for return pans. Unit regressions cover position and texture
eviction, stable idle requests, and genuine visible overflow retaining good coverage.

## Decisions still open

- GEOS/WASM is the current CPU geometry engine. Whether later workloads justify
  a different partition algorithm, parallel workers, GPU coverage, or a server
  remains open.
- Whether display geometry remains derived from the existing simplified tiles
  or needs a separate geometry/detail pipeline.
- Whether native image patterns meet the desired zoom behavior and resource
  budget or justify custom rendering.
- The supported contributor counts, latency/memory targets, and loading/error
  presentation. Establish these explicitly rather than treating POC limits as
  product requirements.

## Session handoff

OVL-01 is complete for the known cases. OVL-02 retention and focused browser
coverage are implemented; broader navigation and spatial assertions remain.
The current focus is OVL-04 measured performance and OVL-06 dense-selection
scaling. The reference dense regional/world views now render and receive incremental
vector-tile results. Warm publication is substantially faster. Cancellation/deadline supervision,
bounded LRU delivery/fallback caches, and parent assembly off the main thread
are implemented. Fallback bounds shortcuts now avoid most unnecessary overlays during changing
masks. Next isolate remaining GEOS import/Boolean/export costs, snapshot
preparation, cold partitioning/detail costs, and total memory use. Cold GEOS
time remains substantial, and geometry success still
does not guarantee fitting the texture budget on every selection.
The generic area contract remains separate OVL-03 work.
Extend performance measurements and regression coverage with each change.

Start with [geometry.ts](app/src/features/map/overlap/geometry.ts),
[geos.ts](app/src/features/map/overlap/geos.ts),
[compute.ts](app/src/features/map/overlap/compute.ts),
[delivery.ts](app/src/features/map/overlap/delivery.ts),
[OverlapHatching.tsx](app/src/features/map/overlap/OverlapHatching.tsx), and
[the existing tests](app/tests/overlap.test.ts).

Current verification commands, run from `app/`:

```sh
npm test
npm run check
npm run typecheck
npm run build
npm run test:browser
npm run precompute:branches
npm run test:branch-browser
```

The real-archive tests require generated `app/public/data/language-areas.pmtiles`
(and the catalog for the dense test); without those files they are skipped. See the root [README](README.md) for data setup.
