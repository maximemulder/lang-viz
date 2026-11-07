# Language Atlas of China: compatibility assessment

**Integration update:** the production pipeline now includes the reviewed DLAC
correspondences, documented in [DATASETS.md](DATASETS.md#44-language-atlas-of-china).
It enables 17 nodes, including the subsequently reviewed Mandarin, Mongolic,
Korean, and broad Tai-Kadai correspondences. The three groups without equivalent
Glottocodes and the inconsistent record remain excluded. It distributes
[a source notice](pipeline/dlac/NOTICE.md) under the conservative BY-NC-SA policy.
The assessment below records the initial hypotheses and scope questions before
integration; the current production decisions and counts are in DATASETS.md.

Assessed 7 November 2026 against the local schema-v4 catalog: 27,177 languoids,
6,647 with geometry, and 14,337 source variants. The analysis uses the source
revisions in `pipeline/atlas/sources.lock.tsv`; generated output records hashes of
the exact catalog and variant files inspected.

The atlas is a useful **additional regional source**, particularly for Jin and Hui
and for direct Min-group coverage. It fits the existing rendering architecture
after an offline conversion and a reviewed Glottocode crosswalk. It is not a
drop-in CLDF source, a complete individual-language atlas of China, or a suitable
replacement for the existing global datasets.

## Source and download

The inspected release is Lawrence W. Crissman's **Digital Language Atlas of
China**, [Harvard Dataverse, DOI 10.7910/DVN/OHYYXH, V6.0](https://doi.org/10.7910/DVN/OHYYXH).
It digitizes the **1987** atlas, using the original cartographer's colour
separation plates. Its metadata describes geographic coverage for **1985–1987**;
the 2012 distribution/release dates do not make this a map of China in 2012 or
the atlas's second edition.

The current public release contains one shapefile archive, a Word data dictionary,
and a sample JPEG. The dictionary says eight layers were planned but only the
first draft layer had been released. The Dataverse V6.0 file list still contains
only that GIS archive; the other seven layers were not found in this release.
The [Glottography organization repository list](https://api.github.com/orgs/Glottography/repos?per_page=100)
also contained no dedicated China-atlas conversion when checked.

The GIS archive and data dictionary are downloaded and verified in
`datasets/dlac/raw/`. A local copy was already present; the files fetched from
Dataverse match its published MD5 checksums. A separate fetch script now pins
both public file IDs and SHA-256 checksums:

| File | Dataverse file ID | Size |
|---|---|---:|
| `ACSN_MajorLanguages_pgn.zip` | [2423709](https://dataverse.harvard.edu/api/access/datafile/2423709) | 881,875 bytes |
| `DLAC.Metadata.doc` | [2423710](https://dataverse.harvard.edu/api/access/datafile/2423710) | 51,200 bytes |

There is a material **license conflict**: the current Dataverse API metadata
reports CC0 1.0, while the bundled dictionary explicitly specifies **CC BY-NC-SA
3.0**, academic noncommercial use, and a required attribution. The dictionary
also describes an underlying copyright agreement. This assessment does not
resolve that conflict or relabel the archive as CC0. Preserve the documentation
and attribution. The integration follows the more restrictive BY-NC-SA terms
pending clarification, rather than treating the archive as unrestricted CC0.
The existing Pacific source already has a noncommercial restriction, but DLAC's
documented ShareAlike condition is an additional consideration.

The dictionary's attribution identifies Crissman as GIS editor, ACASIAN/Griffith
University as producer, and Theo Bauman's maps for the 1987 atlas as the basis.
The supplied attribution is retained in the source notice; the metadata
uses several different production dates (1995, 2002, and 2012), so do not infer a
geographic observation year from that attribution.

## What is actually in the shapefile

| Property | Measured result |
|---|---|
| Features | 307 polygon records; 30,605 stored coordinates |
| CRS | WGS84 longitude/latitude; no reprojection needed for GeoJSON |
| Geometry validity | All 307 valid under Shapely/GEOS |
| Bounds | 73.556–134.778° E, 18.181–53.560° N |
| Identifiers | No Glottocodes or ISO 639-3 codes |
| Attributes | `AREA`, `PERIMETER`, `CH_LANGS_`, `CH_LANGS_I`, `LANGUAGE_F`, `CHINESE_GR` |
| Broad grouping labels | 18 distinct `LANGUAGE_F` values, including combinations and uninhabited land |
| Chinese-group labels | 18 nonempty `CHINESE_GR` values, including combinations and spelling variants |
| Shared regions | 108 records explicitly identify multiple components after splitting both fields |
| Uninhabited regions | 7; omit from language areas |
| Unresolved components | Present in 20 records; retain for review, including partially matched shared regions |

Of the 300 inhabited records, 295 have at least one candidate assignment and
280 have candidates for all components. These counts include the explicitly
flagged scope-review hypotheses; they are not a count of approved matches.

`LANGUAGE_F` describes broad groupings, including Turkic, Mongolian, Tibeto-Burman,
Miao-Yao, Kam-Tai, and combinations with Han Chinese. `CHINESE_GR` provides
Chinese-group detail such as Mandarin, Jin, Wu, Hui, Hakka, Min, and Pinghua.
This public layer does not distinguish all individual minority languages.

The regional coverage includes Taiwan, Hainan, and mainland areas, but is not a
worldwide extent for any of these families. No coverage of an individual place
should be inferred solely from the overall bounds.

Import details that matter:

- `CH_LANGS_` is unique across these 307 records. `CH_LANGS_I` is not: values
  19, 35, 202, and 240 repeat. Use an identifier namespaced by release/layer and
  `CH_LANGS_`, retaining the legacy ID as metadata.
- Eight records spell Mandarin as `Manderin Supergroup`. Several combination
  labels are truncated, including `Mandarin Supergroup and Pinghu` and
  `Hakka and Yue (Cantonese) Grou`. Normalize only known values and retain raw text.
- One record, `CH_LANGS_ = 244`, has a Mandarin group label but only `Kam-Tai
  Languages` in the broad field. Flag the inconsistency rather than discarding
  either label.
- `AREA` and `PERIMETER` should not be treated as square kilometres or kilometres.
  Geographic comparisons below recompute area in an equal-area projection.

## Mapping to the current datasets

[The candidate table](pipeline/dlac/candidates.csv) records explicit hypotheses
and scope issues. These are not approved linguistic equivalences. Splitting
shared labels produces **17 candidate nodes with features: nine language nodes
and eight family/subfamily nodes**. Four lack direct areas in the current catalog:

| Source group | Candidate Glottocode | Current level | Features | Existing direct area |
|---|---|---|---:|---|
| Jin | `jiny1235` | language: Jinyu Chinese | 2 | None |
| Hui | `huiz1242` | language: Hui Chinese | 1 | None |
| Min | `minn1248` | family/subfamily: Min | 25 | None; descendant languages have areas |
| Mongolian languages | `mong1329` | family/subfamily: Mongolic | 28 | None at this node; scope needs review |

Hui must map to the **Hui Chinese language** candidate, not the similarly named
`huiz1243` Huizhou dialect under Hakka. Min and Pinghua map naturally to group
nodes, not to every descendant language. Mandarin Supergroup is provisionally
compared with `mand1415`, but its scope must be checked against Mandarinic
`mand1471`, which also includes other languages in the pinned classification.
Mongolian here should not automatically mean the narrower Mongolian macrolanguage
or the broader Mongolic-Khitan root.

Three components remain unassigned: **Tibeto-Burman, Shaozhou Tuhua, and Danzhou**.
The pinned tree has no equivalent Tibeto-Burman node; mapping it to Sino-Tibetan
would also imply Sinitic. `quji1234` Qujiang Hakka-Shibei Shaoguan Tuhua is a
possible partial Shaozhou match, not sufficient grounds to assign the whole
source region. Kam-Tai's scope also needs review against Tai-Kadai and the
narrower Kam-Tai node.

The candidate nodes directly match **five distinct WALS Glottocodes** (Mandarin,
Wu, Hakka, Yue, Korean) and **two DiACL Glottocodes** (Mandarin and the
Indo-European family node). These are identifier joins, not validation of the
candidate scopes. Branch-level typology matches are listed separately in
`candidate-coverage.csv`; a typological record for a descendant does not make a
broad regional polygon that descendant's own area. The existing Glottolog tree
already supports these distinctions.

### Agreement with existing boundaries

For five relatively clear Chinese language candidates with existing contemporary
Asher areas, measured agreement is:

| Language | Intersection / union | DLAC area inside Asher | Asher area inside DLAC |
|---|---:|---:|---:|
| Yue | 54.27% | 83.04% | 61.04% |
| Gan | 46.26% | 62.90% | 63.63% |
| Hakka | 43.11% | 46.92% | 84.15% |
| Wu | 27.90% | 28.99% | 88.08% |
| Xiang | 6.18% | 42.41% | 6.75% |

These use complete, unsimplified source geometries and EPSG:6933 equal-area
measurements. **Neither source is treated as ground truth.** Full extents are
compared without clipping to China, so cross-border coverage contributes to
differences. The source dates, geographic scope, original classifications, and
digitization choices also differ. The large disagreements, particularly Xiang,
warrant map-level inspection before interpreting one source as more accurate.
Jin and Hui have no existing direct area for an equivalent comparison.

This supports the current policy of preserving alternatives and selecting them
by source. It does not support replacing Asher automatically or merging source
boundaries into one supposedly definitive extent.

## Fit with the implemented architecture

The implemented pipeline is more suitable than some older design notes suggest:
it already exports all languoid levels, preserves shared source polygons, and
lets the browser aggregate descendants. The integration therefore keeps the
current static JSON/PMTiles delivery and MapLibre overlap renderer.

1. **Acquisition:** the production `fetch-sources.sh` now calls the checksum-pinned
   Dataverse fetcher alongside its Git sources; file IDs and hashes are pinned
   separately from the Git revisions in `sources.lock.tsv`.
2. **Conversion:** `pipeline/dlac/prepare.py` reads the shapefile offline and emits
   `features.geojson` with stable IDs and selected `cldf:languageReference`
   assignments. Shared polygons use pipe-separated references. Raw fields and
   excluded components are preserved for audit alongside the crosswalk hash.
3. **Source registration:** the dataset and `GeographySource` in
   `pipeline/atlas/build.py` use a new `dlac-shapefile` source format. The importer
   converts it before grouping original polygons into selectable variants,
   without dissolving boundaries or assigning group polygons to descendants.
4. **Temporal semantics:** distinguish the 1985–1987 represented period, 1987
   atlas publication, and 2012 digital release. An approximately contemporary
   source view can use today's schema, with a descriptive label. A separately
   selectable 1985–1987 range requires changes to `TemporalViewId`, temporal
   coverage, filters, and validation; do not encode it as a 2012 snapshot.
5. **Defaults and regional scope:** append as an alternative to preserve existing
   defaults. A family polygon in China represents only the source's regional
   coverage. The current catalog has no explicit geographic-completeness field;
   a source notice is necessary, and machine-readable scope would be useful if
   downstream analysis is added. Do not copy these group areas down the tree.
6. **Attribution:** document the conflicting terms and preserve the source notice
   when shipping derived data under the conservative BY-NC-SA policy. The dataset
   catalog's single `license` string cannot explain this conflict by itself.

The small archive and coordinate count suggest modest additional tile work,
although shared assignments will repeat some geometries as they do today. No
new backend, map renderer, or database is required. Tile size and browser cost
were not benchmarked during this initial assessment. The subsequent integration
successfully built the combined PMTiles archive and passed the frontend's
real-archive integration tests.

## Related county dataset

There is also a different release called
[Language Atlas of China, DOI 10.7910/DVN/QPUONU](https://doi.org/10.7910/DVN/QPUONU),
by Lavely/Berman. Its metadata describes **1990 county administrative units**
with language codes. It explicitly says the original coding covered only
Sinitic and that other counties received partly arbitrary placeholder values.
It could support county comparisons, but should not substitute for the DLAC
linguistic-boundary layer or supply reliable minority-language polygons. Its
metadata was inspected; its separate archive was not downloaded for this audit.

## Reproduce

With the existing datasets and generated schema-v4 atlas in place:

```sh
bash pipeline/dlac/fetch.sh
uv run --script pipeline/dlac/assess.py
```

The script declares isolated, pinned analysis dependencies; it does not change
the production pipeline dependencies. Results are written under the ignored
`data/processed/dlac-assessment/` directory:

- `summary.json`: source checksums, geometry checks, label counts, unresolved
  components, catalog fingerprints, and candidate coverage.
- `assignments.csv`: each original feature's proposed component assignments,
  including unresolved components and raw labels.
- `candidate-coverage.csv`: current own-source availability and direct versus
  descendant WALS/DiACL joins. The unused Sinitic fallback is shown with zero
  features and excluded from the 17-node total.
- `boundary-comparison.csv`: the measured comparisons above.

The initial assessment was validated by running the fetcher against the local
files, executing the analysis against the pre-integration catalogs, checking all
307 geometries and candidate IDs, and running Ruff and Bash syntax checks. Running
it against the current catalogs also observes the newly enabled DLAC variants;
the historic availability counts above describe the pre-integration baseline.
