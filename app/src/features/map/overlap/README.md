# Browser overlap hatching

`OverlapHatching` receives the resolved geometry variants already selected by
`WorldMap`. Geometry definition, source/period selection, and stripe rendering
remain separate. No overlap combinations are precomputed offline.

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
   Encoding normalizes shell/hole winding and quantizes the display coordinates;
   GEOS itself still uses its original robust floating-point overlay. Cache encoded
   tiles weakly against their native feature arrays. Only tiles absent from the
   browser's retained set cross the worker boundary. No full GeoJSON collection
   is transferred or re-tiled by MapLibre. `compute()` remains a GeoJSON adapter
   for geometry tests; the browser uses the incremental `computeTiles()` stream.
5. Register an opaque, power-of-two pattern for each encountered membership:
   a solid image for a single language, alternating stripes for shared regions.
   Every contributor receives an equal band; patterns align across computation
   tiles. MapLibre draws coverage from native vector tiles in one active
   `fill-pattern` layer, then applies
   `fill-layer-opacity` once to the result. Once that source has loaded, the
   original language fills are suppressed; original geometry remains available
   for picking and pinned outlines remain above coverage.

Color strength defaults to 82%, adjustable between 40% and 100% without geometry
recomputation. Each region blends with the basemap, never with another language
fill underneath. This keeps solid areas and their stripe colors consistent.
At 100%, stripe interiors match their contributor's exact RGB color. Color
blending mode retains its original 0.58 per-feature opacity. Map zoom fades
remain disabled: MapLibre otherwise cross-fades between differently scaled
copies of the stripe pattern, introducing mixed category colors during zooming.
Texture filtering and outer boundary antialiasing soften narrow edges.
Patterns use one texture pixel per logical pixel, preserving the previous displayed
period at one quarter of its stripe image storage. Solids use a single opaque texel.
Diagonal rows reuse one cyclic color band rather than computing every pixel separately.

Hover/click continue to query the original selected-language layer, rather than
trying to reconstruct identities from a visible stripe pixel. Changes to period,
source, or per-language override naturally change the variant IDs sent to the
worker. Query-defined areas could later feed the same rendering layer with
different IDs and colors.

## Responsiveness and limits

- Requests are debounced by 120 ms after navigation; unchanged tile sets skip
  requests. Retain recently visited tiles at the current integer zoom, up to 48,
  prioritizing the viewport. Returning inside that coverage needs no source update.
  The main thread retains encoded tiles and tells the worker which ones are
  already present. Extending coverage computes/transfers only additions; forced
  benchmark republishing still exercises worker caches. Zoom changes request a
  single new detail level, without mixing overlapping tile resolutions.
- Two vector sources buffer immutable coverage snapshots served through the
  `language-overlap` protocol. Each snapshot references retained encoded tiles
  without copying geometry. At native zoom the protocol serves existing bytes;
  during zoom-out retention it transforms/combines descendant MVTs into requested
  parent tiles. The source maxzoom matches computation zoom, so MapLibre handles
  zoom-in overzooming. Parent assembly currently runs on the main thread.
- Completed tiles accumulate during a 250 ms initial grace period; completion
  flushes immediately, so fast requests publish once. Longer requests publish
  progressively, batching arrivals for 32 ms and coalescing results while a
  staging source loads. Old coverage remains visible. Each buffer has its own
  fallback source and matching tile mask; only when both sources are ready does
  opacity switch. Exactly one buffer contributes color. Superseded/inactive
  snapshots are released. MapLibre still prepares visible tiles in each new
  snapshot buffer; this is not selective in-place GPU tile replacement.
- Each result records all computed tile interiors, including empty tiles. A
  `language-fallback` protocol streams original vector tiles outside those
  interiors as the camera moves, independently of overlap calculation. Whole
  uncovered tiles pass through; whole covered tiles return empty. For boundary
  tiles, a separate worker uses GEOS to clip each feature against the uncovered
  tile area and `@maplibre/vt-pbf` to encode the result. No language-to-language
  overlay is needed. IDs, colors, holes, and selection properties are preserved.
  Fallback colors never draw underneath retained stripes. Overlaps in fallback
  areas use ordinary solid fills in source order until stripes become available;
  these areas do not yet communicate every contributor. Normal tile loading can
  still delay appearance, but an overlap budget/pattern failure cannot stop it.
- Selection/mode changes immediately clear coverage and invalidate pending results.
  Superseded responses cannot publish. The worker yields between tiles and abandons
  superseded work. Opacity changes require neither computation nor source updates.
- At most 48 decoded tiles and 16 MiB of decompressed tile bytes are cached.
  Native-result caching is bounded by 48 entries and 150,000 coordinate positions.
  Encoded cache entries share those lifetimes through weak keys. The receiver
  retains at most 48 desired tiles/200,000 positions plus active/staging snapshot
  references; old snapshots can retain different encoded tiles during transitions.
  These are not total browser/WASM/GPU memory limits.
  These are FIFO caches; the byte limit does not include decoded object overhead.
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
  prefixes may publish even if a later tile fails; a failed tile never enters the
  coverage mask. The 200,000-position bound is also checked against retained plus
  newly delivered tiles on the main thread.

This is display geometry. Tile simplification can remove small overlap regions,
especially when zoomed out. Computation zoom reduction can differ from the base
layer's detail level. Geometry is clipped to tile interiors to avoid duplicate
coverage; precision differences in the source tiles can still leave tiny seams.
The standard fill renderer supports both globe and Mercator projection. Stripe
spacing follows MapLibre's map-anchored pattern scaling, rather than staying at
a fixed screen width throughout zooming.

## Geometry engine and ownership

`geometry.ts` defines engine-independent coordinate, membership, and partition
contracts. `loadCoveragePartition()` lazily imports `geos.ts` and shares one
initialization promise. The Vite worker uses ES modules so the production build
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
pan/return reuse, and selection clearing. See [browser harness usage](../../../../tests/browser/README.md)
for setup, scenario definitions, and timing semantics.

`npm test` covers three-way memberships and disjointness, holes, touching edges,
duplicate fragments, tile clipping, geometry budgets, date-line tile selection,
stripe color/opacity, and cancellation. GEOS regressions require valid, disjoint
coverage and complete memberships for both captured topology failures, handle
mixed polygon/line/point results and invalid inputs, and check native ownership
on success, failure, and budget rejection. The optional dense archive regression
requires success or an explicit documented budget error; topology errors fail.
If `public/data/language-areas.pmtiles` exists, it also computes real English/Welsh overlaps and verifies that removing
the other languages removes shared regions while retaining English-only coverage.
Fallback tests check masks across detail levels, untouched/covered tile fast
paths, clipping, holes, IDs/properties, and adjacent masks across repeated requests.
