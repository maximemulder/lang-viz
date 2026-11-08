# Browser overlap hatching

`OverlapHatching` receives the resolved geometry variants already selected by
`WorldMap`. Geometry definition, source/period selection, and stripe rendering
remain separate. Complete single-dataset branch views can use optional offline
coverage at low zoom; other selections are computed live.

## Branch composition and prepared views

Branch actions select mapped ancestors as well as descendants. Their pinned
group/context and temporal view determine an explicit descendant-to-ancestor
refinement relation. The live partitioner inserts descendants first, unions the
relevant existing descendant regions once per ancestor polygon, and subtracts
that footprint before handling other overlaps. This avoids redundant ancestry
stripes and repeated differences from increasingly fragmented family polygons.
It preserves available geographic coverage and incomparable contributors.

`npm run precompute:branches` uses the same engine without interactive budgets
offline, one dataset/temporal view at a time, at zooms 0–3. It reads the existing
simplified archive and writes canonical coverage MVT files, including empty tiles.
An archive hash and versioned SHA-256 selection/refinement signature identify the
output. Tiles are written atomically and completed files can be resumed. The
manifest is updated only after all profiles complete; normal atlas regeneration
removes that optional manifest field until preparation is rerun.

The browser uses prepared tiles only when the exact selected variants and
refinements match; aggregate aliases, mixed-source selections and different
policies cannot reuse them. Missing optional files fall back to bounded live
computation. Prepared results use the existing cache, output, pattern, publication,
and cancellation limits. Higher zooms and arbitrary branches remain live.

Both stripe and blend modes consume resolved coverage. Blending composites each
face's ordered member colors once and renders a single layer per buffer, avoiding
one MapLibre layer per selected entry. Color/opacity changes do not recompute
geometry. Native fallback fills sort descendants above ancestors and inspection
applies the same refinement relation.

Two-color stripe repeats retain their 16-pixel period. Larger contributor sets use
tighter repeats with at least three native pixels per color band, reducing texture
storage within the existing padded-texel and resident-image budgets. Images use
integer `pixelRatio: 1`: MapLibre's data-driven pattern attributes store that value
as Uint16, so fractional ratios truncate to zero and make shared faces disappear.

See the [overlap roadmap](../../../../../OVERLAP_ROADMAP.md) for open limitations,
proposed priorities, and completion criteria across sessions.

## Data flow

1. After a selection change or map movement, enumerate viewport tiles at the
   current integer zoom (0–8, matching the archive). Reduce the computation zoom
   if more than 48 tiles would be required. Date-line viewports wrap tile X
   coordinates without requesting duplicate world copies.
2. A persistent module worker reads those tiles directly from the existing
   PMTiles archive. Index variant metadata once per decoded tile, then decode only
   selected variant geometries; retain integer tile coordinates for Boolean operations.
3. Lazily load and initialize GEOS once in the persistent worker. Union duplicate
   fragments per variant and clip away the tile buffer. Insert coverage into an
   RBush spatial index, splitting intersected regions with GEOS 3.13.0 through
   pinned `geos-wasm@3.1.1`. Each face has its complete, sorted membership.
   Holes and disconnected polygons are preserved; edge contact is not overlap.
4. Yield each completed tile, including empty tiles, without waiting for the
   remaining viewport. Group disconnected faces with identical membership within
   that tile. Cache native tile-space coordinates under the existing result bounds;
   the worker encodes a separate `overlap_coverage` MVT layer at extent 8192.
   Encoding quantizes display coordinates before normalizing shell/hole winding;
   rounding can reverse tiny slivers or collapse rings. Collapsed shells discard
   their holes. Parent assembly and clipped fallback use the same conversion so
   slivers cannot make the tile reader interpret large islands as holes.
   GEOS itself still uses its original robust floating-point overlay. Cache encoded
   tiles weakly against their native feature arrays. Only tiles absent from the
   browser's retained set cross the worker boundary. No full GeoJSON collection
   is transferred or re-tiled by MapLibre. `compute()` remains a GeoJSON adapter
   for geometry tests; the browser uses the incremental `computeTiles()` stream.
5. Render single-language faces with native `fill-color`, using a `variantId`
   tag and the selected variants' colors. Only shared faces allocate opaque,
   power-of-two stripe images. The two layers filter disjoint faces and apply
   the same `fill-layer-opacity`, so interiors receive opacity once. Avoiding
   one-texel solid patterns removes atlas-sampling grid artifacts. Coverage and
   clipped fallback share one MVT/source, which must load before original fills
   are suppressed. Coverage tiles
   carry explicit contributor IDs for picking; pinned source outlines stay above coverage.

Color intensity defaults to 82%, adjustable between 40% and 100% without geometry
recomputation. Each region blends with the basemap, never with another language
fill underneath. This keeps solid areas and their stripe colors consistent.
At 100%, stripe interiors match their contributor's exact RGB color. Color
blending mode composites each face's ordered contributors using that intensity,
then draws the resulting color and opacity once. Both modes share one slider in the
collapsible Map settings panel. Map zoom fades
remain disabled: MapLibre otherwise cross-fades between differently scaled
copies of the stripe pattern, introducing mixed category colors during zooming.
Texture filtering and outer boundary antialiasing soften narrow edges.
Patterns use one texture pixel per logical pixel and compact power-of-two repeats.
Solids allocate no images.
Diagonal rows reuse one cyclic color band rather than computing every pixel separately.

Hover/click query only the active solid, stripe, and clipped fallback layers.
Shared faces carry a JSON-encoded `variantIds` MVT property; single faces carry
`variantId`. Inspection uses those memberships rather than stripe colors or image
names, including when retained coverage uses a different detail level. Holes in
coverage never fall back to hidden original polygons. Before coverage is available,
in blending mode, or after an error restores original fills, inspection uses the
original selected-language layer.
Fallback inspection retains all source contributors, although its source-order
solid colors may hide some of them. Pinned outlines still use source geometry.
Changes to period, source, or per-language override naturally change the variant IDs sent to the
worker. Query-defined areas could later feed the same rendering layer with
different IDs and colors.

## Responsiveness and limits

- Requests are debounced by 120 ms after navigation; unchanged tile sets skip
  requests. Retain recently visited tiles at the current integer zoom, up to 48,
  prioritizing the viewport. Returning inside that coverage needs no source update.
  The main thread retains encoded tiles and tells the worker which ones are
  already present. Extending coverage computes/transfers only additions; forced
  benchmark republishing still exercises worker caches. Zoom changes request a
  single new detail level, without mixing overlapping tile resolutions. Reversing
  a zoom reuses native tiles from the still-visible snapshot. If the requested
  tile references already match that snapshot, completion updates its status
  without replacing sources or images. Refreshes do not dispatch during camera movement.
- Two vector sources buffer immutable coverage snapshots served through the
  `language-overlap` protocol. Each snapshot references retained encoded tiles
  without copying geometry. At native zoom the coverage layer uses existing bytes;
  during zoom-out retention it transforms/combines descendant MVTs into requested
  parent tiles. Every response also includes its complementary original-language
  fallback layer. The protocol waits for both, then concatenates their distinct
  protobuf layer fields without decoding/re-encoding them. Cancellation or failure
  cancels the sibling operation. Both layers therefore use the same loaded tile,
  resolution, retention decisions, and stencil footprint. The source maxzoom matches computation zoom, so MapLibre handles
  zoom-in overzooming. A lazy delivery worker assembles parents, with a 48-entry/
  8 MiB LRU payload cache keyed by the relevant descendant identities. Only new
  encoded tiles are copied into that worker across snapshots; release drops
  unused native references. Native and empty requests do not start that worker.
- `tileRetention.ts` retains the nearest loaded descendant in **each branch** of
  a pending parent tile. MapLibre 6.14.0's default retains only the nearest loaded
  generation across all branches and discards children more than three levels
  deeper. Both behaviors can temporarily drop visible square areas. A Vite
  transform in `build/maplibreTileRetention.ts` intercepts only atlas overlap
  sources; all other sources keep upstream behavior. MapLibre is pinned to
  6.14.0, and builds reject version/method changes until this workaround is reviewed.
  Development dependency optimization excludes MapLibre so the same correction
  runs in development and production. Loaded covering ancestors replace only
  their own branches, avoiding duplicate opacity. Mixed generations can fully
  cover a parent; incomplete branches still seek loaded ancestors. This retains
  existing loaded tiles, without another geometry cache, worker, or fill underneath.
- Completed tiles accumulate during a 250 ms initial grace period; completion
  flushes immediately, so fast requests publish once. Initial loads and same-detail
  extensions publish progressively, batching arrivals for 32 ms and coalescing results while a
  staging source loads. Old coverage remains visible. Each buffer has one source
  containing both coverage and its matching clipped fallback; opacity switches
  only when that source is ready, after the camera stops moving. When changing
  detail with existing coverage, the full requested partition must complete before
  staging a replacement. This avoids switching previously striped areas back to
  solid fallback between tile arrivals. A failed new-detail prefix stays available
  for Retry while the old detail remains visible. This deliberately delays new
  detail until the whole request succeeds; newly exposed areas can still use solid
  fallback outside retained coverage. The protocol URL includes snapshot identity. Source errors are
  matched to that identity: MapLibre's loaded flag alone also accepts errored tiles.
  Failed staging is discarded while the previous valid buffer remains visible.
  A streaming error in an active source restores original fills, avoiding holes
  behind its clipped fallback mask. The visible status offers Retry, which reuses
  completed tiles and computes only unfinished additions. Exactly one buffer contributes color. Superseded/inactive
  snapshots are retired first, then their data and images are released only after
  React has detached the actual source or changed its URL. This prevents source
  requests from observing released data during the publication/React commit gap.
  MapLibre still prepares visible tiles in each new
  snapshot buffer; this is not selective in-place GPU tile replacement.
- Each result records all computed tile interiors, including empty tiles.
  The fallback worker streams original vector geometry outside those interiors
  as the camera moves, independently of overlap calculation, but its bytes are
  delivered atomically with coverage through `language-overlap`. Both layers now
  share the computation zoom; solid fallback is temporarily coarser while an old
  snapshot remains visible during a zoom-in. Whole
  uncovered tiles pass through; whole covered tiles return empty. For boundary
  tiles, a separate worker uses GEOS to clip each feature against the uncovered
  tile area and `@maplibre/vt-pbf` to encode the result. No language-to-language
  overlay is needed. Bounds tests discard features wholly covered by one mask
  rectangle, and preserve original MVT rings for features wholly outside the mask
  and inside the tile. Boundary features, including tile buffers, still use GEOS.
  Source order, IDs, colors, holes, and selection properties are preserved.
  A 48-entry/16 MiB raw-byte LRU avoids repeated archive reads, and a separate
  96-entry/16 MiB LRU caches clipped bytes by archive, tile, and sorted local mask.
  Changes outside that tile do not invalidate it; a changed local mask still clips.
  Covered tiles require neither a fetch nor a cache entry.
  Fallback colors never draw underneath retained stripes. Overlaps in fallback
  areas use ordinary solid fills in source order until stripes become available;
  these areas do not yet communicate every contributor. Normal tile loading can
  still delay appearance, but an overlap budget/pattern failure cannot stop it.
- Selection/mode changes immediately clear coverage and invalidate pending results.
  Superseded responses cannot publish. The worker yields between tiles and abandons
  superseded work. Archive fetches receive an abort signal. `OverlapWorkerClient`
  gives superseded work 150 ms to acknowledge cancellation or start the replacement;
  otherwise it terminates the blocked worker and dispatches only the latest request
  to a fresh worker. Responsive cancellation preserves caches. Computation has an
  8-second dispatch deadline, including fetch/initialization; final display has a
  12-second deadline including staging. Both report explicit errors and preserve
  available coverage. These UI-thread watchdogs are subject to browser timer
  scheduling/throttling; an individual WASM call itself is still synchronous.
  Opacity changes require neither computation nor source updates.
- Fallback tile requests have an 8-second UI-thread watchdog. Aborted requests
  reject immediately; their worker acknowledges cancellation within a 150 ms grace
  period or is terminated. Cancellation restarts replay only live requests within
  their original deadlines, so obsolete tiles cannot fail unrelated visible tiles.
  Deadline/initialization failures reject outstanding work; the next request starts
  a fresh worker. Responsive cancellation preserves caches.
  Cancellation during lazy initialization is checked before entering native clipping.
  Publication deadlines also remain armed for valid prefixes after computation fails.
- At most 48 decoded tiles and 16 MiB of decompressed tile bytes are cached.
  Native-result caching is bounded by 48 entries and 150,000 coordinate positions.
  Encoded cache entries share those lifetimes through weak keys. The receiver
  retains at most 48 desired tiles/200,000 positions plus active/staging snapshot
  references; old snapshots can retain different encoded tiles during transitions.
  These are not total browser/WASM/GPU memory limits.
  These are LRU caches; the byte limit does not include decoded object overhead.
  Cached feature metadata adds JS object overhead. Archive URL and source layer
  are part of cache identity, along with tile coordinates and local selection.
- A tile accepts at most 100,000 selected input vertices, 12,000 intermediate
  regions, and approximately 1.5 seconds of overlay work. A complete result is
  limited to 200,000 vertices. Deadline checks occur between Boolean operations;
  a single operation cannot be interrupted.
- Pattern allocation is limited by padded image area instead of a 128-combination
  cap: at most 4,194,304 texels per result (16 MiB RGBA), and twice that across
  owned images while buffers coexist. This includes MapLibre's one-pixel wrap
  padding, but not atlas packing waste, per-tile atlas copies, JS metadata, or
  GPU overhead. It is not a total memory bound. Images are capped at 256×256
  pixels (still up to 42 contributors at the same displayed spacing).
  Unused images are removed after vector sources have updated.
- A limit or computation failure retains the last valid coverage for the same
  selection; solid fallback colors continue outside it. Before any coverage is
  available, ordinary language fills remain active. Successfully completed tile
  prefixes may publish on initial loads and same-detail extensions even if a later
  tile fails; cross-detail prefixes cannot replace existing coverage. A failed tile never enters the
  coverage mask. The 200,000-position bound is also checked against retained plus
  newly delivered tiles on the main thread.

This is display geometry. Tile simplification can remove small overlap regions,
especially when zoomed out. Computation zoom reduction can differ from the base
layer's detail level. Canonical geometry is clipped to tile interiors to avoid
duplicate coverage. Render payloads extend only tile-cut edges into a 1/128-tile
buffer, matching MapLibre's globe stencil border. Globe tessellation and stencil
edges can otherwise differ enough to expose background pixels. The buffer joins
the original polygon ring, keeping coastlines and interior geometry unchanged;
it is not a general polygon inflation. Native tiles retain both canonical and
render encodings. Parents assemble canonical bytes before adding their own outer
buffer, so child buffers never become overlapping interior geometry. Clipped
fallback uses the same buffer; uncovered archive tiles keep their original buffer.
Both encodings are included in snapshot/delivery byte diagnostics.
The standard fill renderer supports both globe and Mercator projection. Stripe
spacing follows MapLibre's map-anchored pattern scaling, rather than staying at
a fixed screen width throughout zooming.

## Update ownership

- `controller.ts` owns selection invalidation, retained tiles, worker responses,
  computation phases, batching/deadlines, and active/staging publications. Its
  resource and worker ports let lifecycle tests run without React or a real map.
- `mapResources.ts` owns snapshot registration, pattern lifetimes, layer ordering,
  and source readiness/error identity. Released or unrelated sources cannot fail
  a current publication. Fallback cache identity remains the local mask, even
  though source URLs include a distinct snapshot revision.
  It restores owned stripe images on `styleimagemissing` after full style replacement,
  reusing validated memberships and colors without recomputing geometry.
- `OverlapHatching.tsx` connects application state and map events to the controller
  and declares the solid, stripe, and fallback layers. Loading/error feedback and
  Retry are visible on the map, independently of the settings panel.
- `testing/` isolates browser fixture configuration, the test bridge, and synthetic
  globe seam probes. React loads the controls only with `?overlap-test`; ordinary
  navigation does not download the bridge or its fixture code. `diagnostics.ts`
  keeps the small, flag-gated runtime metrics and fault-injection hooks used by
  the controller and tile protocols. Britain remains a browser regression fixture.


## Geometry engine and ownership

`geometry.ts` defines engine-independent coordinate, membership, and partition
contracts. `loadCoveragePartition()` lazily imports `geos.ts` and shares one
initialization promise. Failed initialization clears the shared promise so the
next request can retry; fallback initialization follows the same policy. Both
worker clients also discard workers reporting initialization failure, so Retry
gets a fresh browser module registry even after a failed module evaluation.
The Vite worker uses ES modules so the production build
preserves a separate GEOS chunk. The first partition's 1.5-second deadline starts
after initialization, and superseded requests are checked again after that await.

The adapter uses default robust overlay, without an application precision grid.
Native GEOS GeoJSON readers import each source fragment; geometry stays in WASM
through union, clipping, intersection, and difference. Borrowed polygon components
are cloned when inserted into RBush. Every operation normalizes its result to
polygonal area, discarding boundary-only lines/points. Final polygons are exported
once with the native writer. Caches and worker messages contain plain JS arrays,
never native pointers.

Source rings must be finite and closed, and each input must pass `GEOSisValid`.
Invalid source geometry fails the entire request; there is no silent `MakeValid`
or rounding policy. The error callback records failures and lets C++ return
normally before JS checks NULL/status. A per-partition scope releases native
geometry, readers/writers, coordinate-string buffers, and bounds scratch memory
on success or failure. Worker termination releases the module/context. Existing
cache limits and tile budgets remain in place.

## Checks

`npm run test:browser` runs the production app in installed Firefox and records
cold/warm measurements, screenshots, explicit limit outcomes, zoom-out retention,
pan/return reuse, selection clearing, resource counters, and superseding dense work with a smaller selection. It also samples solid framebuffer pixels in globe/Mercator views and injects coverage/fallback protocol failures to verify retention and Retry. See [browser harness usage](../../../../tests/browser/README.md)
for setup, scenario definitions, and timing semantics. Real pointer clicks check
single/shared/empty inspection. Full style replacement checks image restoration,
source identity, and geometry reuse. Frames during that explicit reload are
counted separately from ordinary navigation because the entire style is rebuilt.
Britain-small and Britain-all also track a stable English/Welsh overlap every
render during large zooms, interrupted/reversed zooms, and nearby pans in globe
and Mercator views. The probe requires shared coverage and a varied 8×8 framebuffer
patch throughout; it can catch regional stripe loss even while a layer stays enabled.
These focused spatial checks do not establish seamless rendering at every boundary.

`npm test` covers three-way memberships and disjointness, holes, touching edges,
duplicate fragments, tile clipping, geometry budgets, date-line tile selection,
stripe colors, native solid delivery, and cancellation. Controller regressions cover atomic-source readiness, coalescing, stale responses, selection/mode changes, failures, Retry, deadlines, budgets, and cleanup. GEOS regressions require valid, disjoint
coverage and complete memberships for both captured topology failures, handle
mixed polygon/line/point results and invalid inputs, and check native ownership
on success, failure, and budget rejection. The optional dense archive regression
requires success or an explicit documented budget error; topology errors fail.
If `public/data/language-areas.pmtiles` exists, it also computes real English/Welsh overlaps and verifies that removing
the other languages removes shared regions while retaining English-only coverage.
Fallback tests check safe bounds shortcuts, source order, local-mask cache invalidation, masks across detail levels, untouched/covered tile fast
paths, clipping, holes, IDs/properties, and adjacent masks across repeated requests.

Opt-in browser snapshots expose `tileServices`: cumulative parent assembly and
fallback decode/initialize/overlay/encode counters, cache payload bytes/entries, and current receiver
snapshot references. Partition reports include decoded cache bytes/entries,
indexed feature count, and retained partition positions. These are payload and
ownership diagnostics, not total JS, WASM, or GPU memory measurements.
