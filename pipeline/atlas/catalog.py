#!/usr/bin/env python3
"""Supplement Glottolog with explicitly identified, dataset-defined catalog entries."""

from __future__ import annotations

import json
import re
from pathlib import Path

SOURCE_LANGUOIDS = Path(__file__).with_name("source_languoids.json")


def read_source_languoids(
    known_languoids: set[str], dataset_ids: set[str], path: Path = SOURCE_LANGUOIDS
) -> list[dict]:
    """Source IDs are stable dataset namespaces, never fabricated Glottocodes.

    Unplaced entries remain roots. Optional parent links require an explicit
    registry decision; existing Glottolog nodes are never reparented here.
    """
    entries = json.loads(path.read_text(encoding="utf-8"))
    ids = set(known_languoids)
    for entry in entries:
        identity = entry["classification"]
        dataset_id = identity.get("datasetId")
        if identity.get("kind") != "source" or dataset_id not in dataset_ids:
            raise ValueError(f"Unknown source classification: {entry['id']}")
        if not identity.get("label") or not identity.get("note"):
            raise ValueError(f"Missing source classification provenance: {entry['id']}")
        if not re.fullmatch(re.escape(dataset_id) + r":[a-z0-9]+(?:-[a-z0-9]+)*", entry["id"]):
            raise ValueError(f"Source languoid ID must use its dataset namespace: {entry['id']}")
        if entry["id"] in ids:
            raise ValueError(f"Duplicate languoid ID: {entry['id']}")
        if not entry.get("name") or entry["level"] not in {
            "family",
            "language",
            "dialect",
            "group",
        }:
            raise ValueError(f"Invalid source languoid: {entry['id']}")
        if identity.get("glottocode") is not None:
            raise ValueError(f"Source languoid cannot claim a Glottocode: {entry['id']}")
        ids.add(entry["id"])

    parent_ids = {entry["id"]: entry.get("parentId") for entry in entries}
    result = []
    for entry in entries:
        for key in ["parentId", "familyId", "parentLanguageId"]:
            if entry.get(key) is not None and entry[key] not in ids:
                raise ValueError(f"Unknown {key} for source languoid: {entry['id']}")
        current = entry["id"]
        visited = set()
        while current in parent_ids:
            if current in visited:
                raise ValueError(f"Cyclic source classification: {entry['id']}")
            visited.add(current)
            current = parent_ids[current]
        result.append(
            {
                "parentId": None,
                "parentLanguageId": None,
                "familyId": None,
                "familyName": None,
                "iso6393": None,
                "alternativeNames": [],
                "macroarea": None,
                "countries": [],
                "latitude": None,
                "longitude": None,
                **entry,
                "geometryVariantIds": [],
            }
        )
    return result


def resolve_source_ancestry(
    entries: list[dict],
    parent_ids: dict[str, str],
    names: dict[str, str],
    levels: dict[str, str],
) -> list[dict]:
    """Derive family and dialect-language ancestry from the combined parent tree.

    Only registry parent links supplement Glottolog; source groups never adopt
    existing Glottolog children merely because they share a family.
    """
    parents = {**parent_ids, **{e["id"]: e["parentId"] for e in entries}}
    all_names = {**names, **{e["id"]: e["name"] for e in entries}}
    all_levels = {**levels, **{e["id"]: e["level"] for e in entries}}
    result = []
    for entry in entries:
        ancestors = []
        visited = {entry["id"]}
        current = parents.get(entry["id"])
        while current is not None:
            if current in visited:
                raise ValueError(f"Cyclic source classification: {entry['id']}")
            visited.add(current)
            ancestors.append(current)
            current = parents.get(current)
        root = ancestors[-1] if ancestors else None
        family_id = root if all_levels.get(root) == "family" else None
        language_id = (
            next((a for a in ancestors if all_levels[a] == "language"), None)
            if entry["level"] == "dialect"
            else None
        )
        result.append(
            {
                **entry,
                "familyId": family_id,
                "familyName": all_names[family_id] if family_id else None,
                "parentLanguageId": language_id,
            }
        )
    return result
