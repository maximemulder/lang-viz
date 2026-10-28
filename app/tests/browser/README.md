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

Both Britain selections also animate a zoom-out and clear the selection. If the
zoom-out reaches a limit, retained stripes and loaded solid fallback outside
their coverage must remain available. Per-render checks detect frames with all
language coverage layers disabled. These checks are structural; they are not
pixel-level proofs of seamless coverage or correct stripe colors. Screenshots
remain available for visual inspection. Failure injection, rapid selection
supersession, and pixel-level spatial coverage checks remain future cases.

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
- `metrics.outputMs`: coordinate conversion, feature grouping, and collection assembly.
  Delivery-cache hits only assemble references; no coordinate conversion is repeated.
- `workerMs`: overall worker duration, including yields and work outside those
  stages. Cache hit counts, decoded input vertices, output vertices, and completed
  nonempty tiles accompany it. Input vertices count decoding work; output vertices count delivered positions,
  including cache hits. Neither is a cache memory estimate.
- `dispatchToResponseMs`: main-thread dispatch to response handling.
  `responseOverheadMs` subtracts worker duration; it includes message scheduling
  and serialization, and is not a pure transfer measurement.
- `patternsMs`: pattern lookup, generation, and registration on the main thread.
- `patternPixels`: distinct padded image texels required by the result; multiply
  by four for RGBA bytes. This excludes per-tile atlas copies and packing overhead.
- `coverageSourceMs` and `fallbackSourceMs`: first observed readiness of each
  matching staging source, measured after response handling/pattern creation.
  `sourceReadyMs` measures readiness of both sources together. These include
  React scheduling, MapLibre preparation, and fallback fetch/clip work; they are
  overlapping elapsed times, not additive CPU costs.
- `totalMs`: dispatch until publication readiness, or an explicit failure.
  `firstRenderMs`: dispatch until a render event with that buffer enabled.
  Neither includes the 120 ms navigation debounce nor proves GPU completion.

Raw render-event intervals include idle gaps and must **not** be interpreted as
FPS. This harness does not yet measure total browser/WASM/GPU memory or attribute
the fallback worker's internal stages. Use repeated runs on the same machine and
backend to evaluate changes; a single timing is not a performance guarantee.

## Explicit test interface

Only visits with `?overlap-test=1` expose `window.overlapTest`. The runner also
sets `&overlap-basemap=off` unless `--terrain` is requested. Normal visits expose
no test controls and collect no request reports or browser observers.

The interface provides `configure({languageIds, center, zoom})`,
`camera(center, zoom, duration?)`, `recompute()`, and `snapshot()`. Selection uses
the application's state setters, and map observations use public MapLibre APIs.
No React internals or worker monkey-patching is involved. History is bounded to
100 request reports, 200 console messages, and 600 render intervals per document.
