# Administrative language data: ADM-00 and ADM-01

This supplement is independent of the atlas geometry and the WALS and lexical
releases. It exports CLDR-like territory/language observations without assigning
territory polygons or treating Glottolog language coordinates as speaker locations.

## Audited baseline, 2026-11-15

- Main at audit: `345fb82f69dc2ff75910f1d7910e39f2f2ac93d5`; source branch:
  `4cb95badf12d64d9a0ff7be5535c43fbaebb1aa9`. The working tree was clean.
- Main already has a persistent `WorldMap`, optional exploration layers, header
  workspace navigation, and Explore / On map language-sidebar tabs. The branch
  creates a separate CLDR map and directly joins `world-atlas` country polygons
  through ISO 3166 numeric/alpha-2 codes.
- The branch contains `cldr_glottolog_joined.csv` and `build_cldr.py`, but no
  preprocessing script, original CLDR XML/JSON/TSV, CLDR release identifier,
  source hashes, manual mapping log, or license notice for the joined file.
  Its README points to a sibling `UNICODE-cldr` folder, which is not present
  in this workspace or pinned by that branch.
  Its commit is the earliest local history for the CSV. The joined file is
  pinned in [sources.json](sources.json) and restored into ignored
  `data/administrative/source/`; this integration adds no CSV to main's Git
  tree. The original source branch still contains that CSV in its Git history;
  a future independently published source archive could replace the Git blob
  pin once the data lineage is reviewed. **The original CLDR release and the
  join's full lineage remain unverified.** Similarity to a published CLDR chart
  cannot establish its release.
- The Glottolog catalog is pinned to `glottolog-cldf` commit
  `072ca0d0410039fb8b779be8fc165bac575d2cda` and a SHA-256 of its
  `cldf/languages.csv`. The joined CSV agrees with this catalog on ID, name,
  ISO 639-3, family, macroareas and countries. Three coordinate strings differ
  only at floating-point display precision (at most `1e-10`); numeric values
  are validated with that tolerance. No manual mapping is added by this adapter.

### Measured snapshot

| Check | Result |
| --- | ---: |
| Joined rows / distinct territories | 1,488 / 251 |
| Distinct CLDR language codes / Glottocodes | 761 / 725 |
| Missing Glottocode joins | 0 |
| Glottolog levels represented by rows | 1,375 language; 35 dialect; 78 family |
| Duplicate territory + raw CLDR code | 0 |
| Duplicate territory + Glottocode groups | 30 (script/code variants) |
| Territory percentage totals above 100% | 127; maximum 310% (NL) |
| Rows with zero population percentage | 47 |
| Missing language literacy / writing percentages | 1,397 / 1,438 |
| Missing family / macroarea fields | 5 / 1 |
| Missing Glottolog coordinate pairs | 4 |
| Missing UN containment / Glottolog country fields | 3 / 2 |
| Reported `speaker_count` disagreeing with rounded population × percentage | 0 |

Examples to retain for regression: `AM/ku` and `AM/ku_Cyrl` map to the same
Glottocode, as do `CN/yue` and `CN/yue_Hans`. `HK`, `TW`, `PS`, and `XK` are
present as distinct source territory codes; their labels and polygon treatment
must remain independent of this statistical export. `AC`, `DG`, `EA`, and `IC`
are examples requiring explicit territory-to-boundary review rather than an
assumed ISO join. The branch's `world-atlas` geometry inventory was not pinned
or validated in the audit, so a complete unmatched-geometry count is still an
ADM-02 task. Geometry IDs without CLDR observations also remain uncounted.

[Unicode's territory-language documentation](https://unicode.org/cldr/charts/48/supplemental/territory_language_information.html)
describes these values as approximate functional language population estimates,
which may include L1 and later-language speakers. Percentages can exceed 100%
and coverage is incomplete. This CSV's `speaker_count` is a rounded derived
number, not an independently surveyed count. The adapter retains each original
language/script row and does not use pies or sum rows into unique people.

### First boundary-view policy for ADM-02

The provisional first opt-in geometry view is the `world-atlas` 1:50m Natural
Earth Admin-0 derivative already used by the source branch, labeled by its
actual package and source versions. Its [documented IDs](https://github.com/topojson/world-atlas/blob/master/README.md)
are ISO 3166 numeric country codes, not CLDR territory codes. Borders remain
off by default. ADM-02 must pin exact topology bytes, audit every ID and
territory crosswalk, and document the disputed-feature treatment before this
view ships. Ambiguous or unmatched territories stay searchable but receive no
polygon or metric fill. [Natural Earth explains](https://www.naturalearthdata.com/downloads/50m-cultural-vectors/50m-admin-0-breakaway-disputed-areas/)
that its default boundaries reflect de facto control; the view must disclose
that choice and must not be presented as politically neutral.

## Reproduce and verify ADM-01

Only the source pin and adapter are tracked on main. The source CSV is restored
from the source branch's pinned Git blob into ignored
`data/administrative/source/`; the Glottolog catalog is restored from its pinned
commit into ignored `data/administrative/glottolog/`. Both are checked by byte
count and SHA-256 before use. A private GitHub repository requires `GH_TOKEN`
with repository read access for the source restore. From a clean checkout:

```sh
uv run python -m pipeline.administrative.sources restore
uv run python -m pipeline.administrative.sources verify
uv run python -m pipeline.administrative.build build
uv run python -m pipeline.administrative.build verify
```

For an offline checkout that still has the source branch commit and the pinned
atlas Glottolog catalog locally:

```sh
uv run python -m pipeline.administrative.sources restore --from-git . \
  --catalog datasets/glottolog-cldf/cldf/languages.csv
uv run python -m pipeline.administrative.build build \
  --catalog datasets/glottolog-cldf/cldf/languages.csv
uv run python -m pipeline.administrative.build verify \
  --catalog datasets/glottolog-cldf/cldf/languages.csv
```

Build and verify never use the network. The output is ignored
`app/public/administrative/observations.json`; deployment restores both sources,
builds the supplement, and verifies it before the frontend build. A missing or
changed source, catalog, producer file, or output fails this separate gate.
Builds are deterministic and replace the file atomically only when bytes differ.

The JSON contains a manifest with schema version 2, source branch revision,
CLDR release (`null`, because unknown), joined CSV and Glottolog hashes,
Glottolog commit, adapter source hash, attribution, and coverage counts. Source
numeric strings and identifiers are retained exactly. `languageAssociations`
hold the verified source-code-to-Glottocode join; `atlasAssociations` explicitly
remain unresolved until a reviewed atlas crosswalk is available. No boundary IDs
or shapes appear in this asset.
The schema version 2 export also includes family IDs and names from the same
pinned Glottolog catalog. The browser validates them against language family
references before publishing its local repository.

ADM-02 now has its own [boundary package and crosswalk](boundaries/README.md).
It produces separate opt-in browser assets without changing this observation
export.

Attribution: Unicode CLDR data are offered under the
[Unicode License v3](https://github.com/unicode-org/cldr/blob/main/LICENSE);
Glottolog CLDF is [CC BY 4.0](https://github.com/glottolog/glottolog-cldf).
The joined CSV's unrecorded preprocessing is disclosed above, so consumers
should avoid attributing its exact transformed values to a specific CLDR release.
