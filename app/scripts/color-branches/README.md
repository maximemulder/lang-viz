# Branch-reference color proof of concept

The successful softer-anchor variant is now integrated into **Optimize colors for
this view** (2026-11-09). Stable defaults retain their previous initialization.
The sections below record the isolated experiments that led to this integration;
references to the production baseline mean the pre-integration optimizer.
The replay harness reconstructs that initializer and checks exact result parity
between `branches-chroma-anchors` and the current app optimizer. Open `app/test-results/color-branches/index.html` in a browser
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

## Prominence and chroma experiment

The user's clarification supersedes preferred-palette recovery: restrain vividness
across large language territories while permitting stronger small accents. The old
palette-distance metric is a historical diagnostic, not a beauty score. Production
behavior is unchanged.

Two comparisons, each with 20 matched screenshots:

- `test-results/color-chroma/index.html`: current picker, previous branches,
  moderate and strong restraint inside unchanged family regions.
- `test-results/color-chroma-anchors/index.html`: current picker, previous branches,
  new anchor initialization alone, and new anchors with branch refinement.

Fixed-anchor variants disable the additional palette preference and penalize only
chroma above `0.18 - 0.08 * sqrt(prominence)`, with weights 0.4 and 1.2. Language
prominence is represented area divided by the largest language area across groups,
clamped to [0,1]. Branch references use their aggregate area. Extra candidates
scale OKLab a/b by 0.45, 0.65 and 0.85, retaining lightness before gamut mapping and
projection. The previous branch mode remains unchanged.

Fixed anchors proved limiting: world dominant-region mean chroma decreased only
about 2%, while within-family shortfall rose from 0.292 to 0.327 (moderate) or
0.390 (strong). Increasing the penalty alone is not the preferred direction.

The anchor experiment adds chroma 0.06 and 0.09 to the existing family candidates.
It replaces anchor palette-distance cost with excess chroma above
`0.18 - 0.08 * family.prominence`, using existing prominence weighting and
coefficient 1.2. Conflict and stability terms remain. Families can choose new hues;
this is not an isolated fixed-hue chroma ablation. Family bounds and production
subdivisions are rebuilt, then branch refinement runs with palette preference
zero and chroma weight 0.1. Candidate budgets and branch weights also differ from
the fixed-anchor comparison, so not every improvement is attributable to anchors.

| Scene | Dominant chroma, previous → new | Local shortfall, previous → new | Severe pair weight, previous → new |
| --- | --- | --- | --- |
| DLAC | 0.162 → 0.119 | 0.0120 → 0.0098 | 0% → 0% |
| Regional Asher | 0.138 → 0.125 | 0.262 → 0.199 | 33.7% → 24.1% |
| World Asher | 0.206 → 0.136 | 0.292 → 0.251 | 33.5% → 28.4% |

Dominant means an automatic representation at least 10% of the largest represented
area; means are area weighted. World area above underlying chroma 0.18 falls from
50.7% to 28.6%. These are underlying colors, not composited screenshot pixels.
Coarse area estimates split cell occupancy within families; cross-family overlap
is not a screen-pixel union. Thresholds are experimental. World cross-family
contact shortfall falls 0.04189 → 0.04143; regional rises 0.03299 → 0.03343.
Africa still has a broad aggregate of vivid small language regions: individual
prominence does not fully control aggregate family prominence.

All independent branch audits pass. New-anchor branches are checked against their
**own new-anchor initialization**, not the old palette's means. Changing anchors
legitimately changes complete family palettes including hidden shades; the later
branch pass preserves these new anchors and hidden shades. Fixed-anchor variants
retain the original hidden-color contract. Repeated/reversed-input and radius
checks pass. Captures have no overrides; fixture tests cover fixed representations.

Runtime is worse: one measured round after warmup gave world previous branches
6.68s and new anchors + branches 14.12s. Fixed-anchor chroma variants took about
11s in their separate run. These are exploratory timings, not robust comparisons;
some rendering/evaluation overlapped the run. Expanded candidate search needs
optimization after settling the visual direction.

Reproduce from `app/` (use three rounds for stronger timing evidence):

```sh
node scripts/color-refinement/run.mjs --chroma --rounds 1
python3 scripts/color-refinement/local_evaluation.py test-results/color-chroma
python3 scripts/color-branches/audit.py test-results/color-chroma
python3 scripts/color-branches/render.py test-results/color-chroma
node scripts/color-refinement/run.mjs --chroma-anchors --rounds 1
python3 scripts/color-refinement/local_evaluation.py test-results/color-chroma-anchors
python3 scripts/color-branches/audit.py test-results/color-chroma-anchors
python3 scripts/color-branches/render.py test-results/color-chroma-anchors
```

The anchor experiment saves `anchor-source.ts` with the injected implementation.
Nine focused TypeScript tests, strict helper typechecking, and 19 Python evaluator
tests pass. Browser rendering verifies selection, loaded colors, and geometry.
Screenshots use the Plain basemap at 82% opacity. These captures predate integration into the application picker.

## Application integration (2026-11-09)

The view optimizer now calls `src/domain/colorBranches.ts` after hierarchical
initialization and uses subdued anchor candidates. Production code has no shade
preference objective; the isolated helper remains available for historical
comparisons. Stable defaults deliberately retain their original candidate set and
objective, preserving the starting palette used in the successful experiment.

The integrated optimizer matches every saved color and anchor of the successful
variant in DLAC, regional Asher, and world Asher. Replays also check reversed input
order, complete family bounds, and hidden fallback colors. The unit suite passes
173 tests. Two old quality expectations were adjusted explicitly: synthetic
prominent-family distance from 0.22 to 0.20 (observed 0.20049), and browser DLAC
family-conflict ceiling from 0.010 to 0.012 (observed 0.0110, versus default 0.0145).
World prominent-family conflict is 0.06164, versus default 0.06093; its ceiling is
now 0.065 instead of 0.060. Independent actual-contact and branch checks remain
unchanged. Softer colors are therefore not a universal improvement in every
palette-distance metric.

One measured replay round after warmup took 14.12 seconds for the world branch
variant. A separate Node CPU profile of the integrated world optimizer took 11.25
seconds: `familyShade` accounted for roughly 2.03 seconds of self time, branch
candidate cost 1.34 seconds, and anchor candidate costs 0.73 seconds. Color
conversion/gamut functions account for substantial additional samples. These are
single-run diagnostics, not a robust speed benchmark.

Recommended next work:

1. Cache equivalent shade projections and candidate-invariant cost terms, checking
   exact palette equality against these captures. Profile again before reducing
   search coverage or removing the existing initializer.
2. Test family-wide visible-area restraint alongside language prominence. Many
   small regions can otherwise produce a large bright patch collectively.
3. Once view behavior is accepted, separately decide whether stable defaults
   should adopt softer anchors too. That changes the initial map and requires its
   own visual review; it is not necessary to use this integrated view optimizer.

The full browser color suite also passes after updating its obsolete Back-button
selector to the current Explore tab. It verifies actual rendered pixels, exact
custom colors, repeatability, undo/default restoration, navigation stability,
regional and world family/contact/branch checks, unchanged geometry requests, and
narrow-layout controls. The production build, targeted Biome checks, and 19 Python
evaluator tests pass as well.


## Runtime performance pass (2026-11-09)

The app now avoids repeated work without changing candidates, search passes,
objectives, or acceptance tolerances:

- Share candidate projections among languages with identical ordered plane sets.
  Cache by sample identity, preserving full precision for unquantized branch means.
- Prepare plane normals and squared lengths once; weak keys release view geometry.
- Reuse immutable RGB-to-OKLab samples in a bounded 8,192-entry cache.
- Generate initializer shade candidates once for both refinement passes.
- Precompute invariant candidate costs and per-visit neighbor/branch terms.
  Keep addition order intact. Reject infeasible branch moves before scoring contacts.
- Precompute representation sizes for the spatial graph's pair loop.

Projection and candidate caches belong to one optimization. Only the bounded color
cache and weak plane cache span calls. There are no prepared dataset dependencies,
so the same improvements apply to runtime cross-dataset comparisons.

Matched Node replay on the three saved `color-integrated` captures, three calls per
scene in a fresh process for each implementation, with no concurrent build/tests:

| Scene | Previous median | Optimized median | Reduction |
| --- | ---: | ---: | ---: |
| DLAC | 169 ms | 164 ms | Small/no meaningful change |
| Asher regional | 4,795 ms | 2,616 ms | 45% |
| Asher world | 10,197 ms | 5,348 ms | 48% |

These are local elapsed times, including the first invocation, not universal
latency guarantees. Full serialized optimizer outputs match the previous version
exactly on all three captures, including metrics and bounds. The optimized replay
also reverses footprint/cell ordering on alternating rounds. All 174 unit tests
and the production build pass. The full browser color suite also passes, including
rendered colors, manual overrides, undo, navigation, and independent branch/contact
checks. Browser elapsed times were 0.44 s for DLAC, 4.65 s regional, and 7.28 s world;
these include the app/browser path and differ from the Node optimizer replay.
A new fixture compares the historical branch solver
against the cached solver with shared local planes and a language having both fixed
and automatic representations.

The standalone benchmark saves input hashes, raw timings, and result snapshots.
To compare a later implementation, run from `app/` before and after editing:

```sh
node scripts/color-branches/benchmark.mjs --output test-results/performance-before
node scripts/color-branches/benchmark.mjs --reference test-results/performance-before --output test-results/performance-after
```

Use `--input` for another directory containing the three captured scene inputs and
`--rounds` to increase repetitions. Current measurements are saved under
`test-results/color-performance-before` and `test-results/color-performance`.

### Next steps toward defaults

Keep this exact-result speedup before spending quality for speed. Runtime is still
several seconds on a world view. For immediate default display, prepare a stable
palette per supported dataset/configuration during the data build, including
hidden descendants. Version it against both taxonomy and color algorithm, and
fall back to runtime computation for configurations without a matching artifact.
A viewport-optimized palette is view-dependent: baking one world view does not
reproduce the best colors for every regional view. That default policy needs its
own visual evaluation before replacing the current stable defaults.

Cross-dataset comparisons and custom configurations can continue to optimize in
the worker. If they need further acceleration, benchmark a two-pass branch search
or adaptive candidate shortlist against this exact-output baseline, with explicit
contact, branch separation, vividness, and rendered-map comparisons. Those quality
tradeoffs have not been enabled in this pass.
