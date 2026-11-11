# Lexical data and domain port

The lexical adapter, independent release commands, and browser domain helpers
share a pinned source contract. The atlas pipeline and schema remain independent.
Port reference: `58a6c1a2a8a2ef02f433576bf15cd7b0e09c57fe`.

## Reproduce the reviewed snapshot

From the repository root, with Python 3.12+ (standard library only):

```sh
python3 -m pipeline.etymology.sources restore
python3 -m pipeline.etymology.build
```

Restoration reads immutable GitHub commit URLs, verifies sizes and SHA-256, and
installs the complete source directory only after both files verify. The original
DiACL export URLs are provenance, not download targets: those may change over time.
If the feature commit already exists in a local clone, restoration can run offline:

```sh
python3 -m pipeline.etymology.sources restore --from-git .
python3 -m pipeline.etymology.sources verify
```

The default input directory is `data/etymology/diacl-2026-10-24/`, outside Git.
Restoring an existing valid directory is a no-op. A modified/invalid directory is
reported and preserved; choose another `--output` directory to restore a clean copy.
Use the builder's `--source-dir` for a non-default source directory.

[sources.json](sources.json) records exact file paths, byte sizes, checksums,
upstream URLs, export timestamps, attribution, and the placeholder source ID.
It recovers the supplied exports from the original commit without merging or
copying the large data files into the port's history. The independent lexical
release also archives both files; either recovery path verifies their exact hashes.

The sources are the complete lexical export from 2026-10-24T05:04:49Z and the
language tree from 2026-10-23T06:58:27Z. Attribution follows the supplied prototype:
Carling, Gerd (ed.), *Diachronic Atlas of Comparative Linguistics Online*, Goethe
University Frankfurt. Original bibliographic citations remain attached to words
and relationships. The publisher's [CompLing portal](https://compling.eu/) declares CC BY-NC-SA 4.0
for the databank. The [lexical source notice](../../app/public/licenses/DIACL-LEXICAL-NOTICE.md)
records that declaration, attribution, export dates, and our adaptations. The
exports contain no snapshot-specific license; the notice uses the publisher's
databank-level terms, independently of polygon data licensing.

## Compilation contract

The builder writes ignored `app/public/etymology/word-trails.json`. It validates
every build and compares serialized content before replacing the previous file
atomically. It never trusts input modification times. Rebuilding identical inputs
leaves identical bytes and preserves the output modification time. Validation or
replacement failures leave the previous bundle intact.

Default builds require the pinned snapshot. For deliberately different exports,
`--unpinned` retains structural/join validation but records `snapshot: null` in
provenance. Custom inputs do not satisfy the reviewed-snapshot integration check.

Schema version **1**, adapter version **1**:

| Field | Contract |
| --- | --- |
| `languages` | Lexeme-bearing DiACL languages, keyed by decimal string ID; lexical IDs are separate from atlas IDs |
| Language record | Name, ISO/Glottocode or empty string, focal `lat`/`lon` or null, status, optional integer `From`/`Until`, tree path and family |
| `lexemes` | Decimal string ID → `l` language ID, `f` plain form, meaning/notes/grammar/IPA/script strings, `refs`, `stub` |
| `edges` | Unique source `id`, parent `p`, child `c`, declared numeric type `t`, relationship `refs` and note |
| `concepts` / `lists` | Concepts retain collection/category memberships and deduplicated word IDs; shared meaning is not inferred cognacy |
| `sources` / `types` | Original citations and declared relationship labels, including Unspecified; no relabeling as confirmed inheritance |
| `meta` / `provenance` | Original lexical metadata, both input hashes/metadata, snapshot, adapter version, attribution and placeholder source ID |
| `diagnostics` | Language IDs and reasons for omitted incomplete focal points |

Missing/null optional text becomes an empty string. Missing points remain null;
zero is valid. Incomplete coordinate pairs are omitted with a diagnostic; invalid
or nonfinite coordinates fail. Word-language, relationship endpoint/type/source,
and concept-word joins must resolve. Tree node IDs and language placements must
be unique and tree language references must resolve. Invalid JSON, duplicate keys,
wrong field types, reversed time intervals, and conflicting concept names fail
explicitly, including under `python -O`.

The reviewed snapshot has 74,635 words, 46,351 relationships, 466 lexical language
records, and 1,269 concepts. These counts are integration expectations, not limits
or generic schema rules. Languages without words remain in the archived raw input;
the complete lexical catalog means all 466 lexeme-bearing records, without UI or
geographic filtering.

## Domain behavior and checks

`app/src/domain/etymology.ts` owns indexing, accent-insensitive search, traversal,
and identifier matching. `wordTrailLayout.ts` and `wordTrailGeography.ts` are pure
helpers without React, MapLibre, or browser state dependencies.

An exact Glottocode matches current atlas **classification metadata**, even when
the atlas catalog key differs. An explicit unmatched Glottocode never falls back
to ISO. ISO fallback requires uniqueness in both complete catalogs. Reverse
navigation requires a unique exact Glottocode and rejects source classifications.

Traversal retains multiple parents and cycles, stops at hidden placeholders,
and caps displayed forms at 60. It reports distinct omitted forms. Explicit
expansions apply only to reachable forms and nested expansion restoration is
independent of the expansion set's insertion order. Relationship geometry uses
focal points, not reconstructed migration routes; missing points leave graph
membership intact. Antimeridian links split into bounded segments.

Lightweight checks use synthetic inputs and require no lexical downloads:

```sh
.venv/bin/python -m pytest pipeline/tests/test_etymology.py
cd app
node --test --test-isolation=none tests/etymology.test.ts
npm test
```

After restoring/building lexical data **and** restoring current atlas data, run
from `app/`:

```sh
npm run test:etymology-snapshot
```

That explicit integration command fails if data is missing. It checks source
hashes/counts, the English → Middle English → Old English → Proto-Germanic → Latin
wine chain and its separate borrowing evidence, geographic helpers, and English
matching against the current atlas catalog. No npm lifecycle hook prepares data.

## Independent release delivery

`etymology-release.json` pins the lexical release independently of `data-release.json`.
Its schema version, lexical schema/adapter versions, snapshot, producer commit,
and two asset inventories include archive and individual file sizes/SHA-256.
The browser archive contains `word-trails.json`, `manifest.json`, `sources.json`,
and `NOTICE.md`. The manifest records counts, complete provenance, and hashes of
its other files. The separate source archive contains the unchanged raw JSON,
the source pin, and notice. The raw archive is not copied into the deployed site.

**Review status:** `word-trails-diacl-2026-10-24-v1` is prepared locally but has
not been published. The commands below that download from GitHub require that
publication first. The checked-in pin is the exact candidate, not a claim that
the remote release exists. Publish before merging the deployment change.

Once published, restore without compiling sources (Python 3.12+, authenticated
GitHub CLI for the repository):

```sh
python3 -m pipeline.etymology.data_release restore
python3 -m pipeline.etymology.data_release verify
python3 -m pipeline.etymology.data_release restore --kind sources --output /tmp/word-trails-sources
```

Browser destination: `app/public/etymology/`; source destination when omitted:
`data/etymology/diacl-2026-10-24/`. Existing installations must match the complete
selected release; valid directories are a no-op and different/modified ones are
preserved with an error. For a different pin or an older single-file development
build, choose an unused `--output`, review it, and move the old directory aside
before installing at the default path. Roll back by selecting an earlier pin
and installing it into a fresh directory. Keep referenced releases available.

To review this candidate offline from the repository root:

```sh
python3 -m pipeline.etymology.data_release install \
  .data-releases/word-trails-diacl-2026-10-24-v1/word-trails.tar.gz \
  --output /tmp/word-trails-browser-review
python3 -m pipeline.etymology.data_release verify --output /tmp/word-trails-browser-review
```

For a new release, first commit adapter changes, restore the pinned sources, and
build explicitly. Packaging reproduces the source build and rejects a stale or
modified compiled bundle. Normal restoration never calls the source adapter.

```sh
python3 -m pipeline.etymology.data_release pack \
  --tag word-trails-SNAPSHOT-vN --pipeline-commit FULL_BUILD_COMMIT \
  --output .data-releases/word-trails-SNAPSHOT-vN
```

Use an unused tag and output directory. Packaging verifies both archives and
writes deterministic gzip/tar metadata. Installation checks the archive, member
names/types/sizes, complete file set, each file hash, manifest/schema/provenance,
and source hashes before renaming a staged directory into place. Invalid or
interrupted downloads/extractions do not replace working data. Full field and
join validation also runs in the browser worker and explicit CI snapshot check.

After reviewing the archives and approving publication, first push the producer
commit to the repository (the port branch includes it), then:

```sh
python3 -m pipeline.etymology.data_release publish \
  .data-releases/word-trails-diacl-2026-10-24-v1/etymology-release.json
```

Publication verifies both local archives, uploads a draft with the pin and source
notice, publishes without making it the repository's latest application release,
and only then updates the selected pin. Failed publication preserves the selected
pin; an incomplete draft may require removal before retrying. The GitHub Pages
workflow restores both independent pins, runs the explicit lexical snapshot gate,
and builds with `/lang-viz/`. It never restores raw sources or preprocesses them.

## Browser preparation and measurement

The lexical JSON remains one lazy payload. Its response bytes transfer to a
short-lived module worker for decoding, parsing, runtime validation, and indexing.
The prepared repository returns through structured clone, then stays cached for
workspace round trips. Failed fetches or preparation attempts are retryable.
Search uses one cached numeric collator to preserve deterministic ranking without
recreating expensive collation options for each comparison.

From `app/`, `npm run measure:etymology-browser` builds and measures the production
app. See [browser measurements](../../app/tests/browser/README.md) and the ETY-05
execution record for device, cache/network settings, budgets, results, and limits.
