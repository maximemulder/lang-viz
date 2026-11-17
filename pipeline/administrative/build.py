"""Build CLDR 49 territory observations, preserving unresolved Glottolog joins."""

from __future__ import annotations

import argparse
import json
import re
import tempfile
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from decimal import Decimal
from pathlib import Path

from pipeline.administrative.mapping import CATALOG, SOURCE, check_file, read_mapping
from pipeline.administrative.mapping import sha256 as file_sha256

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
PIN = HERE / "sources.json"
CLDR = ROOT / "data/administrative/cldr/supplementalData-49.xml"
ENGLISH = ROOT / "data/administrative/cldr/en-49.xml"
OUTPUT = ROOT / "app/public/administrative/observations.json"

STATUSES = {"official", "official_regional", "de_facto_official", "official_minority"}


def language_names(path: Path) -> dict[str, str]:
    root = ET.parse(path).getroot()
    languages = root.find("./localeDisplayNames/languages")
    if languages is None:
        raise ValueError("CLDR English names are missing")
    return {
        row.get("type"): row.text
        for row in languages
        if row.tag == "language" and row.get("type") and row.text and not row.get("alt")
    }


def compile_release(cldr: Path, english: Path, joined: Path, catalog: Path, pin: dict) -> dict:
    check_file(cldr, pin["cldrSupplemental"])
    check_file(english, pin["cldrEnglish"])
    # The pinned join supplies reviewed language associations only. Missing joins
    # remain visible as CLDR-only languages.
    known, family_names = read_mapping(joined, catalog, pin)
    names = language_names(english)
    root = ET.parse(cldr).getroot()
    info = root.find("territoryInfo")
    containment = root.find("territoryContainment")
    if info is None or containment is None:
        raise ValueError("CLDR territoryInfo or territoryContainment is missing")
    numeric_parents: dict[str, list[str]] = defaultdict(list)
    for group in containment:
        parent = group.get("type")
        if parent and parent.isdigit():
            for child in (group.get("contains") or "").split():
                numeric_parents[child].append(parent)
    territories = []
    observations = []
    source_codes: set[str] = set()
    unsupported: Counter[str] = Counter()
    for item in info:
        code = item.get("type")
        if code is None or not re.fullmatch(r"[A-Z]{2}", code):
            raise ValueError(f"Invalid CLDR territory code: {code}")
        values = {key: item.get(key) for key in ("population", "gdp", "literacyPercent")}
        if any(value is None for value in values.values()):
            raise ValueError(f"Incomplete CLDR territory: {code}")
        territories.append(
            {
                "code": code,
                "unContainmentCodes": ";".join(numeric_parents.get(code, [])),
                "population": values["population"],
                "gdpUsd": values["gdp"],
                "literacyPercent": values["literacyPercent"],
            }
        )
        for row in item.findall("languagePopulation"):
            language = row.get("type")
            percent = row.get("populationPercent")
            if (
                language is None
                or not re.fullmatch(r"[a-z]{2,3}(?:_[A-Za-z0-9]+)*", language)
                or percent is None
            ):
                raise ValueError(f"Invalid CLDR language in {code}")
            status = row.get("officialStatus") or "unspecified"
            if status != "unspecified" and status not in STATUSES:
                raise ValueError(f"Unsupported CLDR official status: {status}")
            count = round(Decimal(values["population"]) * Decimal(percent) / 100)
            observations.append(
                {
                    "territoryCode": code,
                    "sourceLanguageCode": language,
                    "populationPercent": percent,
                    "speakerCount": str(count),
                    "officialStatus": status,
                    "languageLiteracyPercent": row.get("literacyPercent"),
                    "languageWritingPercent": row.get("writingPercent"),
                }
            )
            source_codes.add(language)
            if language not in known:
                unsupported[language] += 1
    if len(territories) != 258 or len(observations) != 1630:
        raise ValueError("Unexpected CLDR 49 territory or observation count")
    if len({row["code"] for row in territories}) != len(territories):
        raise ValueError("Repeated CLDR territory")
    associations = []
    for code in sorted(source_codes):
        if code in known:
            associations.append(known[code])
        else:
            associations.append(
                {
                    "sourceLanguageCode": code,
                    "glottocode": None,
                    "matchMethod": "unresolved",
                    "glottologLevel": None,
                    "glottologLanguageParentId": None,
                    "iso6393": None,
                    "name": names.get(code) or code,
                    "familyId": None,
                    "macroareas": [],
                    "latitude": None,
                    "longitude": None,
                    "glottologCountries": [],
                }
            )
    glottocodes = {item["glottocode"] for item in associations if item["glottocode"] is not None}
    family_ids = {item["familyId"] for item in associations if item["familyId"]}
    families = [{"id": key, "name": family_names[key]} for key in sorted(family_ids)]
    atlas = [
        {"glottocode": key, "status": "unresolved", "matchMethod": None, "atlasLanguageId": None}
        for key in sorted(glottocodes)
    ]
    by_territory: dict[str, Decimal] = defaultdict(Decimal)
    for row in observations:
        by_territory[row["territoryCode"]] += Decimal(row["populationPercent"])
    coverage = {
        "observationCount": len(observations),
        "territoryCount": len(territories),
        "sourceLanguageCount": len(associations),
        "glottocodeCount": len(glottocodes),
        "familyCount": len(families),
        "unresolvedLanguageCount": len(unsupported),
        "unresolvedObservationCount": sum(unsupported.values()),
        "territoriesWithoutObservations": [
            row["code"] for row in territories if row["code"] not in by_territory
        ],
        "territoriesWithOverlappingPercentages": sum(
            total > 100 for total in by_territory.values()
        ),
    }
    return {
        "schemaVersion": 3,
        "manifest": {
            "sourceBranchCommit": pin["sourceBranchCommit"],
            "cldrRelease": pin["cldrRelease"],
            "cldrSourceFile": pin["cldrSourceFile"],
            "cldrSupplemental": pin["cldrSupplemental"],
            "cldrEnglish": pin["cldrEnglish"],
            "joinedCsv": pin["joinedCsv"],
            "glottolog": pin["glottolog"],
            "producerRevision": f"sha256:{file_sha256(Path(__file__))}",
            "attribution": [
                {
                    "name": "Unicode CLDR 49 territory-language data",
                    "sourceUrl": "https://cldr.unicode.org/index/downloads",
                    "license": "Unicode-3.0",
                },
                {
                    "name": "Glottolog 5.3 CLDF, for reviewed language associations",
                    "sourceUrl": "https://github.com/glottolog/glottolog-cldf",
                    "license": "CC-BY-4.0",
                },
            ],
            "coverage": coverage,
        },
        "territories": territories,
        "observations": observations,
        "languageAssociations": associations,
        "families": families,
        "atlasAssociations": atlas,
    }


def expected_bytes() -> bytes:
    pin = json.loads(PIN.read_text(encoding="utf-8"))
    return (
        json.dumps(
            compile_release(CLDR, ENGLISH, SOURCE, CATALOG, pin),
            ensure_ascii=False,
            separators=(",", ":"),
        )
        + "\n"
    ).encode()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("build", "verify"))
    args = parser.parse_args()
    try:
        expected = expected_bytes()
        if args.command == "build" and (
            not OUTPUT.is_file() or OUTPUT.is_symlink() or OUTPUT.read_bytes() != expected
        ):
            OUTPUT.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(
                dir=OUTPUT.parent, prefix=".observations-", delete=False
            ) as handle:
                staged = Path(handle.name)
                try:
                    handle.write(expected)
                    handle.flush()
                    staged.replace(OUTPUT)
                finally:
                    staged.unlink(missing_ok=True)
        if not OUTPUT.is_file() or OUTPUT.is_symlink() or OUTPUT.read_bytes() != expected:
            raise ValueError(f"Missing or stale administrative supplement: {OUTPUT}")
    except (OSError, ValueError, KeyError, ET.ParseError) as error:
        parser.exit(1, f"Administrative supplement {args.command} failed: {error}\n")
    print(f"Verified CLDR 49 administrative supplement ({len(expected):,} bytes)")


if __name__ == "__main__":
    main()
