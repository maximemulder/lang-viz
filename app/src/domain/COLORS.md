# Languoid colors

`colors.ts` owns presentation colors independently of geometry, source availability,
time period, search, and camera. `GeometryVariant.color` remains a legacy categorical
seed in the generated catalog; rendering uses `languageColorsAtom` instead.
No data rebuild is required to change palettes.

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

Colors communicate qualitative genealogy; they do not measure linguistic distance
or chronology. Classification depth and color offsets should not be read as measured
divergence. Finite gamut, quantization, and perceptual differences limit useful
uniqueness. At an overview, recent relatives can deliberately look almost identical;
a focused refresh recovers more detail as competing families disappear.

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
