#!/usr/bin/env python3
"""Validate and compile DiACL lexical JSON. No network or third-party packages.

Every build reads and validates input contents. Identical output is left untouched;
changed output replaces the previous single-file bundle atomically.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import tempfile
from pathlib import Path

from .sources import ROOT, read_pin, source_directory, verify

SCHEMA_VERSION = 1
ADAPTER_VERSION = 1


class DataError(ValueError):
    """An input record violates the lexical source contract."""


def require(condition: bool, location: str, message: str) -> None:
    if not condition:
        raise DataError(f"{location}: {message}")


def obj(value, location: str) -> dict:
    require(isinstance(value, dict), location, "expected an object")
    return value


def array(value, location: str) -> list:
    require(isinstance(value, list), location, "expected an array")
    return value


def text(value, location: str, *, optional: bool = False) -> str:
    if optional and value is None:
        return ""
    require(isinstance(value, str), location, "expected a string")
    return value


def identifier(value, location: str) -> str:
    require(
        type(value) in (str, int) and re.fullmatch(r"(?:0|[1-9][0-9]*)", str(value)) is not None,
        location,
        "expected a nonnegative decimal identifier",
    )
    return str(value)


def table(value, location: str) -> dict:
    value = obj(value, location)
    for key in value:
        identifier(key, f"{location} key")
    return value


def joined(value, records: dict, location: str) -> str:
    key = identifier(value, location)
    require(key in records, location, f"unknown identifier {key}")
    return key


def unique_object(pairs: list[tuple[str, object]]) -> dict:
    result = {}
    for key, value in pairs:
        require(key not in result, "JSON", f"duplicate key {key}")
        result[key] = value
    return result


def read_input(path: Path) -> tuple[dict, str]:
    contents = path.read_bytes()
    try:
        value = json.loads(contents.decode("utf-8"), object_pairs_hook=unique_object)
    except (UnicodeError, json.JSONDecodeError) as error:
        raise DataError(f"{path.name}: invalid UTF-8 JSON: {error}") from error
    return obj(value, path.name), hashlib.sha256(contents).hexdigest()


def references(value, sources: dict, location: str) -> list[dict]:
    result = []
    for index, reference in enumerate(array(value, location)):
        at = f"{location}[{index}]"
        reference = obj(reference, at)
        source = joined(reference.get("FkSourceId"), sources, f"{at}.FkSourceId")
        record = {"FkSourceId": int(source)}
        for field in ("LocationWithinSource", "Note"):
            if field in reference:
                record[field] = text(reference[field], f"{at}.{field}", optional=True)
        result.append(record)
    return result


def coordinates(value, location: str) -> tuple[float | None, float | None]:
    point = obj(value, location)
    result = []
    for field, limit in (("Latitude", 90), ("Longitude", 180)):
        coordinate = point.get(field)
        if coordinate is None or coordinate == "":
            result.append(None)
            continue
        require(type(coordinate) in (str, int, float), f"{location}.{field}", "invalid coordinate")
        try:
            number = float(coordinate)
        except ValueError as error:
            raise DataError(f"{location}.{field}: invalid coordinate {coordinate!r}") from error
        require(math.isfinite(number) and abs(number) <= limit, location, "coordinate out of range")
        result.append(number)
    return result[0], result[1]


def timeframe(value, location: str) -> dict:
    value = obj(value, location)
    require(not value.keys() - {"From", "Until"}, location, "unknown time field")
    for key, year in value.items():
        require(type(year) is int, f"{location}.{key}", "expected an integer year")
    if "From" in value and "Until" in value:
        require(value["From"] <= value["Until"], location, "reversed time interval")
    return value


def compile_data(raw: dict, tree: dict, *, placeholder_source_id: int = 999) -> dict:
    tables = {
        name: table(raw.get(name), name)
        for name in (
            "Languages",
            "Lexemes",
            "Etymologies",
            "Sources",
            "WordLists",
            "LanguageReliabilities",
            "EtymologicalReliabilities",
        )
    }
    languages, words, relationships, sources, lists, statuses, types = (
        tables[name]
        for name in (
            "Languages",
            "Lexemes",
            "Etymologies",
            "Sources",
            "WordLists",
            "LanguageReliabilities",
            "EtymologicalReliabilities",
        )
    )
    compiled_sources = {}
    for key, value in sources.items():
        value = obj(value, f"Sources.{key}")
        compiled_sources[key] = dict(value)
        for field in ("CitationKey", "FullCitation"):
            text(value.get(field), f"Sources.{key}.{field}")
        for field in ("Note", "SourceType"):
            if field in value:
                compiled_sources[key][field] = text(
                    value[field], f"Sources.{key}.{field}", optional=True
                )
    type_names = {
        key: text(obj(value, f"EtymologicalReliabilities.{key}").get("Name"), f"type {key}")
        for key, value in types.items()
    }
    paths: dict[str, list[str]] = {}
    node_ids: set[str] = set()
    stack = [(tree.get("Root"), [])]
    while stack:
        branch, path = stack.pop()
        branch = obj(branch, "language tree branch")
        node = obj(branch.get("Node"), "language tree node")
        node_id = identifier(node.get("LanguageTreeId"), "language tree node ID")
        require(node_id not in node_ids, "language tree", f"duplicate node {node_id}")
        node_ids.add(node_id)
        label = text(node.get("Label"), f"tree node {node_id} label")
        trail = path + ([label] if label != "root" else [])
        if "FkLanguageId" in node:
            language_id = joined(node["FkLanguageId"], languages, f"tree node {node_id} language")
            require(language_id not in paths, "language tree", f"duplicate language {language_id}")
            paths[language_id] = trail
        stack.extend(
            (child, trail) for child in reversed(array(branch.get("Children", []), "Children"))
        )

    used = set()
    for key, value in words.items():
        value = obj(value, f"Lexemes.{key}")
        used.add(joined(value.get("FkLanguageId"), languages, f"Lexemes.{key}.FkLanguageId"))
    lexical_languages, diagnostics = {}, []
    for key in sorted(used, key=int):
        value = obj(languages[key], f"Languages.{key}")
        at = f"Languages.{key}"
        lat, lon = coordinates(value.get("FocalPointWgs84", {}), f"{at}.FocalPointWgs84")
        if (lat is None) != (lon is None):
            diagnostics.append({"languageId": key, "message": "Incomplete focal point omitted"})
            lat = lon = None
        status_id = joined(value.get("FkLanguageReliabilityId"), statuses, f"{at}.reliability")
        path = paths.get(key, [])
        lexical_languages[key] = {
            "name": text(value.get("Name"), f"{at}.Name"),
            "iso": text(value.get("ISO639-3"), f"{at}.ISO639-3", optional=True),
            "glottocode": text(value.get("Glottocode"), f"{at}.Glottocode", optional=True),
            "lat": lat,
            "lon": lon,
            "status": text(statuses[status_id], f"LanguageReliabilities.{status_id}"),
            "time": timeframe(value.get("TimeFrame", {}), f"{at}.TimeFrame"),
            "path": path,
            "family": path[0] if path else "Unmapped in tree",
        }
    lexemes = {}
    fields = {
        "m": "Meaning",
        "note": "LexemeNotePlain",
        "meaningNote": "MeaningNote",
        "grammar": "GrammaticalData",
        "ipa": "FormIpa",
        "script": "FormScript",
    }
    for key, value in words.items():
        at = f"Lexemes.{key}"
        language_id = str(value["FkLanguageId"])
        refs = references(value.get("SourceReferences"), sources, f"{at}.SourceReferences")
        lexemes[key] = {
            "l": language_id,
            "f": text(value.get("FormTranscriptionPlain"), f"{at}.form"),
            **{
                field: text(value.get(source), f"{at}.{source}", optional=True)
                for field, source in fields.items()
            },
            "refs": refs,
            "stub": any(ref["FkSourceId"] == placeholder_source_id for ref in refs)
            or lexical_languages[language_id]["name"].lower().startswith("stub"),
        }
    edges = []
    for key in sorted(relationships, key=int):
        value = obj(relationships[key], f"Etymologies.{key}")
        at = f"Etymologies.{key}"
        edges.append(
            {
                "id": key,
                "p": joined(value.get("FkParentId"), lexemes, f"{at}.FkParentId"),
                "c": joined(value.get("FkChildId"), lexemes, f"{at}.FkChildId"),
                "t": int(joined(value.get("FkReliabilityId"), types, f"{at}.FkReliabilityId")),
                "refs": references(
                    value.get("SourceReferences"), sources, f"{at}.SourceReferences"
                ),
                "note": text(value.get("NotePlain"), f"{at}.NotePlain", optional=True),
            }
        )
    concepts, collections = {}, []
    for list_id in sorted(lists, key=int):
        listing = obj(lists[list_id], f"WordLists.{list_id}")
        collections.append({"id": list_id, "name": text(listing.get("Name"), "word list name")})
        categories = table(listing.get("WordListCategories"), f"WordLists.{list_id}.categories")
        for category_id in sorted(categories, key=int):
            category = obj(categories[category_id], f"category {category_id}")
            category_name = text(category.get("Name"), f"category {category_id} name")
            items = table(category.get("WordListItems"), f"category {category_id} items")
            for concept_id in sorted(items, key=int):
                item = obj(items[concept_id], f"concept {concept_id}")
                name = text(item.get("Name"), f"concept {concept_id} name")
                entry = concepts.setdefault(
                    concept_id, {"id": concept_id, "name": name, "groups": [], "lexemes": []}
                )
                require(entry["name"] == name, f"concept {concept_id}", "conflicting names")
                entry["groups"].append({"list": list_id, "category": category_name})
                members = array(item.get("ConnectedLexemes", []), f"concept {concept_id} members")
                entry["lexemes"] = sorted(
                    set(entry["lexemes"])
                    | {
                        joined(member, lexemes, f"concept {concept_id} member")
                        for member in members
                    },
                    key=int,
                )
    return {
        "schemaVersion": SCHEMA_VERSION,
        "languages": lexical_languages,
        "lexemes": lexemes,
        "edges": edges,
        "concepts": concepts,
        "lists": collections,
        "sources": compiled_sources,
        "types": type_names,
        "meta": obj(raw.get("MetaData"), "MetaData"),
        "diagnostics": diagnostics,
    }


def build(source_dir: Path, *, pinned: bool = True) -> dict:
    pin = read_pin()
    if pinned:
        verify(source_dir, pin)
    raw, lexical_hash = read_input(source_dir / "lexical-database.json")
    tree, tree_hash = read_input(source_dir / "language-tree.json")
    if pinned:
        for entry, value in zip(pin["files"], (raw, tree), strict=True):
            metadata = obj(value.get("MetaData"), f"{entry['name']} metadata")
            require(
                metadata.get("TimeStamp") == entry["exportedAt"],
                entry["name"],
                "export date mismatch",
            )
            require(
                metadata.get("JsonUrl") == entry["upstreamUrl"],
                entry["name"],
                "export URL mismatch",
            )
    data = compile_data(raw, tree, placeholder_source_id=pin["placeholderSourceId"])
    data["provenance"] = {
        "adapterVersion": ADAPTER_VERSION,
        "snapshot": pin["snapshot"] if pinned else None,
        "placeholderSourceId": pin["placeholderSourceId"],
        "attribution": pin["attribution"],
        "inputs": [
            {"name": "lexical-database.json", "sha256": lexical_hash, "metadata": raw["MetaData"]},
            {
                "name": "language-tree.json",
                "sha256": tree_hash,
                "metadata": obj(tree.get("MetaData"), "tree metadata"),
            },
        ],
    }
    return data


def publish(data: dict, output: Path) -> bool:
    contents = (
        json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
        + "\n"
    ).encode("utf-8")
    if output.is_file() and output.read_bytes() == contents:
        return False
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        dir=output.parent, prefix=f".{output.name}-", delete=False
    ) as f:
        temporary = Path(f.name)
        try:
            f.write(contents)
            f.flush()
            os.fsync(f.fileno())
            f.close()
            os.replace(temporary, output)
        finally:
            temporary.unlink(missing_ok=True)
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, default=source_directory())
    parser.add_argument("--output-dir", type=Path, default=ROOT / "app/public/etymology")
    parser.add_argument(
        "--unpinned",
        action="store_true",
        help="Validate custom inputs without the snapshot checksum gate",
    )
    args = parser.parse_args()
    output = args.output_dir / "word-trails.json"
    try:
        data = build(args.source_dir, pinned=not args.unpinned)
        changed = publish(data, output)
    except (OSError, ValueError) as error:
        parser.exit(1, f"Lexical build failed: {error}\n")
    print(
        f"Word Trails: {len(data['lexemes']):,} words, {len(data['edges']):,} relationships, "
        f"{len(data['languages'])} languages; {'wrote' if changed else 'unchanged'} {output}"
    )


if __name__ == "__main__":
    main()
