# Browser overlap checks and measurements

Run from `app/`:

```sh
npm run test:browser
npm run test:browser -- --scenario britain-small
npm run test:browser -- --runs 3 --output test-results/baseline
npm run test:browser -- --headed --hardware
```

Requires Python **3.11+**, Firefox, and geckodriver on `PATH`, existing npm
dependencies, and generated atlas data under `public/data/`. The runner uses
Python's standard library and geckodriver's W3C WebDriver API. It installs and
downloads nothing. Firefox/geckodriver setup is described in
[Mozilla's documentation](https://firefox-source-docs.mozilla.org/testing/geckodriver/Usage.html).

Each invocation builds the production app, starts a local Vite preview and
geckodriver on available ports, opens a temporary Firefox profile, and cleans up
its browser and servers on exit. `--skip-build` reuses `dist/`; use it only when
that build matches the code you want to measure. No existing dev server is used.
Linux process groups are used for preview cleanup.

Results overwrite the matching files in ignored `test-results/overlap/` by
default: `report.json`, cold/warm screenshots, failure screenshots, and server
logs. Choose separate `--output` directories to preserve comparable runs. A run
currently produces a few MB, with no video, trace, or downloaded browser cache.
Repeated runs with distinct output directories accumulate artifacts; delete old
ones as needed. At least 1 GiB of free space is required before running.

## Scenarios and outcomes

`scenarios.json` defines Britain, a dense African region, and a world view, with
small selections and all Asher contemporary languages. Selections, camera, and
window size are explicit. Each view runs twice:

- **Cold:** fresh document and overlap worker. WASM initialization and application
  caches are cold; HTTP, browser-process, and OS caches may already be warm.
- **Warm:** force computation/publication of the same view with the persistent
  worker and its caches. This intentionally bypasses the normal unchanged-view
  optimization so result publication is measured too.

Britain with the small selection and both dense all-language regional/world views
must successfully render shared-area stripes (including cold and warm passes).
Other scenarios report `stripes`, `solid-coverage` (no shared patterns), or
`unsupported` with a specific geometry/pattern limit. An unsupported view is
**not a successful stripe-rendering measurement**. Unexpected geometry/render
failures, JS/map errors, missing coverage buffers, and timeouts fail the command.
Performance timings are observations, without machine-dependent pass thresholds.

Both Britain selections pan to new same-zoom tiles, verify only additions arrive
and coverage uses vector sources, then return without another request. They also
animate a zoom-out and clear the selection. If the
zoom-out reaches a limit, retained stripes and loaded solid fallback outside
their coverage must remain available. Per-render checks detect frames with all
language coverage layers disabled. These checks are structural; they are not
pixel-level proofs of seamless coverage or correct stripe colors. Screenshots
remain available for visual inspection. The all-language Britain case also starts
world computation and supersedes it with the four-language Britain selection;
active source memberships must match the new selection. Each result checks cache
limits and at most two receiver snapshots; clearing must release receiver snapshots.
Failure injection and pixel-level spatial coverage checks remain future cases.

The terrain basemap is disabled by default to avoid external network variability.
`--terrain` includes it for an end-to-end check; failures to load it are reported
as map errors. Globe is the default projection. `--hardware` lets Firefox choose
the rendering backend rather than requesting software rendering. The report
records this request separately from the browser-reported renderer, which
Firefox may normalize for privacy. On Linux/Mesa the default
also sets [`LIBGL_ALWAYS_SOFTWARE=true`](https://docs.mesa3d.org/envvars.html#libgl-environment-variables)
in Firefox's environment; the software preference alone only controls Firefox's
compositor, not necessarily its WebGL contexts. Headless software results
measure the pipeline, not GPU performance on another device.

## Measurements

`report.json` records browser/OS capabilities, CPU count, renderer, viewport,
projection, dataset hash, built JS hashes, git revision/dirty status, scenarios,
console warnings/errors, map errors, and request reports. Request timings are in
milliseconds:

- `metrics.fetchMs`: awaited PMTiles retrieval, including its own caches.
- `metrics.decodeMs`: tile construction, cached feature-index construction/lookups, and selected
  coordinate decoding. Delivery-cache hits avoid coordinate decoding.
- `metrics.initializeMs`: loading/initializing the partition module.
- `metrics.partitionMs`: GEOS partitioning, including failed operations.
- `metrics.outputMs`: native feature grouping and MVT encoding. Encoded-cache hits
  reuse tile buffers; no longitude/latitude conversion or GeoJSON tiling occurs.
- `workerMs`: overall worker duration, including yields and work outside those
  stages. Cache hit counts, decoded input vertices, output vertices, and completed
  tiles (including empty ones) accompany it. Input vertices count decoding work;
  output vertices count newly delivered positions, including worker cache hits but
  excluding receiver-retained tiles. Neither is a cache memory estimate.
- `dispatchToResponseMs`: main-thread dispatch to the final completion/error message.
  Tile messages arrive earlier; this is no longer the time to first geometry.
  `responseOverheadMs` subtracts worker duration; it includes message scheduling
  and serialization, and is not a pure transfer measurement.
- `patternsMs`: cumulative pattern lookup, generation, and registration across batches.
- `patternPixels`: distinct padded image texels required by the result; multiply
  by four for RGBA bytes. This excludes per-tile atlas copies and packing overhead.
- `coverageSourceMs` and `fallbackSourceMs`: first observed readiness of each
  matching staging source, measured from that snapshot's creation.
  `sourceReadyMs` sums paired-source preparation elapsed time across publications.
  It overlaps worker computation and includes React scheduling, MapLibre preparation,
  and fallback fetch/clip work; do not add it to worker time to predict total time.
- `firstCoverageMs`: dispatch until the first partial snapshot passes source readiness.
  `firstCoverageRenderMs` observes a render with its coverage buffer enabled.
  These snapshots include solid fallback for unfinished areas; they do not imply
  that every visible language or geographic location has stripes yet.
- `publications`: snapshot swaps in this request. `deliveredTiles`: tile messages
  received; normal pans exclude receiver-retained tiles.
- `workerRestarts`: cumulative cancellation/deadline restarts in this component.
- `metrics.cache`: decoded bytes/entries and indexed feature count, plus native
  partition entries/coordinate positions. Byte counts exclude JS object overhead.
- `tileServices.receiver`: current snapshot count, unique encoded tile count/bytes,
  and peak encoded bytes across registered snapshots. Clearing releases references.
- `tileServices.delivery`: cumulative parent requests/cache hits/assembly time and
  current worker native bytes, parent cache bytes/entries, snapshots, and tile count.
  Native/empty requests stay on the main thread; parent assembly uses a lazy worker.
- `tileServices.fallback`: cumulative requests, clipped-cache hits, raw-cache hits,
  fetch time, clip time (including initial GEOS loading), and raw/result cache
  payload bytes/entries. Feature counts distinguish covered, untouched, and GEOS
  candidates; `decodeMs`, `initializeMs`, `overlayMs`, and `encodeMs` split the
  uncached clipping path. Overlay includes native import/Boolean/export together.
  Safe bounds shortcuts preserve original source order and tile-buffer clipping.
  Counters span requests within the page; take differences
  between snapshots for a phase. Awaited stages can overlap across tile requests,
  so their sums are not end-to-end latency or pure CPU time.
- `totalMs`: dispatch until publication readiness, or an explicit failure.
  `firstRenderMs`: dispatch until a render event with the final buffer enabled.
  Neither includes the 120 ms navigation debounce nor proves GPU completion.

Raw render-event intervals include idle gaps and must **not** be interpreted as
FPS. This harness does not yet measure total browser/WASM/GPU memory or
attribute time inside MapLibre tile preparation, GPU drawing, or individual fallback Boolean operations. Use repeated runs on the same machine and
backend to evaluate changes; a single timing is not a performance guarantee.

## Explicit test interface

Only visits with `?overlap-test=1` expose `window.overlapTest`. The runner also
sets `&overlap-basemap=off` unless `--terrain` is requested. Normal visits expose
no test controls and collect no request reports or browser observers.

The interface provides `configure({languageIds, center, zoom})`,
`camera(center, zoom, duration?)`, `recompute()`, `unexpectedMemberships()`, and `snapshot()`. Selection uses
the application's state setters, and map observations use public MapLibre APIs.
No React internals or worker monkey-patching is involved. History is bounded to
100 request reports, 200 console messages, and 600 render intervals per document.
