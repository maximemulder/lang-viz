# Languoid colors

`colors.ts` owns presentation colors independently of geometry, source availability,
time period, search, and camera. `GeometryVariant.color` remains a legacy categorical
seed in the generated catalog; rendering uses `languageColorsAtom` instead.
No data rebuild is required to change palettes.

The explicit view optimizer now uses the successful softer-anchor and multiscale
branch-reference experiment. `colorBranches.ts` refines visible automatic shades
using the local graph in `colorSpatial.ts`, preserving substantial branch contrasts
and family bounds. Anchor search offers lower-chroma candidates and penalizes
excess chroma according to prominence; the branch pass uses chroma weight 0.1.
Neither pass scores proximity to a preferred palette. Original swatches remain
candidate samples. The stable default palette retains its previous initialization
and preference cost, so this integration reproduces the experiment's starting point.

Use **Optimize colors for this view** to see the new behavior. It runs in the existing
worker and participates in the existing cancellation and undo flow. The first performance pass preserves the search and its output while sharing
shade projections, color conversions, and invariant scoring work. On three saved
captures, the regional/world optimizer medians fell from 4.79/10.20 seconds to
2.62/5.35 seconds (Node replay; browser latency differs). Caches require no dataset
preprocessing and also apply to cross-dataset views. Many small vivid regions can also create an
overly vivid family collectively; family-wide chroma restraint is a next experiment.

The [experiment report](../../scripts/color-branches/README.md) records historical
ablations. Its replay harness reconstructs the prior initializer and checks the
successful variant against the app optimizer. The broader geographic preprocessing
roadmap below remains unimplemented. Historical sections describe their original
state and are superseded by this integration where applicable.

## Testing controls

Open **Map settings → Language colors** to switch between semantic and categorical
coloring. Semantic mode offers **Optimize colors for this view**. It captures the
selected polygons currently on screen and computes a frozen palette in a worker.
**Undo colors** restores the previous palette; **Use default palette** removes view
optimizations without removing custom colors. Moving, resizing, or changing the
selection/configuration during computation cancels that computation. Navigation
after applying a palette never recolors anything automatically. A refresh of the
same view is deterministic. Refresh updates the complete palettes of the families
represented in the view, including their offscreen and unselected relatives.
Families absent from the captured view keep their previous palettes.

Expand **Custom colors and groups**, enter a languoid ID (selected entries
are suggested), and choose or type a color. **Set exact color** affects that entry;
**Set subtree color** seeds its semantic palette. Each has a remove action.
Comma-separated **Comparison root IDs** establish separate palettes after pressing
**Apply comparison roots**. **Reset color settings** restores defaults while keeping
the map selection and per-entry colors. Changes apply immediately and
last until the page is reloaded.

## Configuration API

`colorConfigurationAtom` in `state/atlasState.ts` accepts a complete serializable
`ColorConfiguration`. React controls can use `useSetAtom`; application code can use
the application's Jotai store. The current app uses the default store:

```ts
import { getDefaultStore } from 'jotai'
import { colorConfigurationAtom } from './state/atlasState'

getDefaultStore().set(colorConfigurationAtom, {
  strategy: 'semantic', // or 'categorical'
  rootIds: ['germ1287', 'roma1334', 'slav1255'],
  anchors: { germ1287: '#287cb8' },
  overrides: { stan1293: '#d64045' },
})
```

- `rootIds` starts independent comparison palettes at any classification level.
  Roots can be nested; the deepest explicit root owns a languoid's palette.
- `anchors` seeds a subtree's palette and implicitly establishes its root. The
  root itself uses that exact color; descendants vary around it.
- `overrides` sets exact colors for individual languoids, without inheritance.
  Overrides win in both strategies. Removing a key restores the automatic color.
- Opaque CSS colors are normalized to six-digit sRGB hex. Invalid/transparent
  colors throw before state changes. Out-of-gamut colors are mapped by reducing
  chroma in OKLCH. Opacity remains a separate map setting.
- Unknown IDs are retained in configuration but have no effect until present in
  the catalog. Configuration is in memory; persistence and import/export remain
  future work.

`semanticPaletteAtom` exposes the stable reference `colors`, `rootById`, and
`anchors`. Active optimized family anchors and bounds are in
`optimizedColorsAtom.regions`; `languageColorsAtom` exposes final colors after
optimization and exact overrides.

## Grouping and stability

Classification roots always establish world palettes, including isolates.
Selecting a family or displaying a mapped branch retains its genealogy's default
palette. Only explicit comparison roots/subtree anchors establish independent
palettes. Ordinary selections, including families, never redistribute colors.

`showBranchAtom` records its highest matched root on every pinned branch entry.
`branchColorRootsAtom` derives roots from surviving entries; replacing a family with its mapped branch therefore
preserves grouping provenance. This provenance is separate from palette assignment;
it no longer implicitly creates comparison palettes. Replacing a subtree within the same source/period
context updates its branch provenance; other comparison contexts and unrelated roots
remain. Removing the last entry carrying a root releases it. `clearMapSelectionAtom`
clears entries and their provenance, preserving explicit color configuration and
the frozen palette, so re-adding a languoid retains its color.
`visibleLanguageIdsAtom` is a read-only projection of unique selected languoids.

Searches, row expansion, panning, period/source filters, and individual language
selection do not redistribute palettes. Explicit changes to strategy, comparison roots or
anchors clear view optimizations and can reassign comparison palettes. Adding a comparison root preserves the
global root anchors and reserves its original interval, leaving unaffected sibling
colors in place. Exact overrides preserve the cached semantic palette.

## Family palettes and stable defaults

`familyColors.ts` assigns family regions; `colorHierarchy.ts` allocates genealogical
detail inside them. This is a practical adaptation of hierarchical subdivision,
inspired by [Tree Colors](https://doi.org/10.1109/TVCG.2014.2346277), rather than a
reproduction of that algorithm. [Culori](https://culorijs.org/api/) handles OKLab
conversion, sRGB gamut mapping, and hex quantization.

1. Prepare a deterministic forest in iterative passes. Break cyclic/orphaned
   classifications into finite trees; deep classifications never consume the call
   stack. Order siblings consistently. Unary paths consume no subdivision space.
2. Build stable neighborhoods from mapped catalog coordinates in 10-degree cells,
   including neighboring cells and date-line wrapping. Distributed descendants,
   rather than one family centroid, represent each family. Occupied cell counts
   provide a rough prominence estimate; missing coordinates provide no proximity.
3. Assign the prominent families first, then hold their anchors fixed while fitting
   the remaining families around them. Prominence depends on geographic footprint,
   independently of the number of descendants. Each neighboring family pair
   contributes once, with normalized incident weights. A separate global term
   separates prominent families even when geographically distant. Exact subtree
   anchors are fixed throughout the search.
4. Search a grid of 48 hues × four lightness levels × three chroma levels, retaining
   all 24 original anchors (two lightness levels, moderate chroma).
   Remove duplicate gamut-mapped RGB colors. These are candidates,
   not a fixed number of family identities. The objective combines chromatic
   separation, a smooth hue separation penalty, a strong penalty for severe
   shortfalls, the worst important conflict, a small movement penalty from
   deterministic reference colors, and an editorial preference based on the
   original palette.
   Preference cost is the squared perceptual distance to the nearest preferred
   anchor, weighted more strongly on large footprints. All 24 original anchors
   have zero cost, including the olive greens, roses and violets. Nearby
   shades cost little; more extreme colors remain available when needed for
   separation. Exact custom anchors stay fixed. Candidate preferences are cached
   alongside the existing movement costs; no additional search passes
   or changes to descendant shade allocation are required.
   Two initializations, repeated coordinate descent, and swaps between difficult
   pairs reduce dependence on an initial greedy assignment.
5. Both defaults and explicit view optimization use `familyColorSpaces` to allocate
   a compact perceptual region around each anchor. Occupied grid coverage and
   proximity determine the expansion budget. Separating planes share available
   margin between competing families; hue and chroma bounds preserve family identity.
   Defaults conservatively apply their coarse family-neighbor bounds throughout
   each family. A captured view can restrict local bounds to nearby languoids.
6. Both paths use `buildFamilyPalette` to choose available color directions,
   subdivide the hierarchy, gamut-map, quantize, and project actual RGB shades back
   into their region (rounding tolerance 0.0015). Broad splits can use lightness
   when hue is crowded. Defaults weight branches by square roots of mapped-leaf
   counts; a view supplies visible area weights. The root and undisplayed unary
   wrappers use the anchor. Very close relatives may quantize to one color.

Global anchors, radii, and subdivision slots are established before additional
comparison roots. A nested comparison root restarts its own palette while reserving
its original slot in the ancestor's allocation. Unaffected siblings retain their
colors. Categorical mode continues to use the first catalog color for a languoid,
with the legacy ID hash as an unmapped fallback. Exact overrides resolve last.

Default colors remain independent of camera, selected sources, period filters, and
ordinary selection. The optional fifth argument to `buildSemanticPalette` accepts
a `ColorNeighborhoodProvider`, allowing polygon-derived neighborhoods to replace
the coordinate approximation without changing the renderer.

## Explicit view optimization

`colorOptimization.ts` is a pure deterministic optimizer. The map runs it through
`colorOptimization.worker.ts`, keeping its search off the UI thread.

1. `captureColorView` queries the drawn solid, stripe, blended, and clipped-fallback
   layers in at most 36 × 24 screen cells. Box intersections preserve small islands
   that point sampling can miss. Source/period geometry, projection/globe clipping,
   grouped geometry, and ancestry refinements contribute their displayed footprint.
   The discovery layer and catalog point coordinates are excluded. No new geometry
   requests or partitions are performed.
2. Union footprints by family and compute grid distance fields. Proximity averages
   distance-based contact across each footprint, taking the larger of the two
   directions. This protects a small family beside a large territory while avoiding
   a strong relationship based only on one distant outpost. Distance decay scales
   with footprint size. Per-entry and exact languoid colors remain separate fixed
   obstacles, including differently colored representations of the same languoid.
3. Estimate prominence from occupied cells. A prominent family covers approximately
   1% of the grid and at least 4% of the largest footprint, with a minimum of 1.5
   cells. This is a heuristic, not an exact pixel-area measurement. Solve prominent
   family assignments first, then fit the smaller families. Local family-pair
   pressure and the global prominence term are normalized separately, so hundreds
   of tiny families cannot overwhelm the visible macrostructure.
4. Estimate subdivision demand from visible area per languoid, sharing each occupied
   family cell among its representations. Cap effective complexity at 16 before
   taking its square root. This keeps cardinality separate from prominence and
   prevents a large classification from claiming an arbitrarily large region.
   Request some extra anchor clearance for internal detail when the neighborhood
   permits it; singleton comparisons need no internal variation.
5. Allocate compact regions per family. Neighbor load combines spatial proximity
   and a weaker global contribution between prominent families, weighted by capped
   occupied area. The bounding radius is `0.06 + 0.16 / (1 + 0.4 * load)`: crowding
   consumes the expansion budget without forcing every dimension to zero. This is
   an upper bound, not a promise of usable space. Chromatic anchors also keep shades
   within 20 degrees of their hue and at least 55% of their radial chroma. Achromatic
   custom anchors have no hue constraint. Manual colors are exempt.
   Separating halfspaces share the remaining center-to-center margin according to
   capped subdivision demand. Prominent family palettes retain a global gap of up
   to 0.20, or 80% of center distance when closer. Tighter local bounds reserve the
   family-pair target (0.20 or 0.24), or 85% of center distance. Apply local bounds
   only to displayed languoids near that competitor's footprint, including fixed
   colors. A small neighbor therefore constrains nearby relatives without flattening
   distant branches. Nearly coincident prominent anchors also cap the whole region.
6. Sample 26 directions in the common family region, then orient a three-dimensional
   frame along the longest usable spans. Broad tree splits can use lightness or
   chroma when hue is crowded. Subdivide a visible induced hierarchy in that frame,
   weighting branches by visible area raised to 0.75. Sub-cell weights stay fractional;
   tiny branches cannot each claim a minimum whole-cell slot. Absent siblings reserve
   no slots, and unary paths pass through their allocation. A displayed ancestor and
   its displayed descendants receive separate slots; the family root keeps its
   anchor. Hidden siblings receive deterministic subdivisions inside their parent's
   region, so all relatives have coherent colors when subsequently revealed.
   Project shades perpendicular to any violated plane, preserving other components.
   Gamut-map, quantize, and recheck actual RGB bounds; contract toward the anchor if
   needed to resolve residual intersection or rounding errors.
7. Refine internal shades in two bounded passes, within both their hierarchy boxes
   and their common/local family bounds. Use sampled neighboring relatives with
   smaller targets for closer branches. An additional contrast target of 0.035–0.080
   depends on the visible area of their shared clade: deep classification wrappers
   cannot automatically erase a broad visible split. Feasibility bounds remain hard;
   contrast targets can be unmet. This step cannot widen the region or recolor exact
   overrides. Regions with a bounding radius below 0.025 skip refinement.
8. Freeze the complete affected family palettes. Every refresh references the stable
   defaults rather than a previous optimization, preventing repeated-refresh drift.
   Later navigation, filtering, or selection never writes the palette. A new
   optimization replaces complete palettes for its represented families and retains
   earlier palettes for absent families. One undo snapshot is kept.

Internal shade graphs retain tree neighbors and evenly spaced representatives in
dense cells, then the strongest relationships per representation. Root assignment
never sums thousands of individual descendant-pair losses. It operates on a much
smaller family graph. Candidate-risk tables are cached during each solve; hierarchy
traversals and screen-grid occupancy also bound the work. Explicit refresh can still
move colors considerably when the comparison changes.

## Diagnostics and limits

`OptimizedColors` exposes `regions` (anchor, radius, visible count), a complete color
map for the affected families, and separate `before`/`after` diagnostics:

- `localFamilyConflict`: contact-weighted separation shortages between family
  palettes, using up to 16 farthest-point representatives of actual displayed shades.
- `prominentFamilyConflict`: separation shortages among prominent displayed families.
- `worstFamilyConflict`: the largest importance-weighted family-pair shortfall.
- `familySpread`: area-weighted maximum automatic-shade distance from each anchor.
- `maxFamilySpread`: the largest such radius across all displayed families.
- `internalContrast`: area-weighted mean separation among sampled neighboring
  relatives, normalized within each family. Larger values indicate more detail.

Conflict diagnostics are squared normalized shortfalls; lower is better. They are
approximations, not percentages of human perceptual confusion. There is no combined
quality score: increased internal contrast can trade against family separation,
and not every diagnostic is guaranteed to improve.
No single improving score establishes that a map is easier to read.
Family-pair diagnostics compare their whole sampled palettes, even when two extreme
shades occur far apart. They remain conservative after local bounds are applied
selectively. Independent evaluation in `tests/browser/color_evaluation.py` uses
only serialized topology, captured footprints, and actual colors. It reports:

- Contact conflicts between shades occupying the same screen cell, averaging each
  family pair once. It records squared shortfalls below 0.16, severe pair counts
  below 0.025, and the worst pairs with their shared-cell counts. Remote palette
  extremes never contribute to this local measure.
- Branch contrast at four area scales. Refine clades larger than half, one quarter,
  one eighth, and one sixteenth of family area, ignoring unary wrappers. Each scale
  compares area-weighted mean colors, reports the pair-mass fraction below 0.02,
  and records minimum contrast among clades each covering at least 2.5% of family
  area. Displayed ancestors retain separate slots, preserving all measured area.
  Leaves cannot conceal flat major clades by having varied colors individually.
- Per-family spread, hue drift, and retained chroma, excluding exact overrides
  from coherence measurements while including them in readability measurements.

The evaluator is tested against deliberately misleading palettes, families with
two, four, and eight major branches, unary wrappers, concurrent ancestor/descendant
geometry, duplicate representations, and fixed colors. Browser checks require
contrast at every scale in all large visible Asher families, bound contact conflicts,
verify defaults and optimized colors independently, and verify hue/coherence across
selected and offscreen relatives. They also optimize immediately after selection
and after a zoom round trip to the same camera.

Run `npm run test:colors-browser` from `app/`. The report and replayable input/palette
pairs for DLAC, regional Asher, and world Asher are saved in `test-results/colors/`.
Preserve these pairs when comparing algorithm changes on identical evidence. The
independent evaluator can also run without a browser or optimizer:

```sh
npm run evaluate:colors -- --input test-results/colors/asher-world-input.json \
  --palette test-results/colors/asher-world-palette.json
```

Omit `--palette` to evaluate the stable reference on the same footprints. Run the
measurement unit tests alone with
`python3 -m unittest discover -s tests/browser -p test_color_evaluation.py`.

The grid approximates area and contact: same-cell occupancy does not prove polygon
overlap, thin shapes can occupy a disproportionately large fraction of a cell, and
sub-cell boundaries are not modeled precisely. Defaults have the further limitation
of using coordinates instead of displayed polygons. The search, prominence threshold,
clearance requests, and constrained perceptual regions are heuristics, not a global
optimum or pairwise separability guarantee. Crowded areas and conflicting manual
colors can remain ambiguous. Color-vision-deficiency modeling and final framebuffer
contrast against different basemaps remain future refinements.

### Refinement ablation (2026-11-09)

`scripts/color-refinement/` contains an isolated experiment against the picker at
`dbf53b1`. It does not change application behavior or add production mode switches.
The replay copies domain modules into temporary directories and checks each source
injection, failing if the expected implementation has changed. Its baseline must
match the production optimizer exactly. Every variant uses the same freshly built
default reference and the same saved DLAC, regional Asher, and world Asher footprints.

- `baseline`: current subdivision-constrained refinement.
- `whole-family`: replace each language's subdivision box with the family frame's
  full box. Keep the same seeds, 27 candidate directions, two passes, soft movement
  cost, internal graph, contrast targets, anchors, and family/local feasibility bounds.
- `spatial`: the whole-family search with one graph for intra- and inter-family
  comparisons of actual shades. Apply the existing area-scaled footprint proximity
  formula to languages. Retain the strongest 12 relationships of each kind per
  representation and take their union, protecting an enclave's relationship to a
  larger neighbor. Deterministic mixed tie ranks distribute equal-strength contacts
  instead of concentrating them on early IDs. Within-family targets are unchanged;
  between-family targets come from the existing family links. No per-language
  aesthetic penalty or additional passes are introduced.

The independent experimental evaluator exhaustively compares language pairs within
1.5 size-scaled reaches, using minimum Chebyshev footprint distance, rather than
the optimizer's sampled edges or averaged contact. It separately reports shared-cell
and nearby pairs within and between families. The table combines those distance
bands. Shortfalls use targets of 0.06 within families and 0.16 between families;
"severe" means a color distance below 0.025. These are engineering thresholds, not
validated perceptual limits. Pair averages are weighted by spatial proximity.
Per-language worst-neighbor measurements prevent improvements in the averages from
being mistaken for universal readability. Repeated identical representations are
unioned; fixed colors affect readability but are excluded from aesthetic measurements.
The aesthetic cost measures agreement with the original 24-color preference, using
displayed-area weights, rather than claiming to measure human aesthetic judgment.

| View | Variant | Within-family shortfall ↓ | Severe pair weight ↓ | Aesthetic cost ↓ | Median solve seconds |
| --- | --- | ---: | ---: | ---: | ---: |
| DLAC | baseline | 0.0230 | 1.60% | 0.337 | 0.103 |
| DLAC | whole-family | 0.0315 | 4.39% | 0.621 | 0.100 |
| DLAC | spatial | 0.0136 | 1.55% | 0.363 | 0.097 |
| Regional Asher | baseline | 0.3551 | 48.82% | 0.806 | 1.321 |
| Regional Asher | whole-family | 0.2357 | 29.28% | 0.898 | 1.385 |
| Regional Asher | spatial | 0.2201 | 26.99% | 0.891 | 1.724 |
| World Asher | baseline | 0.4727 | 70.46% | 0.971 | 2.703 |
| World Asher | whole-family | 0.3439 | 44.36% | 1.107 | 2.881 |
| World Asher | spatial | 0.3041 | 36.13% | 1.094 | 4.216 |

Timings are Node v24.14.0 solve-only measurements: one unmeasured warmup followed
by three measured rounds with rotated variant order. Capture and rendering are
excluded. The report retains individual runs and a domain-source hash. Repeated
calls and reversed footprint/cell inputs must produce identical palettes. The runner
also checks unchanged anchors/regions, valid shade radii, and identical hidden
fallback colors. Small synthetic checks exercise fixed colors, family roots, and
dense-contact sampling; matched browser screenshots check unchanged geometry URLs
and request-report counts when applying each palette.

The experiment confirms that subdivision boxes restrict useful local contrast.
On the world view, whole-family refinement reduces local shortfall by 27%; the
spatial graph reduces it by 36%. However, world aesthetic cost rises by 14% and 13%,
respectively. Existing family-balanced contact shortfall stays close (0.04149,
0.04121, 0.04091), while severe family-pair counts change from 10 to 11 in both
experiments. Hue drift stays below 20.3 degrees in all three views.

Local improvement does not ensure branch coherence: the minimum multiscale branch
contrast for Nuclear Trans New Guinea on the world view falls from 0.00787 to
0.00483 with whole-family refinement and 0.00682 with the spatial graph. Most world
languages still have at least one very similar nearby relative on this coarse grid
(97.1%, 96.6%, 96.7%). The DLAC whole-family result also regresses despite increasing
mean contrast. Neither experimental variant is enabled in the application. Further
work should preserve broad branch coherence and apply aesthetic preference to
actual shades before considering a replacement. The graph prototype additionally
enumerates candidate pairs quadratically before geometric rejection; its bounded
retained graph does not make construction linear.

The experimental browser renders use 100% language opacity with the basemap
disabled. They isolate palette differences under identical conditions, but do not
match the user's later light-basemap screenshot. The reported aesthetic cost is
agreement with the original preferred anchors, measured on underlying colors; it
does not establish which palette looks better under the user's normal display
conditions. Future aesthetic comparisons must match opacity, basemap, projection,
camera, source/period, and represented languages.

Reproduce from `app/`, after obtaining the three saved browser captures:

```sh
node scripts/color-refinement/run.mjs
python3 scripts/color-refinement/local_evaluation.py test-results/color-refinement
python3 -m unittest discover -s tests/browser -p 'test_*color_evaluation.py'
```

Optionally run `python3 scripts/color-refinement/render.py` with a production build,
Firefox, and geckodriver installed. It renders matched views plus Europe/Africa
details and creates `test-results/color-refinement/index.html` for switching between
screenshots. Inputs, palettes, timing runs, independent measurements, and screenshots
remain in the ignored `test-results/color-refinement/` directory.

Colors communicate qualitative genealogy; they do not measure linguistic distance
or chronology. Classification depth and color offsets should not be read as measured
divergence. Finite gamut, quantization, and perceptual differences limit useful
uniqueness. At an overview, recent relatives can deliberately look almost identical;
a focused refresh recovers more detail as competing families disappear.

## Roadmap: implementation deferred

Status as of 2026-11-09: record the design direction and evidence now; wait for the
other model to finish and push its changes before starting implementation. After
those changes land, inspect the resulting code and data, reconcile this roadmap,
and capture a fresh baseline. Do not assume the `dbf53b1` implementation or the
experiment's source injections still apply unchanged.

The following is a proposed replacement strategy to validate, rather than an
implemented algorithm or a commitment to particular weights and thresholds.
Prefer a small, coherent objective and shared geographic evidence over accumulating
more correction passes, per-family exceptions, or separate locality rules.

### Goals and constraints

- Preserve recognizable family identities, with useful global separation between
  prominent families. Hundreds of families cannot all be guaranteed strong pairwise
  perceptual separation throughout a finite display gamut.
- Spend the strongest contrast on nearby languages, both within and between
  families. Aim to meet useful contrast targets and avoid severe ambiguities;
  maximizing every difference or maximizing overall variance can produce extreme
  colors and erase broad branch structure.
- Scale comparison reach with geographic footprint. Area means occupied territory
  or displayed area, not speaker population, classification depth, or leaf count.
- Give large displayed territories priority for aesthetically preferred colors.
  Small territories may use stronger accents when necessary, but must remain
  distinguishable from their surroundings. Prominence and the contrast needed to
  see a small mark are separate concerns.
- Keep stable defaults independent of navigation, selection, sources, and period
  filters. View-specific reweighting remains an explicit action; it must retain
  deterministic refresh, complete affected-family palettes, hidden fallback colors,
  exact custom colors, and undo behavior.
- Retain the rendering contract: color changes must not fetch, repartition, or
  invalidate geometry. Bound runtime and memory and keep search off the UI thread.

### Clarification: prominence and vividness (2026-11-09)

The user's later clarification supersedes the palette-recovery proposal below:
the concern is excessive vividness over large visible language territories, not
agreement with a particular set of preferred hues. Smaller regions may use stronger
accents. Recovering a preferred palette from the screenshot is no longer a goal.
The existing “aesthetic” metric measures reference-palette distance only; it must
not be interpreted as a human quality score or a measure of excessive chroma.

The [chroma experiment](../../scripts/color-branches/README.md#prominence-and-chroma-experiment)
compares fixed-anchor restraint with rebuilding family anchors from an expanded
candidate pool. Its successful variant now powers explicit view optimization. Chroma thresholds,
area estimates and contrast targets remain experimental; rendered comparisons
are required. The historical screenshot notes below are context, not a current
requirement to reproduce those colors.

### Aesthetic reference (historical)

The user's preferred visual reference is the Asher world map before the recent
color changes:
[local screenshot](</home/maxime/Pictures/Screenshots/Screenshot from 2026-11-09 16-16-39.png>).
The file is a local reference, not a checked-in asset. Broad areas use softer blues,
ochres, salmon, greens, lilacs, and cyans, with brighter accents. Sampled dominant
language-fill pixels include blue `#7e99e3`, ochre `#b9872a`, green `#669e2a`, and
lilac `#df99d6`. These are rendered colors, not necessarily the underlying palette
values. Ignore ocean, unfilled land, UI, antialiasing, and overlap intermediates
when deriving a representative preferred palette; do not select several nearly
identical blues simply because they dominate the pixel histogram.

Recover the original fill colors where possible, or fit their displayed appearance
under matched conditions. Directly reusing composited screenshot pixels as fill
colors could soften them again. The application defaults to 82% opacity; the exact
screenshot setting was not recorded. The screenshot also shows 5,020 entries,
whereas experimental Asher renders show 5,302, so they are not matched selections.

The expanded candidate pool remains useful for differentiation. The original 24
anchors are all preferred in the current implementation; the screenshot will guide
the next preferred palette rather than silently changing that implementation.
The previously mentioned `#e4be29` was an approximate example, not a required extra
anchor or a request for a special priority color. Golds and olive/dry greens should
remain represented alongside other basic hues. Aesthetic priority stays soft and
area-aware, without fixed color assignments for individual families.

Judge the actual language shades occupying area, not only their family anchors.
Use a continuous preference cost, stronger on large displayed footprints, while
keeping reserve colors available for difficult comparisons. Agreement with an
editorial palette is a diagnostic proxy; matched rendered maps remain necessary
for assessing appearance and the balance of dominant colors.

### Precomputed geographic evidence

Precompute geometry-derived evidence so default colors need not infer language
area and neighborhood from the current 10-degree catalog-point grid. The atlas
build and existing offline geometry preparation provide integration points. Begin
with an Asher contemporary prototype, while retaining geometry-variant, dataset,
period, and source-hash identities for extending to other profiles.

| Evidence | Intended use |
| --- | --- |
| Union polygon area in consistent geographic units | Stable prominence and comparison reach; avoid double-counting overlapping pieces. |
| Compact footprints retaining disconnected components | Distributed territories, islands, antimeridian handling, and tunable proximity. |
| Sparse nearby-pair distances | Exclude geographically irrelevant comparisons without scanning all pairs during coloring. |
| Overlap and directional nearby-coverage fractions | Protect enclaves and distinguish extensive contact from a small encounter. |
| Union footprints for meaningful clades | Compare unresolved branches and estimate broad branch importance without summing overlapping descendants. |

Prefer compact footprints and raw geographic measurements to one permanently
weighted distance matrix. Derive locality weights from them so changing a kernel,
area rule, or contrast target need not rebuild all geometry. Minimum distance alone
cannot distinguish an enclave from two large territories meeting at one outpost.
Footprint coverage or compact multi-resolution occupancy can supply that missing
information; the exact representation remains to be chosen.

Use a sparse graph with an explicit geographic cutoff. Preserve genuine overlaps,
contacts, and relevant nearby pairs; a fixed number of nearest neighbors without
a distance cutoff can connect remote languages. A full 5,000-by-5,000 Float32 matrix
is approximately 100 MB before multiple profiles or additional measurements.
Spatial indexing should bound candidate construction; retaining a sparse graph
after a quadratic scan does not address the experiment's construction cost.
Where dense contacts require sampling, distribute equal-strength relationships
deterministically rather than favoring early IDs, and verify important conflicts
against an independent, more complete evaluator.

Keep source/period footprints separate. Do not silently union historical and modern
territories into one universal language area. Active comparisons must include
relationships across sources when multiple sources are displayed together.
Physical area supports a declared, fixed default-reference policy; displayed screen
area supports explicit view optimization and depends on projection, clipping, and
zoom. Reuse cached evidence while preserving these different meanings of area.

### Locality model to test

A starting hypothesis for pairwise reach is
`reach(i, j) = r0 + k * (sqrt(area(i)) + sqrt(area(j)))`, using distances and areas
in consistent units. Both sizes contribute: a small territory beside a large one
must not lose its relationship because the smaller territory has a tiny radius.
Measure distance to footprints rather than centroids, and apply a smooth decay
kernel within a finite support.

One candidate locality weight is the larger of the two directed averages:
`max(mean over i of closeness to j, mean over j of closeness to i)`. This extends
the current family-level approach to languages. It should protect a small enclave
without letting one minor outpost make two otherwise distant large territories
strong competitors. Test disconnected and thin footprints before fixing a rule
for whether reach uses whole-language area or component-local area.

Same-family and different-family comparisons should use the same spatial evidence.
Different families request stronger contrast; adjacent relatives still need useful
separation regardless of raw classification depth. Local graph weights must not
let numerous descendants or duplicate source/period representations dominate simply
through cardinality. Retain a separate, weaker global identity requirement for
prominent family anchors. A small African language should have no local contrast
term against a geographically remote American language.

### Hierarchy-guided assignment to prototype

1. Establish the family anchors, then traverse the entire forest breadth-first so
   broad identities are known before fine detail. Collapse unary paths. Within a
   frontier, prioritize represented area and important local conflicts; raw tree
   depth is not comparable across all classifications.
2. When a neighbor has a color, compare actual shades using the locality graph.
   For an unresolved neighbor, use its nearest already-colored ancestor rather
   than always falling back to the top-level family. Its own footprint still
   determines locality: borrowing an ancestor color must not borrow a globally
   distributed ancestor footprint and introduce remote competition.
3. Aggregate unresolved neighbors sharing a colored ancestor by their local
   footprint evidence. Do not count the same provisional ancestor color once for
   every descendant. Treat that color as a prediction, not an exact obstacle.
4. Coordinate sibling choices with a small assignment/swap step so early siblings
   do not consume all attractive choices. Keep candidate exploration bounded and
   deterministic; avoid an exhaustive joint search over the entire hierarchy.
5. Use a compact family envelope, a soft preference toward parent/major-branch
   reference colors, and area-weighted aesthetic preference on actual shades.
   Genealogy supplies broad identity and a starting structure; avoid recursively
   shrinking hard per-language boxes. Preserve meaningful major-branch references
   so local improvement does not erase the broad distinctions lost in the ablation.
6. After descendants have colors, allow one or two bounded local repair passes
   against actual neighbors. Provisional ancestor colors cannot predict every
   eventual conflict, so a single greedy pass is not assumed sufficient. Keep
   exact overrides fixed and evaluate branch coherence as well as local improvement.

The intended objective has three main concerns: sufficient local contrast, soft
hierarchical coherence, and aesthetic preference weighted by prominence. Strong
family identity and exact manual colors remain constraints. Search should stop
rewarding contrast once useful separation is achieved rather than pushing every
language toward a gamut extreme. Prefer replacing the existing refinement and
conservative family-wide competition rules after validation over running a second
independent solver on top of them.

Related design references include
[Dynamic Color Assignment for Hierarchical Data](https://arxiv.org/abs/2407.14742),
which combines spatial discrimination, harmony, and parent-guided colors, and
[Towards a Quality Approach to Hierarchical Color Maps](https://arxiv.org/abs/2407.08287),
which discusses competing hierarchical design goals. These support investigation
of the direction, not a guarantee that a particular traversal will work for this map.

### Evaluation and implementation sequence after the pending changes land

1. Reconcile the new code/data with this document and capture fresh, reproducible
   inputs for DLAC, regional Asher, and world Asher. Record revision, selected
   representations, source/period, projection, camera, opacity, and basemap.
   Preserve the earlier ablation as historical evidence rather than treating its
   scores and source injections as a current baseline automatically.
2. Reproduce the reference appearance and derive a small, representative preferred
   palette while retaining reserve candidates. Make matched rendered comparisons
   before interpreting any aesthetic score as an improvement.
3. Prototype precomputed Asher evidence and verify area unions, enclaves, distant
   exclusions, islands, disconnected territories, antimeridian cases, overlapping
   parent/descendant geometry, and repeated representations. Separate preprocessing,
   data-size, and runtime costs.
4. Compare the existing picker with the proposed traversal, ancestor proxies,
   sibling coordination, and bounded repair on identical evidence. Isolate the
   effects of traversal, locality, and repair where useful; avoid view-specific
   exceptions and tuning only to one favorable map.
5. Promote a replacement only after assessing the following dimensions together;
   improving one mean score is insufficient. Keep the implementation simple enough
   to explain, profile, and maintain.

| Dimension | Measurements and review |
| --- | --- |
| Local readability | Contact and nearby shortfalls separately within and between families; lower-tail distances and severe pairs. |
| Protection of small languages | Per-language worst neighbors and enclave cases alongside area-weighted averages. |
| Family and broad branch identity | Prominent family separation, multiscale branch contrast, hue/coherence distributions, and offscreen relatives. |
| Appearance | Area-weighted preference on actual shades and matched screenshots under normal compositing. |
| Approximation quality | Finer sampling or polygon evidence on selected cases; coarse shared cells alone do not prove adjacency. |
| Practicality and stability | Runtime, graph construction, memory/data size, deterministic repeats and input order, fixed colors, undo, and unchanged geometry work. |

Thresholds, family-envelope width, parent-coherence strength, neighborhood support,
candidate budget, and the final preferred palette remain experimental choices.
Color-vision-deficiency modeling, full perceptual calibration, and unrelated color
settings/persistence features remain outside this initial prototype.

## Rendering contract

`resolveMapEntries` applies the selected languoid's resolved color to pinned own or
grouped descendant geometry, followed by an optional per-entry override. Details
offers an entry color picker and a “Use languoid color” reset. Fills, stripes,
blending, On map swatches, and inspector swatches use the entry's final color.
Explore checkboxes show the base languoid color. Geometry availability has no color dependency.

Colors are excluded from coverage selection keys. `createMapResources.updateColors`
updates existing stripe images in place with `MapLibre.updateImage`, retaining
coverage snapshots, encoded tile bytes, and GEOS partitions. Retiring snapshots
retain colors for removed aggregate members. Style restoration recreates images
from current colors. Palette changes must never call controller recomputation.

Tests cover sparse/dense allocation, coherent bounds including gamut-edge anchors,
directional clearance, small families beside large territories, independent
prominence and cardinality, distant prominent families, full-family updates,
deterministic refresh, source/period manual obstacles (including large custom
palettes), visible ancestors, unary/deep/wide/cyclic inputs, nested roots, date-line
neighborhoods, stable defaults, and focused Sinitic variation.
`npm run test:colors-browser` exercises DLAC, a regional Asher globe, and a complete
Asher world view. It verifies actual recolored framebuffer pixels, palette bounds,
important family ambiguities, offscreen roots/relatives, undo/default restoration,
repeatability, navigation/filter stability, manual colors, narrow controls, and
unchanged coverage URLs/request counts. Screenshots, separate quality diagnostics,
and timings are saved in `test-results/colors/`.
