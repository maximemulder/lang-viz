# WALS source adapter

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
regional priorities, atlas matching and profile navigation are later stages.
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
uv run pytest -q pipeline/tests/test_wals.py
uv run ruff check pipeline/wals pipeline/tests/test_wals.py
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

Independent browser release packaging, restore pins, deployment integration and
frontend loading are WALS-03/WALS-02 work. No npm hook restores or compiles WALS.
