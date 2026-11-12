# WALS source adapter and independent delivery

WALS-01 compiles an independent, versioned typology supplement. It does not
change atlas or lexical releases, create atlas associations, or add frontend UI.
Port reference: `3b7078614efcfebc1c471fea2c4ab7fb336745a6` (`swedha-wals`).

## Selected snapshot

On 2026-11-12, both the [latest upstream release](https://github.com/cldf-datasets/wals/releases/latest)
and the upstream `master` branch resolved to **v2020.6**, commit
`81298aa26d01fdc11b769bcc7fa87ad9e43d7ccd`, released 2026-09-28.
The [publisher's download page](https://wals.info/download) identifies the same
version. The older `datasets/wals` checkout is not an input to this adapter.

[sources.json](sources.json) pins the immutable upstream archive and all 20
extracted inputs by size and SHA-256. The archive contains the complete upstream
repository, including original raw tables, all CLDF observations, bibliography,
documentation and errata. A source restore keeps that archive as `upstream.tar.gz`
and extracts only the files used for validation, compilation, and notices.
No source CSVs, bibliography, archives, or generated browser data belong in Git.

## Restore and build

From the repository root, Python 3.12+ (standard library only):

```sh
python3 -m pipeline.wals.sources restore
python3 -m pipeline.wals.sources verify
python3 -m pipeline.wals.build
```

Sources go to ignored `data/wals/wals-v2020.6/`; output goes to ignored
`app/public/wals/features.json`. Network use is explicit and confined to restore.
It downloads from an immutable commit URL, verifies archive bytes before opening
it, verifies extracted files, then renames the staged directory into place.
Existing valid installations are left alone. Modified installations are rejected
and preserved; use `--output` to choose a fresh source directory.

Offline restoration from a previously saved copy of the pinned archive:

```sh
python3 -m pipeline.wals.sources restore --archive /path/to/upstream.tar.gz
```

Use `sources restore --output /path/to/sources` and
`build --source-dir /path/to/sources --output /path/to/features.json` for isolated
builds. Deliberately changed inputs require `build --unpinned`; this retains
structural validation and actual input hashes, and sets provenance snapshot,
commit and source URL to null. It does not satisfy the pinned snapshot gate.

Builds validate contents every time. Identical inputs yield identical JSON bytes
and leave the output modification time unchanged. Output is replaced atomically
only after successful validation and serialization; failures preserve the last
artifact. Diagnostics travel inside the same JSON, avoiding partially updated
data/report pairs. Source timestamps and local paths are not in the bundle.

## Schema version 1, adapter version 1

All keyed objects use original WALS IDs. There are no atlas IDs or inferred joins.

| Field | Contract |
| --- | --- |
| `records` | All 2,662 source varieties: name, macroarea, original Glottocode and ISO identifiers, WALS family/subfamily/genus labels, references, source URL and representative coordinates |
| `coordinates` | `[longitude, latitude]` or null; zero is valid; missing/incomplete pairs are diagnosed; nonfinite/out-of-range/non-numeric values fail |
| `features` | Seven original feature names/descriptions, chapter identity/title/citation/authors, area, references and links |
| `categories` | Original category ID, feature ID, positive numeric code, name and plain description |
| `observations` | Original observation ID → exact source ID, feature ID, category ID, references, plain comment, example IDs, observation URL |
| `references` | Every cited entry needed by exported records/features/observations: BibTeX type, original fields and WALS reference URL |
| Reference list item | `sourceId` and `pages` (original locator text, including ranges and qualifiers) |
| `examples` | Referenced source examples with source identity, text, analysis/gloss, translation, comment and URL |
| `provenance` | Snapshot, commit, actual file hashes/sizes, publisher citation/license, immutable source URL |
| `sourceNotices` | Attribution/adaptation notice, full upstream errata text and explicit policy of retaining published category assignments |
| `diagnostics` | Counts, observations per feature, absent/incomplete locations, sparse references and validation checks |

The export scope is 12A, 13A, 30A, 37A, 81A, 87A, and 92A. This is a selection
of features, not a card-selection policy. Editorial labels, English examples,
regional priorities and mounted UI are later stages. Catalog matching and session
contracts are implemented separately under `app/src/integrations/wals/`.
There are 5,517 exported observations, 33 categories, 46 cited examples and 5,915
referenced bibliography entries. All 935 varieties without shortlisted values
remain in `records`. Absence of an observation means missing data, not a category.

Validation runs over **all** 76,475 observations and 192 features before filtering.
It checks CSV structure, unique primary IDs, required fields and all declared
foreign keys, bibliography references, category/feature membership, matching
numeric codes, unique variety–feature pairs and coordinate ranges. Source-only
classification nodes (`family-`, `subfamily-`, `genus-` prefixes) are excluded;
observations attached to such nodes are rejected, not inherited by descendants.

The bibliography reader handles the normalized literal BibTeX in this release:
nested/escaped braces, quoted strings and numeric literals. It rejects duplicate
keys/fields, macros, concatenation and crossrefs instead of guessing. It is not a
general-purpose BibTeX parser. Five cited upstream entries have no title; retain
their supplied fields and source links, and expose that diagnostic rather than
inventing titles. LaTeX in bibliography fields remains literal source text.

Descriptive HTML becomes plain text, retaining textual qualifiers and omitting
scripts/styles. Render all strings as text, including decoded angle brackets,
LaTeX, and Markdown errata. Do not use `dangerouslySetInnerHTML` or treat source
fields as executable markup. Full original markup remains in the source archive.

[NOTICE.md](NOTICE.md) describes attribution, CC BY 4.0 and our adaptations.
The upstream errata include a correction for **Orok / 87A**, within this shortlist.
Published values are preserved with the errata; a later UI must expose the
caveats. This adapter does not silently apply editorial corrections.

## Tests and reconciliation

Ordinary tests use only small synthetic inputs:

```sh
uv run pytest -q pipeline/tests/test_wals.py pipeline/tests/test_wals_release.py
uv run ruff check pipeline/wals pipeline/tests/test_wals.py pipeline/tests/test_wals_release.py
```

The explicit snapshot gate requires restored real inputs and the historical
comparison. It never downloads data or requires a generated browser file:

```sh
python3 -m pipeline.wals.sources restore-comparison --from-git .
python3 -m pipeline.wals.snapshot
```

If the old commit is unavailable locally, omit `--from-git .` to retrieve its
four pinned files from immutable GitHub URLs. [comparison.json](comparison.json)
records their sizes/hashes. They stay under ignored
`data/wals/swedha-wals-cleaned/`, independently of the new build inputs.

The gate independently reconstructs **every column of every row** in the old
2,662-record language table, 76,475-row long observation table and 1,143-row
category codebook. It records complete added/removed/changed rows and field
values, plus hashes from the old audit. The reviewed snapshot has **zero semantic
differences**. Twelve CSV hashes differ only because the historical audit hashed
LF endings while the upstream files use CRLF; metadata JSON and bibliography
match byte for byte. The report verifies that explanation explicitly.

Expected counts live in [snapshot.json](snapshot.json). The report defaults to
`app/test-results/wals-01/snapshot.json`; unexpected counts, differences or
unexplained audit hashes fail the gate after saving its evidence. Updating a
source pin requires reviewing the report and any adapter/schema changes, not
merely replacing expected counts.

## Independent release delivery

The selected release is
[`wals-v2020.6-v1`](https://github.com/maximemulder/lang-viz/releases/tag/wals-v2020.6-v1),
published on 2026-11-12. `wals-release.json` pins it independently of the atlas and
lexical pins. The pin records release/schema/adapter versions, source snapshot and
commit, adapter producer commit, and complete archive/file byte sizes and SHA-256.
The producer is `edd09ee446c46f7bc1749fdfb5e8e4582722112d`, which contains the
unchanged adapter used to reproduce `features.json`. Delivery tooling can evolve
without changing that source-build identity.

| Asset | Contents | Deployment |
| --- | --- | --- |
| `wals-browser.tar.gz` | `features.json`, provenance/count/inventory `manifest.json`, upstream `sources.json`, attribution `NOTICE.md`, full upstream `LICENSE` and `ERRATA.md` | Restore to `app/public/wals/`; 849,232 compressed bytes |
| `wals-sources.tar.gz` | All 20 pinned extracted inputs, the complete `upstream.tar.gz`, `sources.json` and `NOTICE.md` | Separate recovery archive; 14,162,857 bytes; never deployed |

Restore prebuilt data without compiling or downloading raw inputs (Python 3.12+
and authenticated GitHub CLI):

```sh
python3 -m pipeline.wals.data_release restore
python3 -m pipeline.wals.data_release verify
python3 -m pipeline.wals.data_release restore --kind sources --output /tmp/wals-release-sources
```

The default source destination is `data/wals/wals-v2020.6/`. Use an unused output
when that directory already contains a source-only development restore. A release
installation includes additional source pin/notice files and has its own complete
inventory. Restoring an existing valid release directory is a no-op. Different,
modified, incomplete or linked installations are rejected and preserved. For an
older single-file browser build, move that directory aside after review and
restore into an absent destination; do not overlay individual release files.

Install an already downloaded asset offline:

```sh
python3 -m pipeline.wals.data_release install /path/to/wals-browser.tar.gz \
  --pin /path/to/wals-release.json --output /tmp/wals-browser
python3 -m pipeline.wals.data_release verify \
  --pin /path/to/wals-release.json --output /tmp/wals-browser
```

Installation authenticates the archive before extraction, rejects unsafe paths,
links, duplicates and wrong member sizes/sets, checks every extracted file and
cross-checks manifest versions, counts, notices and source provenance before an
atomic staged rename. Download/extraction/verification failures leave working data
intact. Verification never invokes the source adapter or touches geographic/lexical
releases. The browser and CI additionally validate runtime fields and joins.

The source asset can independently reproduce the browser data:

```sh
python3 -m pipeline.wals.build --source-dir /tmp/wals-release-sources \
  --output /tmp/reproduced-features.json
```

Its retained `upstream.tar.gz` also works with `pipeline.wals.sources restore
--archive`, independently of the extracted source copies or an upstream checkout.

To create a future release, commit and make the adapter producer available on
GitHub, explicitly restore/build the pinned sources, and choose a new tag/output:

```sh
python3 -m pipeline.wals.data_release pack \
  --tag wals-SNAPSHOT-vN --pipeline-commit FULL_ADAPTER_PRODUCER_COMMIT \
  --output .data-releases/wals-SNAPSHOT-vN
```

Packaging recompiles the source data, rejects a stale/modified browser payload,
creates deterministic tar/gzip bytes, and verifies both archives. It does not
update the selected pin. Review the complete candidate and checks before the
explicit publication command:

```sh
python3 -m pipeline.wals.data_release publish \
  .data-releases/wals-SNAPSHOT-vN/wals-release.json
```

Publication rejects an existing tag, uploads both archives and the pin to a draft,
then publishes with `--latest=false`; it never replaces another release. Only
successful publication updates the selected pin atomically. A failed publication
preserves the pin; an incomplete draft may remain and needs explicit review before
retrying. Retain old releases and pins. To roll back, select a retained pin and
install into a fresh directory, verify, then switch directories; an older pin must
not overwrite a newer or locally modified installation. This is the first WALS
release, so there is no earlier published WALS pin; fixture checks exercise a real
payload change followed by rollback to a retained prior fixture pin.

## Deployment and snapshot checks

The GitHub Pages workflow restores all three independent browser pins, then runs
`npm run test:wals-snapshot` before its `/lang-viz/` production build. No source
archive, historical comparison, source compilation, geographic preprocessing or
new release publication is involved. Missing/corrupt files fail before deployment.
Ordinary `npm test` stays fixture-only; no npm lifecycle hook downloads or compiles
WALS. Source reconciliation remains the separate explicit Python check above.

From `app/`, after restoring WALS and atlas data:

```sh
npm run test:wals-snapshot
```

This verifies the selected release, current source pin, all seven features and
counts, complete catalog associations and exact source-variety navigation. For
an isolated candidate, set `WALS_RELEASE_PIN` and `WALS_BROWSER_DATA` to explicit
paths. Associations are computed against the loaded atlas, never embedded in the
browser artifact, so a precomputed-join fingerprint is unnecessary.

The separate Firefox delivery check builds only a test consumer of the production
repository loader and exercises the actual Vite production base path:

```sh
python3 app/tests/browser/wals_delivery.py
```

It checks lazy/concurrent/cached loading, all served release notices, missing data,
invalid JSON/schema and retry under `/lang-viz/`. It loads no atlas/lexical data or
source archive and does not mount WALS UI in the application. Reports and screenshots
are ignored under `app/test-results/wals-03/`.
