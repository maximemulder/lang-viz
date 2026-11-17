# Administrative territory-language observations

The current statistical supplement is built from the pinned
[Unicode CLDR 49](https://cldr.unicode.org/index/downloads)
`supplementalData.xml` territory information. CLDR 49 is the source of every
territory population, language percentage, literacy value, containment,
official-status value, and derived speaker estimate in the browser asset. Its English locale
file supplies display names when a language lacks a reviewed Glottolog match.
The exact source URLs, byte counts, and SHA-256 hashes are in
[sources.json](sources.json).

The older prejoined CSV is retained only as a **reviewed mapping of CLDR
language codes to Glottolog 5.3**. Its original CLDR release and preprocessing
recipe remain unknown. `mapping.py` validates this mapping against the
pinned Glottolog catalog before the new builder uses it. A CLDR 49 language
code absent from that mapping is kept as a CLDR-only observation with a null
Glottocode and no invented family. This avoids dropping an entire territory
because a language association is unresolved.

| CLDR 49 audit | Count |
| --- | ---: |
| Territory records | 258 |
| Language observations | 1,630 |
| Distinct source language/script codes | 798 |
| Codes without a reviewed Glottolog match | 37 |
| Observations using those codes | 142 |
| Territories with no language observation | 1 (`ZZ`, unknown region) |
| Territories whose language percentages exceed 100% | 153 |

Libya (`LY`), Oman (`OM`), and Kuwait (`KW`) appear in the official CLDR
49 source and the rebuilt supplement. They were absent from the old prejoined
CSV. Somalia (`SO`) has observations; CLDR has no separate Somaliland
territory observation. Boundary associations are reviewed independently in
the [Natural Earth boundary package](boundaries/README.md).

CLDR calls these approximate functional language population estimates.
Percentages may overlap because people use multiple languages, and the
figures are not necessarily current or directly comparable. The exported
`speakerCount` is derived from CLDR territory population and language
percentage, not independently surveyed. Source numeric strings and
language/script rows are retained.

## Reproduction

```sh
uv run python -m pipeline.administrative.sources restore
uv run python -m pipeline.administrative.sources verify
uv run python -m pipeline.administrative.build build
uv run python -m pipeline.administrative.build verify
uv run pytest -q pipeline/tests/test_administrative.py
```

`restore` fetches pinned CLDR XML, the old mapping CSV, and the Glottolog
catalog into ignored `data/administrative/`. The CSV comes from a pinned Git
blob; a private GitHub checkout may require `GH_TOKEN`. The `--from-git`
option restores that blob from a local checkout instead. `build` and
`verify` do not use the network. The output is the ignored
`app/public/administrative/observations.json`, schema version 3.

The browser validates all territory, language, family, and atlas-association
references before showing the data. The supplement contains no geometry,
political border IDs, or language speaker locations. Glottolog coordinates
remain catalog metadata only.

Unicode CLDR uses the [Unicode License v3](https://github.com/unicode-org/cldr/blob/main/LICENSE);
Glottolog CLDF is [CC BY 4.0](https://github.com/glottolog/glottolog-cldf).
