# Wikidata language-data analysis

Extracted 2026-10-13 from the official Wikidata Query Service. Reproduce the
download with `pipeline/wikidata/download.sh` and the figures with
`python3 pipeline/wikidata/analyze.py`.

## What was downloaded

The extract starts from language-related Wikidata items with a valid Glottocode
(`P1394`). It uses four normalized CSV tables rather than one wide join:

| Table | Rows | Contents |
|---|---:|---|
| `languages.csv` | 11,955 | identifiers, English labels/descriptions, ISO 639 codes |
| `speaker_counts.csv` | 2,851 | `P1098` statements, dates, scope, place, rank and references |
| `official_status.csv` | 638 | country/territory `P37` statements, qualifiers, rank and references |
| `writing_systems.csv` | 2,749 | `P282` language–writing-system pairs |

The statement tables can contain several rows per statement because a statement
can have multiple references. Use `statement_id` when counting facts.

## Coverage and findings

- The language table contains 11,780 Wikidata items and 11,840 Glottocodes.
  Of these codes, 11,702 occur in the downloaded Glottolog: 8,167 languages,
  1,910 dialects, and 1,625 family nodes. This reaches 94.8% of Glottolog's
  language-level rows as an identity crosswalk.
- The crosswalk is not one-to-one. There are 82 Glottocodes linked to multiple
  Wikidata items and 137 Wikidata items linked to multiple Glottocodes. Another
  138 codes are absent from the local Glottolog version. Joins must therefore be
  checked rather than treated as a unique primary-key relation.
- After excluding four deprecated statements, speaker estimates cover 2,140
  Glottocodes, but only 20.7% of Glottolog language-level rows. Coverage is
  uneven: 31.5% in Eurasia and 33.9% in South America, versus 15.0% in Africa,
  15.7% in Australia, and 13.9% in Papunesia.
- Of 2,600 non-deprecated speaker statements, 68.0% have a point in time and
  51.1% have a source item or reference URL. The median date among dated
  statements is 2008, and 290 dated estimates predate 2000. There are 253
  languages with multiple estimates.
- Speaker scope is often underspecified: 2,016 statements have no `applies to
  part` qualifier, while 477 explicitly describe first-language speakers and 78
  second-language speakers. These values must not be added or compared blindly.
- Current, non-deprecated national/territorial official-language statements
  cover 259 Glottocodes across 250 jurisdiction items (249 distinct ISO 3166-1
  codes), with 525 distinct language–jurisdiction pairs. That is only 2.2% of
  Glottolog language-level rows, as expected for national official status. A qualifier such as
  Karachay-Cherkessia can preserve subnational scope even when the statement is
  attached to Russia.
- Writing-system data covers 2,021 Glottocodes and 17.6% of Glottolog
  language-level rows. Latin script is recorded for 1,343 language–system pairs,
  followed by Cyrillic (162), Devanagari (89), Arabic alphabet (84), and Arabic
  script (54). Wikidata distinguishes related script concepts, so categories
  such as “Arabic alphabet” and “Arabic script” should remain separate unless a
  deliberate hierarchy is introduced.

## Recommendation for the atlas

Wikidata is useful as an optional enrichment, not a complete demographic
backbone. It is strong enough to support a speaker-size layer and an official-
status filter, provided the interface makes missingness and estimate dates
visible.

For speaker-map sizing, first roll dialect values to the Glottolog language level
using the existing integration rule. Exclude deprecated statements; partition
estimates by scope and geographic qualifier; then select the newest sourced
estimate within each comparable scope. Do not automatically sum first- and
second-language values, and do not silently pick the largest estimate. A tooltip
should display year, scope, place, source, and all competing estimates.

For official status, use the country/territory extract as the default filter and
show `applies_to_part_name` when present. The present query intentionally
requires ISO 3166-1 (`P297`): an unrestricted `P37` query also returns thousands
of municipalities, organizations, schools, and historical entities and is not a
clean country-level dataset.

Wikidata changes continuously and its structured data is CC0. Freeze the CSVs
used for the final visualization and cite the retrieval date.
