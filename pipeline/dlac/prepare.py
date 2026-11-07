#!/usr/bin/env python3
"""Convert the pinned DLAC shapefile into original, classification-linked polygons.

Only candidate correspondences are enabled. Scope-review and unresolved labels
remain in the intermediate GeoJSON and report, without selectable assignments.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
from collections import Counter
from pathlib import Path
from zipfile import ZipFile

import shapefile

ARCHIVE_SHA256 = "7cb94506f9e18d457b1234f99cbd42a11a4ce52552f33d97c07c3e47a956c5bb"
CROSSWALK = Path(__file__).with_name("candidates.csv")

# Exact observed spelling errors and truncated shared labels in the DBF.
GROUPS = {
    "Manderin Supergroup": ["Mandarin Supergroup"],
    "Mandarin Sg and Shaozhou Tuhua": ["Mandarin Supergroup", "Shaozhou Tuhua"],
    "Mandarin Supergroup and Pinghu": ["Mandarin Supergroup", "Pinghua Group"],
    "Mandarin and Pinghua Groups": ["Mandarin Supergroup", "Pinghua Group"],
    "Hakka and Min Groups": ["Hakka Group", "Min Supergroup"],
    "Hakka and Yue (Cantonese) Grou": ["Hakka Group", "Yue (Cantonese) Group"],
}


def components(record: dict) -> list[tuple[str, str]]:
    family, group = record["LANGUAGE_F"], record["CHINESE_GR"]
    if family == "None (Uninhabited)":
        return []
    result = []
    for part in (
        family.removesuffix(" Languages").replace(", and ", ", ").replace(" and ", ", ").split(", ")
    ):
        label = part + " Languages"
        if label != "Han Chinese Languages" or not group:
            result.append(("LANGUAGE_F", label))
    result.extend(("CHINESE_GR", label) for label in GROUPS.get(group, [group] if group else []))
    return result


def read_crosswalk(path: Path, known_languoids: set[str]) -> dict:
    with path.open(encoding="utf-8", newline="") as stream:
        rows = list(csv.DictReader(stream))
    lookup = {}
    for row in rows:
        key = row["field"], row["label"]
        if key in lookup:
            raise ValueError(f"Duplicate DLAC crosswalk label: {key}")
        if row["status"] not in {"candidate", "scope-review", "unresolved"}:
            raise ValueError(f"Unknown DLAC mapping status: {row}")
        code = row["glottocode"]
        if code and code not in known_languoids:
            raise ValueError(f"Unknown DLAC Glottocode: {code}")
        if row["status"] == "candidate" and not code:
            raise ValueError(f"Missing DLAC candidate Glottocode: {key}")
        lookup[key] = row
    return lookup


def convert_record(record: dict, geometry: dict, lookup: dict) -> dict:
    assignments = []
    inconsistent = bool(record["CHINESE_GR"] and "Han Chinese" not in record["LANGUAGE_F"])
    for key in components(record):
        if key not in lookup:
            raise ValueError(f"Unexpected DLAC label: {key}")
        row = lookup[key]
        assignments.append({**row, "included": row["status"] == "candidate" and not inconsistent})
    codes = list(dict.fromkeys(row["glottocode"] for row in assignments if row["included"]))
    status = (
        "inconsistent"
        if inconsistent
        else "uninhabited"
        if not assignments
        else "mapped"
        if all(row["included"] for row in assignments)
        else "partial"
        if codes
        else "unmapped"
    )
    return {
        "type": "Feature",
        "properties": {
            **record,
            "id": f"dlac:{record['CH_LANGS_']}",
            "cldf:languageReference": "|".join(codes) or None,
            "mappingStatus": status,
            "assignments": assignments,
        },
        "geometry": geometry,
    }


def prepare(
    archive_path: Path,
    output_dir: Path,
    known_languoids: set[str],
    crosswalk_path: Path = CROSSWALK,
) -> Path:
    if not archive_path.is_file():
        raise FileNotFoundError("DLAC source missing; run bash pipeline/atlas/fetch-sources.sh")
    if hashlib.sha256(archive_path.read_bytes()).hexdigest() != ARCHIVE_SHA256:
        raise ValueError("DLAC archive checksum differs from the pinned V6.0 file")
    lookup = read_crosswalk(crosswalk_path, known_languoids)
    features = []
    ids = set()
    with ZipFile(archive_path) as archive:
        stem = "ACSN_MajorLanguages_pgn_wgs84"
        crs = archive.read(f"{stem}.prj").decode()
        if 'GEOGCS["GCS_WGS_1984"' not in crs or "PROJCS[" in crs:
            raise ValueError("DLAC CRS is no longer geographic WGS84")
        with shapefile.Reader(
            **{ext: io.BytesIO(archive.read(f"{stem}.{ext}")) for ext in ["shp", "shx", "dbf"]}
        ) as reader:
            for entry in reader.iterShapeRecords():
                record = entry.record.as_dict()
                source_id = record["CH_LANGS_"]
                if source_id in ids:
                    raise ValueError(f"Duplicate DLAC source ID: {source_id}")
                ids.add(source_id)
                geometry = entry.shape.__geo_interface__
                if geometry["type"] not in {"Polygon", "MultiPolygon"}:
                    raise ValueError(f"Unexpected DLAC geometry for {source_id}")
                features.append(convert_record(record, geometry, lookup))

    properties = [feature["properties"] for feature in features]
    report = {
        "datasetId": "dlac1987china",
        "doi": "10.7910/DVN/OHYYXH",
        "version": "6.0",
        "archiveSha256": ARCHIVE_SHA256,
        "crosswalkSha256": hashlib.sha256(crosswalk_path.read_bytes()).hexdigest(),
        "representedYears": [1985, 1987],
        "regionalCoverageOnly": True,
        "includedMappingStatuses": ["candidate"],
        "featureCount": len(features),
        "mappedFeatureCount": sum(bool(p["cldf:languageReference"]) for p in properties),
        "statusCounts": dict(Counter(p["mappingStatus"] for p in properties)),
        "glottocodes": sorted(
            {code for p in properties for code in (p["cldf:languageReference"] or "").split("|")}
            - {""}
        ),
        "records": properties,
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    for name, value in [
        ("features.geojson", {"type": "FeatureCollection", "features": features}),
        ("mapping-report.json", report),
    ]:
        (output_dir / name).write_text(
            json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n",
            encoding="utf-8",
        )
    print(
        f"DLAC: {report['mappedFeatureCount']}/{len(features)} polygons assigned to "
        f"{len(report['glottocodes'])} languoids; details in {output_dir / 'mapping-report.json'}"
    )
    return output_dir / "features.geojson"
