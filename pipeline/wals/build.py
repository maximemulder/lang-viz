#!/usr/bin/env python3
"""Validate the complete published CLDF input and compile an atlas-independent subset."""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import re
import tempfile
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import quote

from pipeline.release_utils import digest, local_path

from .bibliography import parse_bibtex
from .sources import ROOT, read_pin, source_directory, verify

SCHEMA_VERSION = 1
ADAPTER_VERSION = 1
# Export scope only. Labels, explanations, and card ordering belong to the UI policy.
FEATURES = ("12A", "13A", "30A", "37A", "81A", "87A", "92A")
OUTPUT = ROOT / "app/public/wals/features.json"


def require(condition: bool, location: str, message: str) -> None:
    if not condition:
        raise ValueError(f"{location}: {message}")


class PlainText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style"}:
            self.hidden += 1
        if tag in {"p", "br", "div", "li", "tr"}:
            self.parts.append(" ")

    def handle_endtag(self, tag):
        if tag in {"script", "style"}:
            self.hidden = max(0, self.hidden - 1)
        if tag in {"p", "div", "li", "tr"}:
            self.parts.append(" ")

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


def plain(value: str) -> str:
    parser = PlainText()
    parser.feed(value)
    parser.close()
    return " ".join("".join(parser.parts).split())


def read_csv(path: Path) -> tuple[list[str], dict[str, dict]]:
    with path.open(encoding="utf-8", newline="") as stream:
        reader = csv.DictReader(stream)
        fields = reader.fieldnames or []
        require(
            bool(fields) and len(fields) == len(set(fields)),
            path.name,
            "missing/duplicate CSV headers",
        )
        result = {}
        for row in reader:
            require(
                None not in row and None not in row.values(),
                f"{path.name}:{reader.line_num}",
                "wrong CSV field count",
            )
            key = row.get("ID", "")
            require(
                bool(re.fullmatch(r"[A-Za-z0-9_.:-]+", key)), path.name, f"invalid/empty ID {key!r}"
            )
            require(key not in result, path.name, f"duplicate ID {key}")
            result[key] = row
    return fields, result


def split(value: str, separator: str | None) -> list[str]:
    return [v.strip() for v in value.split(separator) if v.strip()] if value else []


def references(value: str, bibliography: dict, location: str, separator: str = ";") -> list[dict]:
    result = []
    for item in split(value, separator):
        match = re.fullmatch(r"([^\s\[\]]+)(?:\[([^\[\]]*)\])?", item)
        require(match is not None, location, f"invalid reference {item!r}")
        key, pages = match.groups()
        require(key in bibliography, location, f"unresolved bibliography reference {key}")
        result.append({"sourceId": key, "pages": pages or ""})
    return result


def load_tables(directory: Path) -> tuple[dict, dict, dict]:
    """Validate IDs and all declared foreign keys, not just the exported observations."""
    cldf = directory / "cldf"
    metadata = json.loads((cldf / "StructureDataset-metadata.json").read_text())
    bibliography = parse_bibtex((cldf / "sources.bib").read_text())
    tables, schemas = {}, {}
    for table in metadata["tables"]:
        name, schema = table["url"], table["tableSchema"]
        require(name not in tables, "metadata", f"duplicate table {name}")
        require(schema.get("primaryKey") == ["ID"], name, "unsupported primary key")
        fields, rows = read_csv(local_path(cldf, name))
        columns = {c["name"]: c for c in schema["columns"]}
        require(
            len(columns) == len(schema["columns"]) and set(fields) == set(columns),
            name,
            "CSV columns do not match declared schema",
        )
        tables[name], schemas[name] = rows, schema
        for key, row in rows.items():
            for column, spec in columns.items():
                if spec.get("required"):
                    require(bool(row[column]), f"{name}:{key}", f"missing {column}")
            if "Source" in row:
                references(
                    row["Source"],
                    bibliography,
                    f"{name}:{key}.Source",
                    columns["Source"].get("separator", ";"),
                )
    required = {
        "languages.csv",
        "parameters.csv",
        "codes.csv",
        "values.csv",
        "chapters.csv",
        "examples.csv",
        "areas.csv",
        "countries.csv",
    }
    require(required <= tables.keys(), "metadata", "missing required CLDF tables")
    for name, schema in schemas.items():
        columns = {c["name"]: c for c in schema["columns"]}
        for fk in schema.get("foreignKeys", []):
            cols, ref = fk["columnReference"], fk["reference"]
            require(
                len(cols) == 1 and ref["columnReference"] == ["ID"] and ref["resource"] in tables,
                name,
                "unsupported foreign key",
            )
            column = cols[0]
            for key, row in tables[name].items():
                for target in split(row[column], columns[column].get("separator")):
                    require(
                        target in tables[ref["resource"]],
                        f"{name}:{key}.{column}",
                        f"unknown {ref['resource']} ID {target}",
                    )
    return metadata, tables, bibliography


def coordinates(row: dict) -> tuple[list[float] | None, str | None]:
    values = []
    for field, limit in (("Longitude", 180), ("Latitude", 90)):
        raw = row[field]
        try:
            number = float(raw) if raw else None
        except ValueError as e:
            raise ValueError(
                f"languages.csv:{row['ID']}.{field}: invalid coordinate {raw!r}"
            ) from e
        require(
            number is None or (math.isfinite(number) and abs(number) <= limit),
            f"languages.csv:{row['ID']}.{field}",
            "nonfinite/out-of-range coordinate",
        )
        values.append(number)
    if all(v is not None for v in values):
        return values, None
    return None, "missing" if all(v is None for v in values) else "incomplete"


def compile_data(directory: Path, *, pinned: bool = True) -> dict:
    pin = read_pin()
    if pinned:
        verify(directory, pin)
    metadata, tables, bibliography = load_tables(directory)
    languages = tables["languages.csv"]
    features, codes = tables["parameters.csv"], tables["codes.csv"]
    chapters, examples = tables["chapters.csv"], tables["examples.csv"]
    require(set(FEATURES) <= features.keys(), "parameters.csv", "shortlisted feature missing")
    groups = {k for k in languages if k.startswith(("family-", "subfamily-", "genus-"))}
    records, missing = {}, []
    for key, row in languages.items():
        point, reason = coordinates(row)
        if key in groups:
            continue
        require(bool(row["Name"]), f"languages.csv:{key}", "missing language name")
        if reason:
            missing.append({"sourceId": key, "reason": reason})
        for country in split(row["Country_ID"], " "):
            require(
                country in tables["countries.csv"],
                f"languages.csv:{key}",
                f"unknown country {country}",
            )
        records[key] = {
            "name": row["Name"],
            "macroarea": row["Macroarea"],
            "coordinates": point,
            "glottocode": row["Glottocode"] or None,
            "iso6393": row["ISO639P3code"] or None,
            "isoCodes": split(row["ISO_codes"], " "),
            "family": row["Family"],
            "subfamily": row["Subfamily"],
            "genus": row["Genus"],
            "references": references(row["Source"], bibliography, key, " "),
            "url": f"https://wals.info/languoid/lect/wals_code_{quote(key, safe='')}",
        }
    # Validate all categories and observations before filtering to the browser subset.
    numbers = set()
    for key, row in codes.items():
        require(
            bool(re.fullmatch(r"[1-9][0-9]*", row["Number"])),
            key,
            "category Number must be a positive integer",
        )
        pair = row["Parameter_ID"], row["Number"]
        require(pair not in numbers, key, "duplicate category number within feature")
        numbers.add(pair)
    pairs, observed, observations = set(), set(), {}
    for key, row in tables["values.csv"].items():
        at = f"values.csv:{key}"
        language, feature = row["Language_ID"], row["Parameter_ID"]
        require(language in records, at, "observation belongs to missing/classification record")
        require(feature in features and row["Code_ID"] in codes, at, "missing feature/category")
        code = codes[row["Code_ID"]]
        require(code["Parameter_ID"] == feature, at, "category belongs to another feature")
        require(row["Value"] == code["Number"], at, "value differs from category number")
        require((language, feature) not in pairs, at, "duplicate language-feature observation")
        pairs.add((language, feature))
        observed.add(language)
        if feature in FEATURES:
            observations[key] = {
                "sourceId": language,
                "featureId": feature,
                "categoryId": row["Code_ID"],
                "references": references(row["Source"], bibliography, at),
                "comment": plain(row["Comment"]),
                "exampleIds": split(row["Example_ID"], " "),
                "url": f"https://wals.info/valuesets/{quote(key, safe='')}",
            }
    feature_output = {}
    for key in FEATURES:
        row = features[key]
        chapter = chapters[row["Chapter_ID"]]
        feature_output[key] = {
            "name": row["Name"],
            "description": plain(row["Description"]),
            "chapterId": chapter["ID"],
            "chapterTitle": chapter["Name"],
            "chapterCitation": chapter["Citation"],
            "contributors": chapter["Contributor"],
            "area": tables["areas.csv"][chapter["Area_ID"]]["Name"],
            "references": references(chapter["Source"], bibliography, key, " "),
            "url": f"https://wals.info/feature/{key}",
            "chapterUrl": f"https://wals.info/chapter/{chapter['Number']}",
        }
    categories = {
        key: {
            "featureId": row["Parameter_ID"],
            "number": int(row["Number"]),
            "name": row["Name"],
            "description": plain(row["Description"]),
        }
        for key, row in codes.items()
        if row["Parameter_ID"] in FEATURES
    }
    example_ids = {key for obs in observations.values() for key in obs["exampleIds"]}
    example_output = {
        key: {
            "sourceId": examples[key]["Language_ID"],
            "text": plain(examples[key]["Primary_Text"]),
            "analyzed": examples[key]["Analyzed_Word"],
            "gloss": examples[key]["Gloss"],
            "translation": plain(examples[key]["Translated_Text"]),
            "comment": plain(examples[key]["Comment"]),
            "url": f"https://wals.info/example/{quote(key, safe='')}",
        }
        for key in sorted(example_ids)
    }
    used_refs = {
        ref["sourceId"]
        for collection in (records, feature_output, observations)
        for row in collection.values()
        for ref in row["references"]
    }
    refs = {
        key: {**bibliography[key], "url": f"https://wals.info/refdb/record/{quote(key, safe='')}"}
        for key in sorted(used_refs)
    }
    short_observed = {row["sourceId"] for row in observations.values()}
    counts = {
        "sourceRecords": len(records),
        "excludedClassificationNodes": len(groups),
        "sourceFeatures": len(features),
        "sourceCategories": len(codes),
        "sourceObservations": len(pairs),
        "sourceReferences": len(bibliography),
        "exportedFeatures": len(feature_output),
        "exportedCategories": len(categories),
        "exportedObservations": len(observations),
        "exportedReferences": len(refs),
        "exportedExamples": len(example_output),
        "recordsWithoutObservations": len(records) - len(observed),
        "recordsWithoutShortlistedValues": len(records) - len(short_observed),
        "omittedNonShortlistedObservations": len(pairs) - len(observations),
    }
    files = {
        entry["name"]: {
            "bytes": local_path(directory, entry["name"]).stat().st_size,
            "sha256": digest(local_path(directory, entry["name"])),
        }
        for entry in pin["files"]
    }
    return {
        "schemaVersion": SCHEMA_VERSION,
        "adapterVersion": ADAPTER_VERSION,
        "provenance": {
            "snapshot": pin["snapshot"] if pinned else None,
            "commit": pin["commit"] if pinned else None,
            "files": files,
            "citation": metadata["dc:bibliographicCitation"],
            "license": metadata["dc:license"],
            "sourceUrl": f"https://github.com/{pin['repository']}/tree/{pin['commit']}"
            if pinned
            else None,
        },
        "sourceNotices": {
            "errata": (directory / "ERRATA.md").read_text(),
            "errataPolicy": "Published values retained; errata are not silently applied.",
            "notice": (
                ""
                if pinned
                else "UNPINNED custom inputs. The notice below describes the reviewed baseline, "
                "not the provenance of these custom inputs.\n\n"
            )
            + Path(__file__).with_name("NOTICE.md").read_text(),
        },
        "records": records,
        "features": feature_output,
        "categories": categories,
        "observations": observations,
        "references": refs,
        "examples": example_output,
        "diagnostics": {
            "counts": counts,
            "missingCoordinates": sorted(missing, key=lambda x: x["sourceId"]),
            "referencesWithoutTitle": sorted(k for k in refs if not refs[k]["fields"].get("title")),
            "observationsByFeature": dict(
                sorted(Counter(o["featureId"] for o in observations.values()).items())
            ),
            "checks": [
                "unique IDs",
                "declared foreign keys",
                "resolved references",
                "category membership",
                "unique language-feature pairs",
                "value/category agreement",
                "coordinate ranges",
            ],
        },
    }


def write_json(output: Path, value: dict) -> None:
    contents = (
        json.dumps(
            value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
        )
        + "\n"
    ).encode()
    if output.exists() and output.read_bytes() == contents:
        return
    output.parent.mkdir(parents=True, exist_ok=True)
    name = None
    try:
        with tempfile.NamedTemporaryFile(
            dir=output.parent, prefix=f".{output.name}-", delete=False
        ) as stream:
            name = stream.name
            stream.write(contents)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, output)
    finally:
        if name and os.path.exists(name):
            os.unlink(name)


def build(directory: Path, output: Path, *, pinned: bool = True) -> dict:
    result = compile_data(directory, pinned=pinned)
    write_json(output, result)
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, default=source_directory())
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument(
        "--unpinned", action="store_true", help="Validate a deliberate custom snapshot"
    )
    args = parser.parse_args()
    try:
        result = build(args.source_dir, args.output, pinned=not args.unpinned)
    except (OSError, ValueError, KeyError, csv.Error) as error:
        parser.exit(1, f"WALS build failed: {error}\n")
    print(json.dumps(result["diagnostics"], indent=2))
    print(f"Wrote {args.output}")


if __name__ == "__main__":
    main()
