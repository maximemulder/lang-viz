# Dataset palette precomputation experiment (2026-11-09)

Precomputation removes the expensive runtime search. The remaining problem is
choosing a single palette that works across scales. This experiment generates
actual dataset artifacts and renders them in the app, without changing defaults.
The coarse geometry palette and simple regional patch are not recommended.

**Integration update:** geometry-64 is now the app default for compatible pinned
single-dataset/period views. `npm run precompute:colors` builds all profiles without
these experimental captures; `src/domain/datasetMetadata.ts` validates the compact palettes embedded in initial
dataset metadata, loaded by `src/data/atlasRepository.ts`. See `src/domain/COLORS.md` for
fallback, override and undo behavior. The measurements and recommendations below
record the original experiment; the original “do not silently replace” recommendation
has been superseded by the user's explicit request to integrate this candidate.

## Reproduce

From `app/`, using the saved color captures and prepared branch-coverage tiles:

```sh
node scripts/color-precomputation/run.mjs --output test-results/color-precomputation-multiview
python3 scripts/color-precomputation/render.py test-results/color-precomputation-multiview
python3 scripts/color-precomputation/evaluate.py test-results/color-precomputation-multiview
```

Open `test-results/color-precomputation-multiview/review.html` for matched app
screenshots. The browser renderer needs the usual local browser/server setup.
`benchmark.json` records input hashes, algorithm/catalog hashes, coverage bytes,
preparation timings, artifact sizes, and parse timings. `evaluation.json` contains
independent exhaustive local comparisons and topology-based family measurements.
Outputs live in ignored test-results; the scripts and this report are tracked.

The generator requires `test-results/color-integrated/*-input.json` by default
(`--input` overrides it). The captured references supply the stable palette and
full topology. It verifies the catalog's parent topology and records the catalog
fingerprint. This is an experiment harness, not yet a standalone production build
pipeline or a runtime artifact loader.

## Candidates

- **default**: current stable app defaults.
- **live**: current successful optimizer, separately solved for each captured view.
- **captured-world**: reuse the Asher world-view palette in every Asher camera.
  DLAC uses its existing regional capture, so that result is intentionally identical
  to live; it is not an independent test of generalization.
- **geometry-32 / geometry-64**: rasterize the entire dataset's already prepared
  branch coverage into a 32×32 or 64×64 Mercator grid, trim empty margins, then run
  the unmodified app optimizer offline. Prepared coverage preserves the app's
  ancestry subtraction and overlap memberships. Rasterization tests polygon/cell
  intersections, including holes, narrow pieces and sub-cell islands, rather than
  filling polygon bounding rectangles. The resulting palette includes all catalog
  languoids: complete optimized families plus stable defaults for unaffected roots.
- **multi-view**: start with geometry-64, optimize the captured regional view with
  family anchors locked, and patch only its visible languages into the global
  table. This tests a cheap stitching strategy; it is not a joint multi-view solve.
  It slightly worsened Asher detail and should not be adopted.

All prepared candidates remain constant during navigation. Europe and Africa are
held-out camera views: neither participates in preparation. Their `live` images
reuse the world solve; `live-local` assets are separate fresh local solves saved
for evaluation. The comparison page also offers `live-local` for those held-out views.
Screenshots apply the generated tables through the app's existing exact-color
interface, asserting assigned colors and unchanged coverage/entry identities.
This exercises rendering, not a production prepared-palette loader.

## Performance and coverage

Full artifacts are about 580 KB JSON / 166–194 KB gzip. Median parse plus Map
construction is around 15–23 ms over 21 repetitions, versus several seconds of
runtime optimization. This is **not end-to-end latency**: network, decompression,
state updates and rendering are excluded. Offline Asher optimization took roughly
6–7 seconds per geometry candidate in the initial run; rasterization took about
0.1 seconds. A regional patch costs another roughly 2 seconds offline.

The 64-grid yields 64×42 occupied cells for Asher and 11×9 for DLAC. DLAC has 20
sampled languages; Asher has 5,116, versus 4,821 representations in the saved world
capture. Asher's 5,302 selected languages include **186 absent from the zoom-3
prepared geometry**. They still receive colors through their family/default
palette, but their geography does not influence the solve. `unsampledLanguages`
records them explicitly. Better-resolution geometry is needed before claiming
complete geographic coverage. The 32-grid is too coarse for this dense dataset.

## Quality results

Independent within-family neighbor shortfall (lower is better; engineering proxy,
not a human readability score):

| Palette | DLAC | Regional Asher | World Asher |
| --- | ---: | ---: | ---: |
| Default | .711 | .697 | .560 |
| Live per view | .010 | .199 | .251 |
| Captured world | .010 | .267 | .251 |
| Geometry 32 | .006 | .492 | .414 |
| Geometry 64 | .012 | .327 | .194 |
| Regional patch | .010 | .345 | .197 |

Geometry-64 improves world internal contrast over the world live solve, while
regional severe-pair weight rises from **24.1% live to 46.2%** (captured-world:
33.3%). World severe-pair weight falls from 28.4% to 22.4%. Cross-family contact
shortfall also improves at world scale (.0414 → .0306). These are different
tradeoffs, not evidence that one palette is universally better.

Vividness also depends on viewing scale. Dominant-language mean chroma in the
regional view is .125 live, .147 captured-world, and .154 geometry-64; at world
scale it is .136 live and .132 geometry-64. The preparation objective sees global
prominence, so a language that becomes dominant on zoom-in may be too vivid there.
Visual inspection confirms that the geometry palette is brighter in regional
Asia. Distance from the old preferred swatches remains a legacy diagnostic only;
it is not used here as the aesthetic decision criterion.

Held-out within-family shortfall confirms the finer geometry palette generalizes
better than just caching the captured world solve:

| Palette | Europe | Africa |
| --- | ---: | ---: |
| Default | .511 | .539 |
| Captured world | .314 | .293 |
| Geometry 32 | .287 | .395 |
| Geometry 64 | .196 | .199 |
| Regional patch | .395 | .203 |
| Fresh local solve | .043 | .130 |

The Asia patch damages European contrast (.196 → .395) because the same languages
appear in multiple views. Geometry-64 retains visible differences among European
languages, but a focused solve has far more freedom to separate them. In Africa,
fresh local dominant chroma is .102 versus .154 for geometry-64: local aesthetics
also remain a meaningful benefit of on-demand optimization.

## Recommendation

Precomputed palettes are a plausible fast default, with explicit live optimization
retained for comparisons and tailored views. The finer geometry candidate is much
better than current stable defaults, but it does not fully retain the regional
quality of the successful live optimizer. Do not silently replace defaults with
this experiment or ship the regional patch.

The next algorithm experiment should build **one geographically stable, multi-scale
objective**: preserve a world-level family layout, measure local neighbors using
finer regional geometry, and constrain prominence/chroma using both global and
regional area. Optimize the shared palette against those views together. Sequential
patches provide no protection for previously optimized regions or branch averages;
the negative patch result is a reason to use joint scoring, not add more patches.

Production integration would need build-time reference generation, versioned
artifacts keyed by dataset/period + geometry/catalog + color-policy fingerprints,
a tested loader, and fallback to the existing optimizer for missing/incompatible
assets, cross-dataset comparisons and custom roots/anchors. Prepared palette tables
must never be merged across datasets as though their family assignments agree.
Exact user overrides must continue to win. A stable table should not automatically
switch when the camera moves.

## Validation

175 app tests pass, including a new rasterization check for holes, tiny islands,
thin crossings, tile/grid boundary contacts and out-of-grid polygons. The browser
comparison rendered every candidate in five cameras and captured independent
Europe/Africa local solves, with assignment/geometry invariants checked. Production
optimizer code, thresholds and default behavior are unchanged.
