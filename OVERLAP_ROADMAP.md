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

**Status:** Implemented; automated browser regression coverage remains open.

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
Zoom changes retain the previous display until a complete new detail level loads.

Verification: tile-retention regression test and Firefox checks across pans,
return navigation, zoom changes, selection clearing, and an injected worker
failure. All 150 sampled navigation frames kept one coverage layer active and
the original fills suppressed; the failed update preserved its previous opacity.
The zoom-out regression also selects all 4,062 Asher languages, retains a detailed
Britain partition, and forces a world-view update failure: newly visible language
colors load through the fallback without map errors. Clipping tests preserve
holes/properties and exclude computed tile interiors across detail levels.

**Remaining:** Automate browser checks for navigation, source swaps, failure
retention, and selection changes. Incremental per-tile publication and prefetching
remain possible performance improvements, rather than prerequisites for retention.

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

**Status:** Open. **Priority:** Optimize from evidence.

**Current limitation:** There is no full application benchmark suite or total
request deadline. The worker yields between tiles, but a Boolean operation cannot
be interrupted in the chosen WASM build. Native allocation cleanup is tested;
full memory accounting is not. Geometry crosses worker boundaries and is
processed again by MapLibre. Pattern creation runs on the main thread. Cache
limits do not bound all decoded-object or texture memory, and caches are FIFO.

**Work:** Measure cold/warm requests, dense intersections, selection changes,
and repeated navigation. Separate fetching, decoding, partitioning, transfer,
source preparation, pattern allocation, and drawing costs. Define supported
latency and memory targets from those measurements, then improve scheduling,
cancellation, caching, and resource accounting where needed.

**Complete when:** Reproducible benchmarks and agreed targets are recorded;
superseded work is abandoned within a defined bound; total request work and
resource use are controlled; and repeated use does not accumulate unused
resources. Any remaining limits have a documented reason and clear user feedback.

Current POC limits, to revisit rather than simply remove:

| Resource | Current limit |
| --- | --- |
| Computation tiles | 48, at zoom 0–8; reduce zoom to fit |
| Decoded tile cache | 48 entries and 16 MiB of decompressed tile bytes |
| Partition cache | 48 entries and 150,000 coordinate positions |
| Selected input per tile | 100,000 coordinate positions |
| Intermediate regions per tile | 12,000 |
| Overlay time per tile | Approximately 1.5 seconds, checked between operations |
| Complete output | 200,000 coordinate positions |
| Shared-membership patterns per result | 128 |
| Pattern image size | 512 × 512 pixels; currently up to 42 contributors |

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
images, including solid images for single contributors. The 128-pattern and
42-contributor limits are implementation limits, not established usability limits.
Dense selections can require hundreds or thousands of shared patterns, exceeding
the current limit even when geometry computation succeeds.

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
uses a collection revision and an object-identity comparison with serialized
source data, which is sensitive to integration behavior.

**Work:** Separate the computation controller, versioned coverage state,
MapLibre resource management, and controls. Make loading, ready, superseded, and
failed states explicit, with a documented source-readiness mechanism.

**Complete when:** Those responsibilities can be exercised independently, and
source/layer remounts, repeated updates, and cleanup preserve correct ordering,
selection identity, and resource ownership without console errors.

### OVL-08 — Broader automated regression coverage

**Status:** Open. **Priority:** Begin with OVL-01 and extend with each work item.

**Current limitation:** Existing tests cover focused geometry cases, stripe
pixels, tile selection, budgets, and a real Britain example. Browser verification
has been manual. GEOS regressions now cover the captured failures, invalid and
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

OVL-01 is complete for the known cases. OVL-02 retention is implemented; automated
browser regression coverage remains before closing it. The generic area contract
is the next architectural item. Keep dense-selection pattern limits as
separate OVL-06 work; geometry success does not guarantee a renderable result.
Extend performance measurements and regression coverage with each change.

Start with [geometry.ts](app/src/features/map/overlap/geometry.ts),
[geos.ts](app/src/features/map/overlap/geos.ts),
[compute.ts](app/src/features/map/overlap/compute.ts),
[OverlapHatching.tsx](app/src/features/map/overlap/OverlapHatching.tsx), and
[the existing tests](app/tests/overlap.test.ts).

Current verification commands, run from `app/`:

```sh
npm test
npm run check
npm run typecheck
npm run build
```

The real-archive tests require generated `app/public/data/language-areas.pmtiles`
(and the catalog for the dense test); without those files they are skipped. See the root [README](README.md) for data setup.
