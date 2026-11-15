"""Validate and compile the pinned, prejoined CLDR territory supplement.

The CSV is a fixed branch snapshot. Its upstream CLDR release and preprocessing
recipe are unknown; this adapter does not claim to reconstruct them.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import tempfile
from collections import Counter, defaultdict
from decimal import Decimal, InvalidOperation
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
PIN = HERE / "sources.json"
SOURCE = ROOT / "data/administrative/source/cldr_glottolog_joined.csv"
CATALOG = ROOT / "data/administrative/glottolog/languages.csv"
OUTPUT = ROOT / "app/public/administrative/observations.json"

COLUMNS = (
    "territory_code",
    "un_containment_codes",
    "language_raw_code",
    "territory_population",
    "territory_gdp_usd",
    "territory_literacy_percent",
    "population_percent",
    "speaker_count",
    "official_status",
    "language_literacy_percent",
    "language_writing_percent",
    "iso639_3",
    "ID",
    "glottocode",
    "glottolog_name",
    "family_glottocode",
    "glottolog_macroarea",
    "latitude",
    "longitude",
    "glottolog_countries",
)
CATALOG_FIELDS = {
    "ID": "ID",
    "glottolog_name": "Name",
    "iso639_3": "ISO639P3code",
    "family_glottocode": "Family_ID",
    "glottolog_macroarea": "Macroarea",
    "glottolog_countries": "Countries",
}
STATUSES = {
    "unspecified",
    "official",
    "official_regional",
    "de_facto_official",
    "official_minority",
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


def decimal(value: str, label: str, *, low: int = 0, high: int | None = None) -> Decimal:
    try:
        number = Decimal(value)
    except InvalidOperation as error:
        raise ValueError(f"Invalid {label}: {value!r}") from error
    if not number.is_finite() or number < low or (high is not None and number > high):
        raise ValueError(f"Out-of-range {label}: {value!r}")
    return number


def optional_decimal(value: str, label: str, *, low: int = 0, high: int | None = None) -> None:
    if value:
        decimal(value, label, low=low, high=high)


def compile_data(source: Path, catalog: Path, pin: dict) -> dict:
    check_file(source, pin["joinedCsv"])
    check_file(catalog, pin["glottolog"])
    records = read_rows(source, set(COLUMNS))
    catalog_rows = read_rows(
        catalog, {"Glottocode", "Name", "Level", "Language_ID", *CATALOG_FIELDS.values()}
    )
    catalog_by_id: dict[str, dict[str, str]] = {}
    for row in catalog_rows:
        code = row["Glottocode"]
        if code in catalog_by_id:
            raise ValueError(f"Duplicate Glottolog ID: {code}")
        catalog_by_id[code] = row

    territories: dict[str, dict] = {}
    associations: dict[str, dict] = {}
    observations: list[dict] = []
    keys: set[tuple[str, str]] = set()
    by_glottocode: Counter[str] = Counter()
    levels: Counter[str] = Counter()
    for line, row in enumerate(records, 2):
        territory, language = row["territory_code"], row["language_raw_code"]
        where = f"CSV line {line} ({territory}/{language})"
        if not re.fullmatch(r"[A-Z]{2}", territory):
            raise ValueError(f"Invalid territory code at {where}")
        if not re.fullmatch(r"[a-z]{2,3}(?:_[A-Za-z0-9]+)*", language):
            raise ValueError(f"Invalid CLDR language code at {where}")
        key = territory, language
        if key in keys:
            raise ValueError(f"Duplicate territory/language observation at {where}")
        keys.add(key)
        population = decimal(row["territory_population"], f"population at {where}")
        decimal(row["territory_gdp_usd"], f"GDP at {where}")
        decimal(row["territory_literacy_percent"], f"territory literacy at {where}", high=100)
        percent = decimal(row["population_percent"], f"language percent at {where}", high=100)
        count = decimal(row["speaker_count"], f"speaker count at {where}")
        if count != count.to_integral_value() or abs(count - (population * percent / 100)) > 1:
            raise ValueError(f"Speaker count does not match the source estimate at {where}")
        optional_decimal(
            row["language_literacy_percent"], f"language literacy at {where}", high=100
        )
        optional_decimal(row["language_writing_percent"], f"writing percent at {where}", high=100)
        if row["official_status"] not in STATUSES:
            raise ValueError(f"Unknown official status at {where}")
        for field, low, high in (("latitude", -90, 90), ("longitude", -180, 180)):
            optional_decimal(row[field], f"{field} at {where}", low=low, high=high)
        if bool(row["latitude"]) != bool(row["longitude"]):
            raise ValueError(f"Incomplete Glottolog coordinates at {where}")

        territory_values = {
            "code": territory,
            "unContainmentCodes": row["un_containment_codes"],
            "population": row["territory_population"],
            "gdpUsd": row["territory_gdp_usd"],
            "literacyPercent": row["territory_literacy_percent"],
        }
        if territory in territories and territories[territory] != territory_values:
            raise ValueError(f"Conflicting territory values at {where}")
        territories[territory] = territory_values

        glottocode = row["glottocode"]
        if not re.fullmatch(r"[a-z]{4}[0-9]{4}", glottocode):
            raise ValueError(f"Invalid Glottocode at {where}")
        glottolog = catalog_by_id.get(glottocode)
        if glottolog is None:
            raise ValueError(f"Unmatched Glottocode at {where}: {glottocode}")
        for source_field, catalog_field in CATALOG_FIELDS.items():
            if row[source_field] != glottolog[catalog_field]:
                raise ValueError(f"Glottolog {source_field} mismatch at {where}")
        if row["ID"] != glottocode or glottolog["ID"] != glottocode:
            raise ValueError(f"Glottolog ID mismatch at {where}")
        for source_field, catalog_field in (("latitude", "Latitude"), ("longitude", "Longitude")):
            if row[source_field] and abs(
                Decimal(row[source_field]) - Decimal(glottolog[catalog_field])
            ) > Decimal("1e-10"):
                raise ValueError(f"Glottolog {source_field} mismatch at {where}")
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
        by_glottocode[glottocode] += 1
        levels[level] += 1
        observations.append(
            {
                "territoryCode": territory,
                "sourceLanguageCode": language,
                "populationPercent": row["population_percent"],
                "speakerCount": row["speaker_count"],
                "officialStatus": row["official_status"],
                "languageLiteracyPercent": row["language_literacy_percent"] or None,
                "languageWritingPercent": row["language_writing_percent"] or None,
            }
        )

    territory_percent_sums: dict[str, Decimal] = defaultdict(Decimal)
    territory_glottocode_counts: Counter[tuple[str, str]] = Counter()
    for row in observations:
        territory_percent_sums[row["territoryCode"]] += Decimal(row["populationPercent"])
        territory_glottocode_counts[
            (row["territoryCode"], associations[row["sourceLanguageCode"]]["glottocode"])
        ] += 1
    family_ids = sorted({item["familyId"] for item in associations.values() if item["familyId"]})
    families = []
    for family_id in family_ids:
        catalog_family = catalog_by_id.get(family_id)
        if not catalog_family or catalog_family["Level"] != "family" or not catalog_family["Name"]:
            raise ValueError(f"Missing or invalid Glottolog family: {family_id}")
        families.append({"id": family_id, "name": catalog_family["Name"]})
    diagnostics = {
        "observationCount": len(observations),
        "territoryCount": len(territories),
        "sourceLanguageCount": len(associations),
        "glottocodeCount": len(by_glottocode),
        "familyCount": len(families),
        "glottologLevels": dict(sorted(levels.items())),
        "territoriesWithOverlappingPercentages": sum(
            total > 100 for total in territory_percent_sums.values()
        ),
        "territoryGlottocodeDuplicateGroups": sum(
            count > 1 for count in territory_glottocode_counts.values()
        ),
        "unmatchedGlottocodes": 0,
    }
    return {
        "schemaVersion": 2,
        "manifest": {
            "sourceBranchCommit": pin["sourceBranchCommit"],
            "cldrRelease": pin["cldrRelease"],
            "cldrSourceFile": pin["cldrSourceFile"],
            "joinedCsv": pin["joinedCsv"],
            "glottolog": pin["glottolog"],
            "producerRevision": f"sha256:{sha256(Path(__file__))}",
            "attribution": [
                {
                    "name": "Unicode CLDR territory-language data",
                    "sourceUrl": "https://github.com/unicode-org/cldr",
                    "license": "Unicode-3.0",
                    "licenseUrl": "https://github.com/unicode-org/cldr/blob/main/LICENSE",
                    "note": "Upstream release and joined-CSV preprocessing recipe unverified",
                },
                {
                    "name": "Glottolog 5.3 CLDF",
                    "citation": "Hammarström, Forkel, Haspelmath & Bank (2026), Glottolog 5.3",
                    "sourceUrl": "https://github.com/glottolog/glottolog-cldf",
                    "license": "CC-BY-4.0",
                    "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
                },
            ],
            "coverage": diagnostics,
        },
        "territories": [territories[key] for key in sorted(territories)],
        "observations": observations,
        "languageAssociations": [associations[key] for key in sorted(associations)],
        "families": families,
        "atlasAssociations": [
            {
                "glottocode": key,
                "status": "unresolved",
                "matchMethod": None,
                "atlasLanguageId": None,
            }
            for key in sorted(by_glottocode)
        ],
    }


def expected_bytes(source: Path, catalog: Path) -> bytes:
    pin = json.loads(PIN.read_text(encoding="utf-8"))
    return (
        json.dumps(compile_data(source, catalog, pin), ensure_ascii=False, separators=(",", ":"))
        + "\n"
    ).encode("utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("build", "verify"))
    parser.add_argument("--source", type=Path, default=SOURCE)
    parser.add_argument("--catalog", type=Path, default=CATALOG)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()
    try:
        expected = expected_bytes(args.source, args.catalog)
        if args.command == "verify":
            if (
                not args.output.is_file()
                or args.output.is_symlink()
                or args.output.read_bytes() != expected
            ):
                raise ValueError(f"Missing or stale administrative supplement: {args.output}")
        else:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            if (
                not args.output.is_file()
                or args.output.is_symlink()
                or args.output.read_bytes() != expected
            ):
                with tempfile.NamedTemporaryFile(
                    dir=args.output.parent, prefix=".observations-", delete=False
                ) as handle:
                    staged = Path(handle.name)
                    try:
                        handle.write(expected)
                        handle.flush()
                        staged.replace(args.output)
                    finally:
                        staged.unlink(missing_ok=True)
        print(f"Verified administrative supplement ({len(expected):,} bytes): {args.output}")
    except (OSError, ValueError, KeyError) as error:
        parser.exit(1, f"Administrative supplement {args.command} failed: {error}\n")


if __name__ == "__main__":
    main()
