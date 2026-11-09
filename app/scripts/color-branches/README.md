# Branch-reference color proof of concept

This is an isolated experiment, authorized on 2026-11-09. It does not replace the
application picker. Open `app/test-results/color-branches/index.html` in a browser
after running the commands below to compare matched maps. The page works offline
and supports arrow-key switching among variants.

## Scope and algorithm

The prototype explores freedom for individual shades while preserving broad
genealogical distinctions. It reuses the current family anchors, common/local
family bounds, and the earlier experiment's spatial graph. Stable defaults,
geometry, state, and application controls are unchanged.

1. Start from the production optimizer's **finished** palette. The first attempt
   started from unrefined subdivisions, but protecting those subdivisions did not
   protect distinctions that production refinement had subsequently created.
2. Cut each family's displayed hierarchy at four represented-area scales: half,
   quarter, eighth, and sixteenth. Unary wrappers consume no scale; displayed
   ancestors keep their own slots. Track area-weighted OKLab means for each clade.
3. Choose explicit reference colors for substantial clades (at least 2.5% of
   family area), using two deterministic coordinate-descent passes. Prefer
   useful separation, proximity to their initial means, and the original preferred
   24-color palette. This is a bounded joint assignment, not a claim of optimality.
4. Generate a bounded candidate set per language from the whole family frame,
   projected preferred colors, branch references, the original shade, and small
   perturbations. Retain the original shade. Actual quantized candidates must obey
   the existing family and local bounds; recursive per-language boxes no longer
   restrict the new refinement.
5. Perform three area-ordered passes over displayed automatic languages. The
   objective combines contact/nearby contrast shortfalls, a worst-neighbor term,
   soft branch-mean and branch-reference preferences, actual-shade aesthetic cost,
   and a small movement cost. Internal/cross-family targets are 0.06/0.16 in the
   existing weighted OKLab metric. These are engineering thresholds.
6. Guard pairwise separation between substantial branch means at each scale:
   retain at least 98% of the starting separation, capped at 0.025. This allows
   useful freedom beyond that threshold, while preventing the aesthetic term from
   collapsing weak but existing distinctions. The constraint acts on aggregates,
   not on individual shade boxes. Tiny numerical tolerances make area-cut and
   significance boundaries insensitive to summation roundoff.

Exact custom representations remain fixed obstacles, family roots stay at their
anchors, and hidden fallback colors remain identical to production. The helper
operates on automatic shades; fixed representations are excluded from branch
reference fitting. Multiple fixed and automatic representations of one language
still share the original optimizer's language-level area bookkeeping, which is an
approximation worth revisiting before production use.

The branch-mean cost uses the change in aggregate error, divided by the language's
share of that aggregate. This prevents tiny leaves from treating their influence
on the branch as negligible. It is a coordinate-search heuristic, not a globally
monotone energy minimizer. The hard branch guard is checked on every accepted move.

## Variants and interpretation

- `baseline`: the current production optimizer, checked for exact replay parity.
- `spatial`: the earlier whole-family spatial-refinement experiment.
- `branches`: this prototype, starting from the finished baseline.
- `branches-no-aesthetic`: the same prototype with its new branch/shade aesthetic
  cost disabled. Production anchor preference remains enabled.

The branch variants have a larger candidate set and one more repair pass than the
earlier spatial variant. Their difference therefore does **not** isolate just the
branch-coherence term. The two branch variants isolate the new aesthetic term.
This prototype deliberately retains production initialization to make the
non-regression constraint reviewable. It is not yet the proposed replacement
solver, breadth-first ancestor-proxy scheme, or polygon-preprocessing pipeline.

The preferred shades are the existing 24 anchors, not newly recovered colors
from the user's screenshot. Family anchors stay fixed, so this experiment cannot
change a dominant magenta family into the screenshot's blue family. Improvement
in the aesthetic metric measures agreement with that editorial palette; it does
not establish human preference or reproduction of the original reference.

## Reproduce

Run from `app/`, using the existing saved captures in `test-results/colors/`:

```sh
node scripts/color-refinement/run.mjs --branches --rounds 3
python3 scripts/color-refinement/local_evaluation.py test-results/color-branches
python3 scripts/color-branches/audit.py test-results/color-branches
npm run build
python3 scripts/color-branches/render.py
```

Firefox and geckodriver must be installed for rendering. The render uses the
application's Plain basemap at 82% opacity, fixed cameras/projections, contemporary
DLAC or Asher selections, and identical selected entries across variants. Europe
and Africa details use the frozen world palettes, without reoptimizing on zoom.
It verifies loaded palette values, captured-entry availability, unchanged selected
entry IDs, coverage URLs, and geometry-report counts for the three main scenes.
`render-settings.json` records scene settings and selected entry IDs.

The replay performs one warmup and three measured rounds with rotated variant
order, including reversed footprints/cells. It asserts palette determinism,
unchanged family anchors/regions, bounded RGB shades, exact baseline parity, and
unchanged hidden colors. Benchmark timings include initialization and refinement,
but exclude browser capture/rendering. Source hashes and helper snapshots are
saved alongside the palettes. Generated artifacts are ignored by git.

```sh
node --test --test-isolation=none tests/color-branches.test.ts tests/color-refinement-experiment.test.ts
python3 -m unittest discover -s tests/browser -p 'test_*color_evaluation.py'
```

The independent evaluator uses exhaustive nearby comparisons on the captured
grid, rather than the solver's sampled graph. It also evaluates multiscale branch
means from the original topology. Its thresholds are diagnostic proxies, not
perceptually calibrated guarantees.

## Recorded results, 2026-11-09

Each cell below is production baseline → branch-reference prototype. The spatial
and no-aesthetic variants are also available in the comparison page and raw report.

| View | Within-family shortfall ↓ | Severe pair weight ↓ | Aesthetic penalty ↓ | Median solve seconds |
| --- | ---: | ---: | ---: | ---: |
| DLAC | 0.0230 → 0.0120 | 1.60% → 0.00% | 0.337 → 0.196 | 0.098 → 0.158 |
| Regional Asher | 0.3551 → 0.2622 | 48.82% → 33.67% | 0.806 → 0.765 | 1.476 → 3.570 |
| World Asher | 0.4727 → 0.2921 | 70.46% → 33.48% | 0.971 → 0.906 | 2.822 → 7.369 |

The independent branch audit checks 4 DLAC, 448 regional Asher, and 676 world
Asher family/scale minima. All 1,128 retain at least 98% of the baseline minimum,
capped at 0.025, in both branch variants. This is a minimum-contrast preservation
check, not a guarantee that every pair improves. Starting flat branches can remain
flat. Area-boundary roundoff initially caused inconsistent cuts; the final run
uses explicit numerical tolerances and passes the independent audit.

World contact conflict between families rises slightly, 0.04149 → 0.04189;
regional conflict rises 0.03256 → 0.03299. The world fraction of languages with a
severely similar nearby relative only improves 97.07% → 96.32%. Thus the reduction
in average/pair-weighted conflict does not solve worst-neighbor ambiguity.

Disabling the new aesthetic term lowers world local shortfall slightly further
(0.2897), but raises aesthetic penalty to 1.047, above production's 0.971. Regional
Asher also trades better local contrast for worse aesthetic agreement. The
earlier spatial variant has better regional local shortfall (0.2201) than this
prototype, but weaker protections for branch structure and worse aesthetic cost.

The initial unguarded prototype had better aesthetic scores but collapsed some
broad branch means. It was rejected. The final implementation deliberately trades
some of those gains for branch preservation. Matched renders show more local
detail, while retaining the dominant hue choices of the current picker. It is a
useful refinement experiment, not a full restoration of the preferred screenshot.

## Limits and next experiments

The 36 × 24 capture grid still conflates nearby tiny polygons. The reused spatial
graph still scans candidate pairs quadratically before rejection. The retained
edge set is bounded per representation by a union of local choices, but that does
not make graph construction linear or bound every final degree.

Hard family/global bounds still limit possible detail. The new branch guard
protects existing distinctions and cannot guarantee strong distinctions where the
starting palette is already flat. There is no guarantee that every local contrast
metric improves, especially across families or for an individual language's worst
neighbor. Exact conflicting manual colors can remain indistinguishable.

Before production integration, compare finer geographic evidence, a better
area-aware family-anchor assignment, and relaxing unnecessary global descendant
bounds. Then test whether direct branch-reference initialization can replace the
production initializer without losing its broad distinctions. Preserve the
current stability, override, worker, and geometry contracts during that work.
