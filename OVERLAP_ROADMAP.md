# Overlap roadmap

Last updated: 2026-10-28.

This document tracks the limitations to lift after the browser overlap-hatching
proof of concept. Item IDs are stable so future sessions can refer to them.
Priorities and ordering below are proposed. Engine decisions and supporting
evidence are recorded as work completes; GPU and server architectures remain open.

When working on an item, update its status, record the result and evidence, and
leave a concrete next step if it remains open. Mark an item complete only when
its completion criteria are met. Update the implementation notes when behavior
changes.

## Starting point

The current implementation resolves one geometry variant per selected language,
reads simplified vector tiles from the existing PMTiles archive, and computes
disjoint coverage regions in a browser worker using `geos-wasm@3.1.1`
(GEOS 3.13.0) and `RBush`. MapLibre renders those regions with native
`fill-pattern` images:
single-language regions are solid, and shared regions alternate every
contributor's color. Opacity is applied once over the basemap, defaulting to 82%.

Original language geometry remains available for picking. Navigation and failed
updates retain the last valid coverage; replacements load in a second source
before swapping into view. A clipped vector fallback streams language colors
outside computed tile interiors. Selection changes clear obsolete memberships.
No overlap combinations are precomputed offline.
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
detail level and its fallback mask are ready; further tiles can publish progressively.

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

**Remaining:** Broaden automated navigation checks to injected failures and
spatial/pixel assertions. Pans/return and dense-to-small selection supersession
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
| Receiver tile retention | 48 desired tiles/200,000 positions, plus active/staging encoded snapshots |
| Fallback byte caches | Raw: 48 entries/16 MiB; clipped: 96 entries/16 MiB (local mask keys) |
| Parent delivery cache | 48 entries/8 MiB; native references follow active/staging snapshots |
| Request deadlines | 8 seconds computation; 12 seconds publication; 150 ms supersession grace, subject to UI timer scheduling |
| Selected input per tile | 100,000 positions |
| Intermediate regions per tile | 12,000 |
| Overlay time per tile | About 1.5 seconds, checked between operations |
| Complete output | 200,000 positions |
| Padded pattern texels | 4,194,304 per result; twice that across owned images during swaps (16/32 MiB RGBA, excluding atlas copies/overhead) |
| Pattern image size | 256 × 256 pixels; up to 42 contributors at unchanged spacing; solids use one texel |

### OVL-05 — Consistent tile boundaries, detail, and inspection

**Status:** Open. **Priority:** After robustness; investigate visible defects sooner.

**Current limitation:** Simplified and quantized display tiles can remove small
overlaps or change them with zoom. Reducing computation zoom can make coverage
less detailed than the original language layer. Tile seams are a potential
artifact, and picking the original polygons can disagree with displayed coverage.
These are accuracy risks; they have not all been captured as regression cases.

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
texture filtering softens stripe edges. Distinct memberships allocate separate
images, including one-texel solids for single contributors. The previous 128-pattern
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

**Status:** Open. **Priority:** Alongside changes that touch the update lifecycle.

**Current limitation:** `OverlapHatching` combines worker scheduling, map events,
source readiness, pattern lifetime, layer ordering, and UI controls. Readiness
now matches immutable coverage protocol URLs and fallback mask URLs, and checks
both sources loaded before swapping. This lifecycle is still concentrated in
the component; the worker supervisor and delivery/cache services are separate.

**Work:** Separate the computation controller, versioned coverage state,
MapLibre resource management, and controls. Make loading, ready, superseded, and
failed states explicit, with a documented source-readiness mechanism.

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
There is no broad randomized geometry corpus, automated visual suite, or full
application performance regression suite.

**Work:** Add invariants for complete membership, disjoint interiors, union
preservation, and deterministic results across a broader corpus. Automate
selection changes, navigation, cached-result publication, opacity, projections,
inspection, error states, and cleanup. Keep real-data fixtures reproducible.

**Complete when:** Known bugs have committed reproductions; core invariants and
critical browser transitions run automatically; and benchmark results can be
compared across implementations. Extend coverage as new failure modes appear.

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
```

The real-archive tests require generated `app/public/data/language-areas.pmtiles`
(and the catalog for the dense test); without those files they are skipped. See the root [README](README.md) for data setup.
