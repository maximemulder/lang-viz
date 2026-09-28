# Datasets

Datasets used or considered for the project. See [OVERVIEW.md](OVERVIEW.md) for the project summary, and [ARCHITECTURE.md](ARCHITECTURE.md) for how they are combined.

All datasets live in `datasets/`. Every download command below is meant to be run **from the project root**.

```
datasets/
├── glottolog/          Glottolog, original repository (ini files)
├── glottolog-cldf/     Glottolog, CLDF export (CSV tables): easier to use
├── wals/
├── diacl/
└── glottography/
    ├── asher2007world/
    ├── carling2025diacl/
    └── bouckaert2012indoeuropean/
```

Figures in sections 1–4 were measured on the downloaded copies (September 2026). Figures in section 6 come from the projects' own documentation and still need checking.

**About CLDF.** Most of these datasets use CLDF (Cross-Linguistic Data Formats, https://cldf.clld.org): a set of CSV tables plus a JSON metadata file describing them. The main tables are always the same:

- `languages.csv`: one row per language;
- `parameters.csv`: features or concepts;
- `values.csv` or `forms.csv`: the data points;
- `codes.csv`: the possible values of each feature.

Each dataset's `cldf/README.md` lists every table and column. The Python library `pycldf` reads any CLDF dataset.

---

## 1. Glottolog

### 1.1 Description

Catalogue of the world's languages, dialects and families, with their classification. **This is the backbone of the project:** every other dataset links to it via the **Glottocode**, Glottolog's identifier (4 letters + 4 digits, e.g. `stan1293` for English).

- 27,254 languoids ("languoid" = any language, dialect or family): 8,625 languages, 13,758 dialects, 4,871 families. The tree is up to 27 levels deep.
- For each languoid:
  - name, Glottocode, ISO 639-3 code;
  - a coordinate point (8,315 languages have one);
  - macroarea (Africa, Eurasia, Papunesia, North America, South America, Australia) and countries;
  - **endangerment status**: not endangered 2,763 · threatened 1,650 · shifting 1,848 · moribund 438 · nearly extinct 316 · extinct 1,233 · unknown 377;
  - **most extensive description** (glottolog-cldf only): long grammar, grammar, grammar sketch, phonology/text, wordlist or less. This is a measure of how well documented a language is;
  - alternative names, including names in many languages (e.g. *Anglais*, *現代英語*);
  - first / last year of documentation for ~1,080 extinct languages;
  - links to other databases (WALS, Grambank, Lexibank, PHOIBLE, Wikidata, Wikipedia) and bibliography references.
- Largest families by number of languages: Atlantic-Congo (1,408), Austronesian (1,280), Indo-European (587), Sino-Tibetan (521), Afro-Asiatic (381).
- Website: https://glottolog.org. Licence: CC-BY-4.0.

**Caveats**

- The tree contains **pseudo-families** that are not real families and should usually be filtered out: *Bookkeeping* (380 entries), *Unclassifiable*, *Sign Language*, *Pidgin*, *Mixed Language*, *Artificial Language*, *Speech Register*, *Unattested*. In glottolog-cldf they are identified by the `category` value.
- No speaker counts, no territory shapes: one point per language.

### 1.2 Getting the data

Two versions of the same data. **Use glottolog-cldf** unless something is only in the original repository.

```sh
# CLDF export: plain CSV tables (146 MB)
git clone --depth 1 --single-branch https://github.com/glottolog/glottolog-cldf datasets/glottolog-cldf

# Original repository: one ini file per languoid (~500 MB, of which ~340 MB is bibliography)
git clone --depth 1 --single-branch --branch master https://github.com/glottolog/glottolog datasets/glottolog
```

Other formats: https://glottolog.org/meta/downloads

### 1.3 Data structure

**glottolog-cldf** (`datasets/glottolog-cldf/cldf/`)

| File | Content |
|---|---|
| `languages.csv` | One row per languoid (27,177) |
| `values.csv` | Per-languoid properties, one row per languoid × property |
| `parameters.csv` / `codes.csv` | The list of properties and their possible values |
| `names.csv` | 120,216 alternative names |
| `trees.csv` + `classification.nex` | Classification tree of each family, in Newick format |
| `sources.bib.zip` | Bibliography (zipped) |

`languages.csv` columns:

| Column | Meaning |
|---|---|
| `ID`, `Glottocode` | Glottocode (same value) |
| `Name` | Name |
| `Level` | `family`, `language` or `dialect` |
| `Family_ID` | Glottocode of the top-level family (empty for top-level families and isolates) |
| `Language_ID` | For dialects: Glottocode of the language they belong to |
| `Latitude`, `Longitude`, `Macroarea` | Location |
| `Countries` | ISO 3166 country codes, `;`-separated |
| `ISO639P3code` | ISO 639-3 code |
| `Is_Isolate` | Language with no known relatives |
| `First_Year_Of_Documentation`, `Last_Year_Of_Documentation` | For extinct languages |

`values.csv` columns: `Language_ID` (Glottocode), `Parameter_ID`, `Value`, `Code_ID` (→ `codes.csv`), `Source`. The properties (`Parameter_ID`) are:

| Parameter | Meaning | Values |
|---|---|---|
| `level` | family / language / dialect | `codes.csv` |
| `category` | Real family or pseudo-family, spoken L1 language, sign language, pidgin… | `codes.csv` |
| `classification` | Path from the family root to the languoid, as `/`-separated Glottocodes | string |
| `subclassification` | Subtree below the languoid, in Newick format | string |
| `aes` | Endangerment status | 1 not endangered → 6 extinct (`aes-…` codes) |
| `med` | Most extensive description | 0 long grammar → 4 wordlist or less (`med-…` codes) |
| `medovertime` | Descriptions over time (list of references) | string |
| `bib` | Linked references | `Source` column |

`names.csv` columns: `Language_ID` (Glottocode), `Name`, `Provider` (where the name comes from: `multitree`, `lexvo`, `wals`, `elcat`…), `lang` (language of the name, e.g. `fr` for *Anglais*, when known).

**Original repository** (`datasets/glottolog/`)

- `languoids/tree/`: **one folder per languoid, nested like the family tree.** The folder name is the Glottocode, so the path is the classification. Example for English: `indo1319/clas1257/germ1287/…/stan1293/md.ini`.
- Each folder has an `md.ini` file with these sections:

  | Section | Main keys |
  |---|---|
  | `[core]` | `name`, `level`, `iso639-3`, `hid`, `latitude`, `longitude`, `macroareas`, `countries`, `links`, `timespan` (extinct languages) |
  | `[endangerment]` | `status`, `source`, `date`, `comment` |
  | `[altnames]` | Alternative names, one key per provider (`multitree`, `lexvo`, `wals`, `elcat`, `ruhlen (1987)`, `moseley & asher (1994)`…) |
  | `[identifier]` | IDs in other databases: `wals`, `multitree`, `endangeredlanguages`, `languagelandscape` |
  | `[classification]` | `sub`, `family`: references justifying the classification |
  | `[sources]` | `glottolog`: bibliography keys |
  | `[iso_retirement]`, `[hh_ethnologue_comment]`, `[triggers]` | Glottolog maintenance data; not needed |

  Multi-value keys (countries, macroareas, names) are written one per line, indented. Python's `configparser` reads the files.
- `languoids/superseded.csv`: Glottocodes that were retired, with their replacement.
- `languoids/languages_*.md`, `dialects_*.md`, `families_*.md`: generated alphabetical indexes.
- `config/macroareas/voronoi/*.geojson`: **polygon of each macroarea**, usable as a background layer on the map.
- `config/*.ini`: definitions of levels, endangerment statuses, document types, macroareas.
- `references/`: bibliography (43 BibTeX files, ~340 MB).

---

## 2. WALS: World Atlas of Language Structures

### 2.1 Description

Grammatical and phonological features of languages, with categorical values, compiled by ~55 specialists (one chapter per feature).

- **192 features** in 11 areas:
  - word order 56
  - nominal categories 29
  - simple clauses 26
  - phonology 20
  - verbal categories 17
  - lexicon 13
  - morphology 12
  - nominal syntax 8
  - complex sentences 7
  - sign languages 2
  - other 2
- **76,475 data points** for **2,662 languages**.
- 3,907 glossed example sentences; the full text of each chapter.
- Website: https://wals.info. Licence: CC-BY-4.0.

**Caveats**

- **Very sparse: only 11% of the language × feature matrix is filled.** The median language has 19 features; only 158 languages have 100 or more; 787 have 5 or fewer. The median feature covers 257 languages (min 5, max 1,518).
- WALS defines two curated samples of 100 and 200 languages (`Samples_100`, `Samples_200`), which are much denser.
- WALS uses **its own language codes** (e.g. `eng`); the Glottocode is a separate column.
- 911 of the 3,573 rows in `languages.csv` are family / genus nodes, not languages (empty `Glottocode`, `Latitude`, `Macroarea`).

### 2.2 Getting the data

```sh
git clone --depth 1 --single-branch --branch master https://github.com/cldf-datasets/wals datasets/wals
```

Other formats: https://wals.info/download

### 2.3 Data structure

The CLDF data is in `datasets/wals/cldf/` (`raw/` holds the original database export, not needed).

| File | Content |
|---|---|
| `values.csv` | **The data**: one row per language × feature (76,475) |
| `languages.csv` | Languages, plus family / genus rows (3,573) |
| `parameters.csv` | Features (192) |
| `codes.csv` | Possible values of each feature (1,143), with a suggested colour |
| `chapters.csv`, `areas.csv` | Chapters (one per feature or group of features) and the 11 areas |
| `examples.csv` | Glossed example sentences (3,907) |
| `language_names.csv` | Alternative names (7,377) |
| `countries.csv` | Country codes and names |
| `genealogy.csv` + `genealogy.nex` | WALS family / genus trees (Newick) |
| `docs/chapter_*.html` | Full text of each chapter |
| `sources.bib` | Bibliography |

Main columns:

- `values.csv`
  - `Language_ID` → `languages.ID` (WALS code)
  - `Parameter_ID` → `parameters.ID` (e.g. `81A`)
  - `Value` (the value number)
  - `Code_ID` → `codes.ID` (e.g. `81A-2`)
  - `Source`, `Comment`, `Example_ID` → `examples.ID`
- `languages.csv`
  - `ID` (WALS code), `Name`, `Glottocode`, `ISO639P3code`
  - `Latitude`, `Longitude`, `Macroarea`, `Country_ID`
  - `Family`, `Subfamily`, `Genus`
  - `Samples_100`, `Samples_200` (`true` / `false`)
  - `Parent_ID` → the genus / family row in the same file
- `parameters.csv`: `ID` (e.g. `81A`), `Name` (e.g. *Order of Subject, Object and Verb*), `Chapter_ID` → `chapters.ID`
- `codes.csv`
  - `ID` (e.g. `81A-2`), `Parameter_ID`
  - `Name` (e.g. *SVO*), `Description`
  - `Number` (order within the feature)
  - `icon` (suggested colour, e.g. `c0000dd`)
- `chapters.csv`: `ID`, `Name`, `Area_ID` → `areas.ID`, `Contributor`, `Citation`
- `examples.csv`
  - `Language_ID`
  - `Primary_Text`, `Analyzed_Word`, `Gloss` (tab-separated, word by word)
  - `Translated_Text`

**Typical join**: `values` ⋈ `codes` (value label) ⋈ `parameters` (feature name) ⋈ `languages` (Glottocode, location).

---

## 3. DiACL: Diachronic Atlas of Comparative Linguistics

### 3.1 Description

Vocabulary of modern, historical and reconstructed (proto-) languages, with the history of each word.

- **422 varieties**, including historical and proto-languages (Proto-Germanic, Vulgar Latin, Old Danish…), all with coordinates.
  - Families: Indo-European 161, Austronesian 109, Nakh-Daghestanian 18, Tupian 15, Sino-Tibetan 12, Turkic 9, and a few others.
  - Regions: Eurasia 219, Papunesia 106, South America 44.
- **Word lists** (542 concepts in total, all linked to Concepticon):
  - Swadesh 100 / 200 (basic vocabulary);
  - culture words for Indo-European, Austronesia, the Caucasus, Basque, Uralic, Turkic, South America and the ancient Middle East, e.g. *wheel, wine, gold, plough, honey*;
  - colour terms for Eurasia.
- **60,206 word forms** (median ~105 per variety).
- **47,413 word-history links** (parent word → child word) for ~660 concepts, each labelled:

  | Label | Links |
  |---|---|
  | unspecified | 33,337 |
  | inherited | 11,579 |
  | certainly borrowed | 1,053 |
  | derivation | 1,030 |
  | uncertain origin | 250 |
  | probably borrowed | 138 |
  | Wanderwort (word spread widely by trade) | 26 |

- Date ranges (e.g. 1750–2000, 1250–1750) for 363 of the 422 varieties.
- Website: https://diacl.ht.lu.se (see also https://diacl.uni-frankfurt.de). Licence: CC-BY-4.0.

**Caveats**

- **The CLDF export drops the word-history links (its `Cognacy` and `Loan` columns are empty) and most date ranges.** These exist only in `raw/` (see 3.3).
- 51 varieties have no Glottocode, mostly proto-languages. DiACL language IDs are numbers (e.g. `33500`).

### 3.2 Getting the data

```sh
git clone --depth 1 --single-branch --branch master https://github.com/lexibank/diacl datasets/diacl
```

This is the CLDF version curated by Lexibank. It includes the original DiACL export in `raw/` (downloaded from DiACL in 2019).

### 3.3 Data structure

**CLDF export** (`datasets/diacl/cldf/`)

| File | Content |
|---|---|
| `forms.csv` | Word forms (60,206) |
| `languages.csv` | Varieties (422) |
| `parameters.csv` | Concepts (542) |
| `sources.bib` | Bibliography |

Main columns:

- `forms.csv`
  - `Language_ID` → `languages.ID`
  - `Parameter_ID` → `parameters.ID`
  - `Value` (form as in the source), `Form` (cleaned form)
  - `meaning`, `meaning_note`, `transliteration`
  - `Source` → `sources.bib`
  - Empty: `Cognacy`, `Loan`, `Segments`, `ipa` (almost)
  - `diacl_id` is a running number, **not** the original DiACL word ID.
- `languages.csv`
  - `ID` (DiACL number), `Name`
  - `Glottocode`, `Glottolog_Name`, `ISO639P3code`
  - `Latitude`, `Longitude`, `Macroarea`, `Family`
  - `time_frame` (mostly empty)
- `parameters.csv`
  - `ID` (e.g. `51_stone`)
  - `Concepticon_ID`, `Concepticon_Gloss`
  - `DIACL_ID`: the original word-list item ID, also used as key in `etymology.json.gz`

**Raw export** (`datasets/diacl/raw/`): needed for word histories and dates.

- `WordLists.json`: word lists → categories → items (`{item_id: {Name, Note}}`).
- `wl{N}.xml`: one file per word list N (1 = Swadesh, 2 = South America, 3 = Indo-European, 4 = Austronesia, 5 = Caucasus, 6 = Basque, 7 = colour terms, 9 = Uralic, 10 = ancient Middle East, 11 = Turkic). Each file contains:
  - `<language language-id="…">`: name, alternative names, ISO code, `<focal-point>` (latitude / longitude), **`<time-frame><from>…</from><until>…</until></time-frame>`**;
  - `<lexeme lexeme-id="…">`: `language-id`, `form-transcription`, `form-transliteration`, `form-ipa`, `semantics/meaning`, `sources`;
  - `<word-list-item word-list-item-id="…">` with `<lexeme-connections>`: which words (lexeme IDs) belong to which concept.
- `etymology.json.gz`: **word-history links**, as a dict keyed by word-list item ID (= `DIACL_ID`). Each entry has:

  | Key | Content |
  |---|---|
  | `wordListItem` | Concept name |
  | `etymologies` | `{link_id: {FkParentId, FkChildId, FkReliabilityId, NoteNoMarkup}}`: parent and child are lexeme IDs |
  | `reliabilities` | Label of each `FkReliabilityId` (0 unspecified, 1 inherited, 2 probably borrowed, 4 certainly borrowed, 8 uncertain origin, 16 Wanderwort, 32 derivation) |
  | `connectedLexemesById` | All lexeme IDs involved |

  40,605 of the 46,582 lexeme IDs involved can be matched to lexemes in the XML files (and so to a language and a form).
- `LanguageTree.json`: DiACL's own family tree: nested `{NodeName, NodeId, children}`; `FkLanguageId` → `language-id`.

---

## 4. Glottography (language territories)

### 4.1 Description

Polygons of the areas where languages are spoken, digitised from published maps and linked to Glottocodes.

- Paper: *Glottography: an open-source geolinguistic data platform for mapping the world's languages*, Journal of Open Humanities Data 12(47), March 2026. https://doi.org/10.5334/johd.459
- GitHub: https://github.com/Glottography. Zenodo community (versioned releases): https://zenodo.org/communities/glottography
- Tools: `pyglottography` (Python), `Rglottography` (R; its `inst/extdata/registry.json` lists all datasets).

**Overall** (from the paper):

- 29 source publications, 17,114 polygons, 7,562 distinct Glottolog entries.
- Grouped into 13,303 language areas for 5,338 distinct languages, and 1,390 family areas for 394 families.
- About 65% of the ~8,300 Glottolog languages with coordinates have at least one polygon.
- **Known gaps:** Mesoamerica, Europe, Papua New Guinea, West Africa, India, Southeast Asia.
- **Sources can disagree:** a language may have several polygons from different sources, all kept as separate interpretations.

**There is no single combined download**; each source is its own repository. The relevant ones (**bold = downloaded**):

| Repository | Content | Licence |
|---|---|---|
| **[asher2007world](https://github.com/Glottography/asher2007world)** | Moseley & Asher, *Atlas of the World's Languages* (2007). Global. *Contemporary* areas, plus *traditional* (time-of-contact) areas for the Americas and Australia | CC-BY-4.0 |
| **[carling2025diacl](https://github.com/Glottography/carling2025diacl)** | DiACL/TITUS polygon archive: areas for DiACL languages, mostly dated 1750 | CC-BY-4.0 |
| **[bouckaert2012indoeuropean](https://github.com/Glottography/bouckaert2012indoeuropean)** | Approximate ranges for modern **and ancient** Indo-European languages (from Bouckaert et al. 2012, *Science*) | CC-BY-4.0 |
| [grierson1903lsi](https://github.com/Glottography/grierson1903lsi) | Linguistic Survey of India (c. 1900); ~900 MB | CC-BY-4.0 |
| [wurm1981pacific](https://github.com/Glottography/wurm1981pacific) | Language Atlas of the Pacific Area: detailed Pacific and Southeast Asia | **CC-BY-NC-4.0** |
| [wikipedia2024officiallang](https://github.com/Glottography/wikipedia2024officiallang) | Official-language areas by country | CC-BY-4.0 |

About 20 further repositories cover smaller regions (mostly South America, Australia, North America). A few do not state a licence: check before use.

**Measured coverage** of our language sets by the downloaded repositories. Glottolog and Eurasia percentages are over Glottolog languages (8,625); WALS and DiACL counts are over their distinct Glottocodes.

| Repository / layer | Languages with polygons | Glottolog | Eurasia | WALS (2,502) | DiACL (351) |
|---|---|---|---|---|---|
| asher2007world, contemporary | 4,251 | 47% | 35% | 1,554 | 205 |
| asher2007world, traditional | 4,729 | 52% | 35% | 1,780 | 203 |
| carling2025diacl | 925 | 9% | 9% | 602 | 149 |
| bouckaert2012indoeuropean | 74 | 1% | 3% | 48 | 61 |
| **All three combined** | | **54%** | **37%** | **1,887 (75%)** | **256 (73%)** |

- About three quarters of WALS and DiACL languages get a polygon, so **polygons can be the main map layer, with points for the rest.**
- **Eurasia is the weak spot (37%).** grierson1903lsi (South Asia) and wurm1981pacific (Southeast Asia) would help.
- The files are large (asher2007world `languages.geojson`: 93 MB contemporary, 53 MB traditional) and must be simplified before use in the browser.

### 4.2 Getting the data

```sh
git clone --depth 1 https://github.com/Glottography/asher2007world datasets/glottography/asher2007world                         # 534 MB
git clone --depth 1 https://github.com/Glottography/carling2025diacl datasets/glottography/carling2025diacl                     # 124 MB
git clone --depth 1 https://github.com/Glottography/bouckaert2012indoeuropean datasets/glottography/bouckaert2012indoeuropean   # 37 MB
```

Other repositories follow the same pattern: `git clone --depth 1 https://github.com/Glottography/<name> datasets/glottography/<name>`.

### 4.3 Data structure

All Glottography repositories share the same layout. Data is in `cldf/`; asher2007world has two sub-datasets, `cldf/contemporary/` and `cldf/traditional/`, with the same files. (`raw/` and `etc/` hold the source material and are not needed.)

| File | Content |
|---|---|
| `features.geojson` | **Original polygons** as drawn in the source (asher2007world contemporary: 5,509) |
| `languages.geojson` | Polygons **merged per language** (Glottolog language level) (asher2007world contemporary: 4,062) |
| `dialects.geojson` | Polygons merged per dialect (carling2025diacl, bouckaert2012 only) |
| `families.geojson` | Polygons **merged per top-level family** (asher2007world contemporary: 284) |
| `languages.csv` | One row per languoid with a polygon |
| `contributions.csv` | Source maps and original polygons, with year |
| `media.csv` | List of the GeoJSON files above |
| `sources.bib` | Bibliography |

All geometries are `Polygon` or `MultiPolygon` in WGS84 (longitude / latitude).

GeoJSON properties:

- `features.geojson`
  - `id` (feature ID), `name` (name as written on the source map)
  - `cldf:languageReference` (**Glottocode**)
  - `year` (map year, e.g. `2007`)
  - `map_name_full`, `maps` (source map), `note`
- `languages.geojson`, `dialects.geojson`, `families.geojson`
  - `cldf:languageReference` (**Glottocode**)
  - `title` (name), `family`
  - `fill`, `fill-opacity` (suggested style)

CSV columns:

- `languages.csv`
  - `ID` / `Glottocode`, `Name`, `Family`
  - `Latitude`, `Longitude` (Glottolog point)
  - `Glottolog_Languoid_Level`
  - `Speaker_Area` (which GeoJSON file holds its merged polygon: `languages` or `dialects`)
  - `Feature_IDs` (IDs of the original polygons in `features.geojson`)
  - `Maps` (asher2007world: source map names)
- `contributions.csv`
  - Rows with `Type` = `map`: the source maps.
  - Rows with `Type` = `feature`: one per original polygon, with `ID` (= feature `id`), `Name`, `Glottocode`, `Year`, `Source`, `Map_IDs`.

---

## 5. How the datasets link

**Common language key: the Glottocode.**

| Link | Via | Coverage |
|---|---|---|
| WALS → Glottolog | `languages.csv` → `Glottocode` | 2,645 / 2,662 languages (2,562 at language level, 46 dialects, 37 family nodes) |
| DiACL → Glottolog | `languages.csv` → `Glottocode` | 371 / 422 varieties (340 languages, 29 dialects, 2 family nodes) |
| WALS ∩ DiACL | shared Glottocode | ~205 languages: Indo-European 74, Austronesian 69, Nakh-Daghestanian 18, Turkic 8, Sino-Tibetan 8, … |
| Glottography → Glottolog | `cldf:languageReference` in GeoJSON; `Glottocode` in CSV | every polygon; coverage in section 4.1 |

- The 51 DiACL varieties without a Glottocode are mostly proto-languages. They can be matched by hand to Glottolog family nodes (e.g. Proto-Germanic → `germ1287`).
- Data recorded at dialect level can be moved up to its language with glottolog-cldf's `Language_ID` column (or the `classification` path).
- **Common concept IDs: Concepticon** (https://concepticon.clld.org). Word-list datasets tag concepts with shared IDs (`Concepticon_ID`), so "stone" in DiACL is the same concept as "stone" in WOLD or Lexibank.

The decisions needed to actually combine the datasets (level mismatches, disagreeing sources, time) are in [ARCHITECTURE.md](ARCHITECTURE.md#2-integration-rules).

---

## 6. Candidates (not downloaded; figures to verify)

All use the Glottocode as language identifier, and all except Wikidata are in CLDF.

| Dataset | Adds | Would feed | Links |
|---|---|---|---|
| **Grambank** | ~195 grammatical features for ~2,400 languages; much denser than WALS | Feature explorer, possibly as main grammar source | https://grambank.clld.org, https://github.com/grambank/grambank |
| **PHOIBLE** | Sound inventories for ~2,000 languages | "How languages sound" view | https://phoible.org, https://github.com/cldf-datasets/phoible |
| **WOLD** | Loanwords by meaning in 41 languages | Borrowing view, next to DiACL | https://wold.clld.org, https://github.com/lexibank/wold |
| **Lexibank** | Collection of ~100 standardised word-list datasets | Cross-language word comparison | https://lexibank.clld.org |
| **NorthEuraLex** | ~1,000 concepts for ~100 languages of northern Eurasia | Same, denser for Eurasia | https://github.com/lexibank/northeuralex |
| **Wikidata** | Speaker counts, official status, writing systems (Glottocode property P1394) | Map sizing and filters: Glottolog has no speaker counts | https://www.wikidata.org |

---

## 7. Licences

- CC-BY-4.0 for everything planned, except **wurm1981pacific (CC-BY-NC-4.0)**, which is acceptable for a course project.
- Every dataset used must be credited in the app and the report, using each project's citation instructions (README or `.zenodo.json`).
