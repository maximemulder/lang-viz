# Languoid colors

`colors.ts` owns presentation colors independently of geometry, source availability,
time period, search, and camera. `GeometryVariant.color` remains a legacy categorical
seed in the generated catalog; rendering uses `languageColorsAtom` instead.
No data rebuild is required to change palettes.

## Testing controls

Open **Map settings → Language colors** to switch between semantic and categorical
coloring. Expand **Custom colors and groups**, enter a languoid ID (selected entries
are suggested), and choose or type a color. **Set exact color** affects that entry;
**Set subtree color** seeds its semantic palette. Each has a remove action.
Comma-separated **Comparison root IDs** establish separate palettes after pressing
**Apply comparison roots**. **Reset color settings** restores defaults while keeping
the map selection and its inferred family groups. Changes apply immediately and
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

`semanticPaletteAtom` exposes `colors`, `rootById`, and `anchors` for future legends
and debugging. `languageColorsAtom` exposes the final colors after overrides.

## Grouping and stability

Classification roots always establish world palettes, including isolates. Selected
family entries establish comparison palettes automatically. Ordinary individual
language selections retain their genealogy's palette.

`showMappedLeavesAtom` records its highest matched root on each pinned leaf.
`mappedLeafColorRootsAtom` derives roots from surviving entries; replacing a family with its mapped leaves therefore
preserves coloring context. Redundant ancestor/descendant search matches do not
establish a new independent palette for every leaf. A later selection within a
subtree can establish a nested root. Replacing a subtree within the same source/period
context updates its leaf provenance; other comparison contexts and unrelated roots
remain. Removing the last entry carrying a root releases it. `clearMapSelectionAtom`
clears entries and their provenance, preserving explicit color configuration.
`visibleLanguageIdsAtom` is a read-only projection of unique selected languoids.

Searches, row expansion, panning, period/source filters, and individual language
selection do not redistribute palettes. Explicit changes to comparison roots or
anchors can reassign comparison palettes. Adding a comparison root preserves the
global root anchors and reserves its original interval, leaving unaffected sibling
colors in place. Exact overrides preserve the cached semantic palette.

## Semantic algorithm

This is a practical adaptation of hierarchical palette subdivision, inspired by
[Tree Colors](https://doi.org/10.1109/TVCG.2014.2346277), rather than a reproduction
of that paper's algorithm. It uses [Culori](https://culorijs.org/api/) for OKLCH/OKLab
conversion and gamut mapping.

1. Build a stable forest in iterative passes. Cyclic or orphaned classifications
   are broken into deterministic trees; very deep trees do not consume the call
   stack. Single-child classification steps neither consume variation nor change
   sibling ordering.
2. Group mapped catalog coordinates into 10-degree geographic cells. Families
   occupying the same or neighboring cells are neighbors, with longitude wrapping
   at the date line. Multiple descendant locations represent distributed families;
   a family centroid is never used. Missing coordinates contribute no proximity
   information.
3. Assign root anchors greedily from 24 gamut-mapped candidate colors, prioritizing
   well-connected roots and maximizing their minimum OKLab distance to already
   assigned neighbors. Similar palettes may be reused in distant regions. Global
   anchors are assigned before comparison roots. Nested roots additionally avoid
   their parent's anchor even if geographic coordinates are missing.
4. Recursively partition a bounded box around each root in hue, lightness, and
   chroma. Split the dimension with the most remaining normalized range, allocate
   space using the square root of each branch's mapped-leaf count (minimum one),
   and leave gaps between siblings. This avoids exhausting hue alone in wide,
   deep trees. Each node takes its box's center color. Nested roots restart their
   own box, while keeping their slot in the ancestor's allocation.
5. Resolve the strategy and apply exact overrides. Categorical mode uses each
   languoid's first catalog color, with the legacy ID hash as an unmapped fallback,
   so switching geography sources does not change its color.

Tree preparation costs roughly O(N log N) for stable sorting; palette subdivision
is O(N). Neighborhood construction uses occupied cells and local family pairs,
rather than all pairs of languoids. Greedy assignment costs O(24E) for neighborhood
edges E. Dense local neighborhoods can still approach quadratic cost in the number
of roots, but not in all 27,000 languoids. The derived atoms cache results between
relevant catalog/group/anchor changes. Exact overrides only resolve final colors.

Color distance is a qualitative genealogical cue, not a linguistic distance or
chronology. Finite gamut, RGB quantization, broad/deep trees, and color vision
differences prevent unique, reliably distinguishable colors for every languoid.
Unary nodes deliberately share colors. Geographic cells approximate proximity;
they do not model polygon adjacency, overlap, diaspora footprints, or equal ground
distance near the poles. A polygon-cell neighborhood provider or an explicit
focused palette is a natural next refinement if actual maps reveal conflicts.
The optional fifth argument to `buildSemanticPalette` accepts a
`ColorNeighborhoodProvider`: given languoid-to-root ownership, it returns a
root-neighbor graph. Polygon-based providers can therefore replace the coordinate
approximation without modifying hierarchy subdivision or the renderer.

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

Tests cover genealogy clustering, overrides and anchors, reordered catalogs, unary
steps, nested roots, deep/wide/cyclic inputs, date-line geography, real Sinitic
variation, and live stripe recoloring with unchanged coverage URLs/request counts.
