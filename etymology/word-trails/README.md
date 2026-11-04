# Word Trails

A working etymology explorer for a Data Visualization midterm critique. Browser-local JavaScript, CSS and HTML; no framework or build step.

## Run locally

**Easiest for the critique:** double-click `OPEN-ME.html`, or open it in Safari, Chrome, Firefox or Edge. It is a self-contained copy: the code, dataset and basemap are all included, with no server, installation or Internet connection required. It uses system fonts for offline reliability.

**For development:** on macOS, double-click `start.command` in this folder. Then open http://127.0.0.1:8765.

Alternatively, from this folder:

```sh
python3 -m http.server 8765 --bind 127.0.0.1 --directory dist
```

Keep the server running for the development version. Stop it with Control-C. If port 8765 is already in use, use another port and open the corresponding address. The development `dist/index.html` uses separate assets and needs the local server for its map. `OPEN-ME.html` does not.

## A three-minute critique demo

1. Start with **wine**. Identify the English entry, then follow its recorded path backward.
2. Select **Proto-Germanic *wīnan**, then its **Certainly borrowed ← Latin** relationship. Inspect the relationship references and distinguish them from word-entry references.
3. Switch to **Family comparison**. Compare forms grouped by family and major branch. Explain that concept membership and cognacy are different.
4. Switch to **Language map**. The locations belong to languages, not exact historical borrowing events.
5. Try **water**, then enable **Placeholders**. Discuss why an incomplete record should remain visibly incomplete.
6. Search for another word, meaning, or language. Choose a result and trace its connections.

## Interactions

- Full-data search (form, meaning, language), keyboard shortcut `/`, arrow-key search navigation.
- Directed graph with word and edge selection, configurable ancestry depth, optional neighboring branches and placeholders.
- Drag empty graph space to pan. Use zoom buttons or Control/Command + wheel to zoom. **Fit view** resets the camera.
- **Trace this word** recenters the history. **Expand connections** adds the entry's incoming and outgoing neighbors.
- Family and major-branch grouping, concept browsing, and explicit missing-entry states.
- A bundled world basemap with language focal points and linked lexical relationships. Use the language buttons to select overlapping historical stages.
- Separate word-entry and relationship evidence, source notes, reconstruction and placeholder labels.
- Responsive layouts and a printable layout. URL fragments preserve the focused word and selected view.

## Data and processing

`dist/data.js` is generated from the user-supplied DiACL lexical export and language tree. It contains all **74,635 lexemes**, **46,351 relationships**, and **466 lexical language records**. The original language table has 3,784 records; records without lexical entries are not included in the prototype's comparison scope. **450** lexical language records map to the supplied tree; the other 16 stay in “Unmapped in tree.”

The separate word-list structure matches the lexical export. The prototype uses the lexical export's matching concept hierarchy and `ConnectedLexemes` arrays. The 422-row CSV is a subset and does not replace the export's language metadata. The Austronesian grammar export is reserved for future work; no grammatical similarity is used to infer etymology.

To rebuild browser data, run `python3 rebuild-data.py`. The script reads the exports from `../data/`.

After editing the source files, run `python3 package-offline.py` to refresh `OPEN-ME.html`.

## Deliberate limits

- Each graph is capped at 60 forms. Initial neighboring branches show at most two per ancestor; expand a selected node for more. This is a readability choice, not a complete census of descendants.
- “Earlier steps” counts recorded relationships, not years. Nodes are laid out by graph structure; some links skip intermediate forms. Multiple parents and cyclic records remain possible.
- Placeholders are hidden initially. The interface reports when they interrupt a path. Hidden nodes are never replaced with invented shortcut links.
- Missing links, entries and categories are distinct. Missing data does not establish absence of a historical relationship.
- Family comparison lists every recorded non-placeholder form for the selected concept, including multiple synonyms. Labels count incoming relationships; they are not language-level borrowing rates or confidence scores.
- Map lines are connections between representative language focal points, not historical routes. Antimeridian-spanning links are omitted from the map rather than drawn across the whole world; the graph retains them.
- No accounts, analytics, uploads, external APIs or user-data storage. Dataset processing and search run in the browser. Google Fonts is optional and falls back to system fonts when unavailable; data and the basemap are bundled.

## Validation

Checked all word-language, relationship-endpoint, source-reference and concept-word joins. Verified the Latin → Proto-Germanic → Old English → Middle English → English wine chain against the original export. Browser checks of the development version covered word and relationship selection, references, full-data search, concept comparison, placeholder visibility, and the bundled map. Checked desktop and narrow-screen layouts; the 390px layout has no horizontal page overflow. The self-contained copy uses the same code and data and passed packaging/syntax checks; direct file-URL testing was unavailable in the testing browser.

## Sources and attribution

- Carling, Gerd (ed.). *Diachronic Atlas of Comparative Linguistics Online*. Goethe University Frankfurt. https://diacl.uni-frankfurt.de/
- DiACL documentation: https://compling.eu/diacl/
- Lexical export: 24 October 2026. Tree export: 23 October 2026.
- Map: Natural Earth data distributed by `world-atlas@2.0.2` (`countries-110m.json`), https://github.com/topojson/world-atlas. Natural Earth map data is public domain.

Original DiACL citations remain attached to each word and relationship. Consult DiACL's current attribution and reuse terms before redistribution beyond coursework. This prototype is an educational exploration aid, not an authoritative etymological dictionary.
