"""Read the pinned CLDR-code-to-Glottolog associations used by the CLDR builder."""

from __future__ import annotations

import csv
import hashlib
import re
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "data/administrative/source/cldr_glottolog_joined.csv"
CATALOG = ROOT / "data/administrative/glottolog/languages.csv"

JOIN_FIELDS = {
    "language_raw_code",
    "glottocode",
    "ID",
    "iso639_3",
    "glottolog_name",
    "family_glottocode",
    "glottolog_macroarea",
    "latitude",
    "longitude",
    "glottolog_countries",
}
CATALOG_FIELDS = {
    "ID": "ID",
    "glottolog_name": "Name",
    "iso639_3": "ISO639P3code",
    "family_glottocode": "Family_ID",
    "glottolog_macroarea": "Macroarea",
    "glottolog_countries": "Countries",
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def check_file(path: Path, spec: dict) -> None:
    if (
        not path.is_file()
        or path.is_symlink()
        or path.stat().st_size != spec["bytes"]
        or sha256(path) != spec["sha256"]
    ):
        raise ValueError(f"Missing or modified pinned source: {path}")


def read_rows(path: Path, required: set[str]) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames is None or len(reader.fieldnames) != len(set(reader.fieldnames)):
            raise ValueError(f"Missing or repeated CSV header: {path}")
        missing = required - set(reader.fieldnames)
        if missing:
            raise ValueError(f"Missing CSV columns in {path}: {', '.join(sorted(missing))}")
        rows = list(reader)
    if not rows or any(None in row or any(value is None for value in row.values()) for row in rows):
        raise ValueError(f"Empty or malformed CSV rows: {path}")
    return rows


def read_mapping(source: Path, catalog: Path, pin: dict) -> tuple[dict[str, dict], dict[str, str]]:
    """Validate mapping rows against Glottolog and return associations and family names."""
    check_file(source, pin["joinedCsv"])
    check_file(catalog, pin["glottolog"])
    catalog_rows = read_rows(
        catalog,
        {"Glottocode", "Level", "Language_ID", "Latitude", "Longitude", *CATALOG_FIELDS.values()},
    )
    catalog_by_id = {row["Glottocode"]: row for row in catalog_rows}
    if len(catalog_by_id) != len(catalog_rows):
        raise ValueError("Duplicate Glottolog ID")
    associations: dict[str, dict] = {}
    for line, row in enumerate(read_rows(source, JOIN_FIELDS), 2):
        language = row["language_raw_code"]
        glottocode = row["glottocode"]
        where = f"CSV line {line} ({language})"
        if not re.fullmatch(r"[a-z]{2,3}(?:_[A-Za-z0-9]+)*", language):
            raise ValueError(f"Invalid CLDR language code at {where}")
        if not re.fullmatch(r"[a-z]{4}[0-9]{4}", glottocode):
            raise ValueError(f"Invalid Glottocode at {where}")
        glottolog = catalog_by_id.get(glottocode)
        if glottolog is None:
            raise ValueError(f"Unmatched Glottocode at {where}: {glottocode}")
        if any(row[field] != glottolog[other] for field, other in CATALOG_FIELDS.items()):
            raise ValueError(f"Glottolog association mismatch at {where}")
        if row["ID"] != glottocode or glottolog["ID"] != glottocode:
            raise ValueError(f"Glottolog ID mismatch at {where}")
        if bool(row["latitude"]) != bool(row["longitude"]):
            raise ValueError(f"Incomplete Glottolog coordinates at {where}")
        for field, catalog_field in (("latitude", "Latitude"), ("longitude", "Longitude")):
            if row[field] and abs(
                Decimal(row[field]) - Decimal(glottolog[catalog_field])
            ) > Decimal("1e-10"):
                raise ValueError(f"Glottolog coordinates mismatch at {where}")
        level = glottolog["Level"]
        if level not in {"language", "dialect", "family"}:
            raise ValueError(f"Unexpected Glottolog level at {where}: {level}")
        association = {
            "sourceLanguageCode": language,
            "glottocode": glottocode,
            "matchMethod": "source_join_verified_against_pinned_glottolog",
            "glottologLevel": level,
            "glottologLanguageParentId": glottolog["Language_ID"] or None,
            "iso6393": row["iso639_3"] or None,
            "name": row["glottolog_name"],
            "familyId": row["family_glottocode"] or None,
            "macroareas": row["glottolog_macroarea"].split(";")
            if row["glottolog_macroarea"]
            else [],
            "latitude": row["latitude"] or None,
            "longitude": row["longitude"] or None,
            "glottologCountries": row["glottolog_countries"].split(";")
            if row["glottolog_countries"]
            else [],
        }
        if language in associations and associations[language] != association:
            raise ValueError(f"Conflicting language association at {where}")
        associations[language] = association
    family_ids = {item["familyId"] for item in associations.values() if item["familyId"]}
    families = {}
    for family_id in family_ids:
        family = catalog_by_id.get(family_id)
        if not family or family["Level"] != "family" or not family["Name"]:
            raise ValueError(f"Missing or invalid Glottolog family: {family_id}")
        families[family_id] = family["Name"]
    return associations, families
