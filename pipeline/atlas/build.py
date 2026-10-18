#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import polars as pl

PROJECT_ROOT = Path(__file__).resolve().parents[2]
GLOTTOLOG_LANGUAGES = PROJECT_ROOT / "datasets/glottolog-cldf/cldf/languages.csv"
PROCESSED_DIR = PROJECT_ROOT / "data/processed"
PUBLIC_DATA_DIR = PROJECT_ROOT / "app/public/data"
NORMALIZED_GEOMETRIES = PROCESSED_DIR / "language-areas.geojsonl"
PMTILES_ARCHIVE = PUBLIC_DATA_DIR / "language-areas.pmtiles"


@dataclass(frozen=True)
class GeographySource:
    variant_prefix: str
    dataset_id: str
    layer: str
    label: str
    temporal_kind: str
    temporal_view: str
    temporal_label: str
    temporal_quality: str
    source_year: int
    focal_year: int | None
    path: Path


DATASETS = (
    {
        "id": "asher2007world",
        "name": "Atlas of the World's Languages",
        "shortName": "Asher",
        "citation": "Asher and Moseley (2007)",
        "license": "CC-BY-4.0",
    },
    {
        "id": "carling2025diacl",
        "name": "DiACL language areas",
        "shortName": "DiACL",
        "citation": "Carling et al. (2025)",
        "license": "CC-BY-4.0",
    },
    {
        "id": "bouckaert2012indoeuropean",
        "name": "Indo-European language areas",
        "shortName": "Bouckaert",
        "citation": "Bouckaert et al. (2012)",
        "license": "CC-BY-4.0",
    },
)

SOURCES = (
    GeographySource(
        variant_prefix="asher2007world:contemporary",
        dataset_id="asher2007world",
        layer="contemporary",
        label="Asher — contemporary",
        temporal_kind="named-period",
        temporal_view="contemporary",
        temporal_label="Contemporary",
        temporal_quality="approximate",
        source_year=2007,
        focal_year=None,
        path=PROJECT_ROOT
        / "datasets/glottography/asher2007world/cldf/contemporary/languages.geojson",
    ),
    GeographySource(
        variant_prefix="asher2007world:traditional",
        dataset_id="asher2007world",
        layer="traditional",
        label="Asher — time of contact",
        temporal_kind="named-period",
        temporal_view="time-of-contact",
        temporal_label="Time of contact",
        temporal_quality="direct",
        source_year=2007,
        focal_year=None,
        path=PROJECT_ROOT
        / "datasets/glottography/asher2007world/cldf/traditional/languages.geojson",
    ),
    GeographySource(
        variant_prefix="carling2025diacl:1750",
        dataset_id="carling2025diacl",
        layer="snapshot",
        label="DiACL — approximately 1750",
        temporal_kind="snapshot",
        temporal_view="year-1750",
        temporal_label="Approximately 1750",
        temporal_quality="approximate",
        source_year=2025,
        focal_year=1750,
        path=PROJECT_ROOT / "datasets/glottography/carling2025diacl/cldf/languages.geojson",
    ),
    GeographySource(
        variant_prefix="bouckaert2012indoeuropean:mixed-periods",
        dataset_id="bouckaert2012indoeuropean",
        layer="mixed-periods",
        label="Bouckaert — modern and ancient",
        temporal_kind="named-period",
        temporal_view="mixed-periods",
        temporal_label="Modern and ancient source view",
        temporal_quality="mixed",
        source_year=2012,
        focal_year=None,
        path=PROJECT_ROOT
        / "datasets/glottography/bouckaert2012indoeuropean/cldf/languages.geojson",
    ),
)

ASHER_TRADITIONAL_LANGUAGES = (
    PROJECT_ROOT / "datasets/glottography/asher2007world/cldf/traditional/languages.csv"
)
ASHER_TRADITIONAL_CONTRIBUTIONS = (
    PROJECT_ROOT / "datasets/glottography/asher2007world/cldf/traditional/contributions.csv"
)


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )


def read_glottolog() -> tuple[list[dict[str, Any]], dict[str, str]]:
    frame = (
        pl.scan_csv(GLOTTOLOG_LANGUAGES, infer_schema_length=10_000)
        .select(
            "Glottocode",
            "Name",
            "Level",
            "ISO639P3code",
            "Family_ID",
            "Macroarea",
            "Countries",
            "Latitude",
            "Longitude",
        )
        .collect()
    )
    rows = frame.to_dicts()
    names = {str(row["Glottocode"]): str(row["Name"]) for row in rows}
    return rows, names


def read_asher_traditional_quality() -> dict[str, str]:
    """Classify merged Asher areas as contact data, a modern proxy, or a mixture."""
    contributions = pl.read_csv(
        ASHER_TRADITIONAL_CONTRIBUTIONS,
        schema_overrides={"ID": pl.String, "Year": pl.String},
    )
    year_by_feature_id = {
        str(row["ID"]): str(row["Year"])
        for row in contributions.filter(pl.col("Type") == "feature").select("ID", "Year").to_dicts()
    }
    languages = pl.read_csv(
        ASHER_TRADITIONAL_LANGUAGES,
        schema_overrides={"Glottocode": pl.String, "Feature_IDs": pl.String},
    )
    quality_by_language: dict[str, str] = {}
    for row in languages.select("Glottocode", "Feature_IDs", "Speaker_Area").to_dicts():
        if row["Speaker_Area"] != "languages":
            continue
        feature_ids = str(row["Feature_IDs"] or "").split()
        years = {year_by_feature_id.get(feature_id) for feature_id in feature_ids}
        has_contact_data = "traditional" in years
        has_proxy_data = any(year not in {None, "traditional"} for year in years)
        quality_by_language[str(row["Glottocode"])] = (
            "mixed"
            if has_contact_data and has_proxy_data
            else "direct"
            if has_contact_data
            else "proxy"
        )
    return quality_by_language


def temporal_coverage(
    source: GeographySource, language_id: str, asher_quality: dict[str, str]
) -> dict[str, Any]:
    quality = (
        asher_quality.get(language_id, "proxy")
        if source.temporal_view == "time-of-contact"
        else source.temporal_quality
    )
    coverage: dict[str, Any] = {
        "kind": source.temporal_kind,
        "viewId": source.temporal_view,
        "label": source.temporal_label,
        "quality": quality,
    }
    if source.focal_year is not None:
        coverage["year"] = source.focal_year
    return coverage


def language_color(language_id: str) -> str:
    """Return a stable, varied map color independent of language family."""
    digest = hashlib.blake2b(language_id.encode("utf-8"), digest_size=3).digest()
    hue = int.from_bytes(digest[:2]) % 360
    saturation = 58 + digest[2] % 15
    lightness = 42 + digest[0] % 13

    chroma = (1 - abs(2 * lightness / 100 - 1)) * saturation / 100
    sector = hue / 60
    secondary = chroma * (1 - abs(sector % 2 - 1))
    red, green, blue = (
        (chroma, secondary, 0)
        if sector < 1
        else (secondary, chroma, 0)
        if sector < 2
        else (0, chroma, secondary)
        if sector < 3
        else (0, secondary, chroma)
        if sector < 4
        else (secondary, 0, chroma)
        if sector < 5
        else (chroma, 0, secondary)
    )
    offset = lightness / 100 - chroma / 2
    channels = tuple(round((channel + offset) * 255) for channel in (red, green, blue))
    return "#{:02x}{:02x}{:02x}".format(*channels)


def normalize_geometries(
    known_languages: set[str], family_by_language: dict[str, str | None]
) -> tuple[list[dict[str, Any]], dict[str, list[str]]]:
    variants: list[dict[str, Any]] = []
    variants_by_language: dict[str, list[str]] = defaultdict(list)
    seen_variant_ids: set[str] = set()
    feature_id = 1
    asher_quality = read_asher_traditional_quality()

    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    with NORMALIZED_GEOMETRIES.open("w", encoding="utf-8") as output:
        for source in SOURCES:
            collection = json.loads(source.path.read_text(encoding="utf-8"))
            for feature in collection["features"]:
                properties = feature["properties"]
                language_id = str(properties["cldf:languageReference"])
                if language_id not in known_languages:
                    raise ValueError(f"Unknown Glottocode in {source.path}: {language_id}")

                variant_id = f"{source.variant_prefix}:{language_id}"
                if variant_id in seen_variant_ids:
                    raise ValueError(f"Duplicate geometry variant: {variant_id}")
                seen_variant_ids.add(variant_id)

                color = language_color(language_id)
                coverage = temporal_coverage(source, language_id, asher_quality)
                quality = str(coverage["quality"])
                normalized = {
                    "type": "Feature",
                    "id": feature_id,
                    "properties": {
                        "variant_id": variant_id,
                        "language_id": language_id,
                        "dataset_id": source.dataset_id,
                        "layer": source.layer,
                        "temporal_view": source.temporal_view,
                        "temporal_quality": quality,
                        "source_year": source.source_year,
                        "focal_year": source.focal_year,
                        "color": color,
                        "family": family_by_language.get(language_id),
                    },
                    "geometry": feature["geometry"],
                }
                output.write(json.dumps(normalized, ensure_ascii=False, separators=(",", ":")))
                output.write("\n")

                variants.append(
                    {
                        "id": variant_id,
                        "languageId": language_id,
                        "datasetId": source.dataset_id,
                        "layer": source.layer,
                        "label": source.label,
                        "featureId": feature_id,
                        "color": color,
                        "temporalCoverage": coverage,
                        "sourceYear": source.source_year,
                    }
                )
                variants_by_language[language_id].append(variant_id)
                feature_id += 1

    return variants, variants_by_language


def find_tippecanoe() -> str | None:
    local_binary = PROJECT_ROOT / ".tools/tippecanoe-src/tippecanoe"
    if local_binary.is_file():
        return str(local_binary)
    return shutil.which("tippecanoe")


def build_tiles() -> None:
    tippecanoe = find_tippecanoe()
    if tippecanoe is None:
        raise RuntimeError(
            "tippecanoe was not found. Run pipeline/atlas/bootstrap-tippecanoe.sh, "
            "or rerun with --skip-tiles."
        )

    PMTILES_ARCHIVE.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            tippecanoe,
            "--force",
            f"--output={PMTILES_ARCHIVE}",
            "--layer=language_areas",
            "--minimum-zoom=0",
            "--maximum-zoom=8",
            "--no-feature-limit",
            "--no-tile-size-limit",
            "--no-progress-indicator",
            "--simplification=10",
            "--include=variant_id",
            "--include=language_id",
            "--include=dataset_id",
            "--include=layer",
            "--include=temporal_view",
            "--include=temporal_quality",
            "--include=source_year",
            "--include=focal_year",
            "--include=color",
            "--include=family",
            str(NORMALIZED_GEOMETRIES),
        ],
        check=True,
    )


def build(skip_tiles: bool) -> None:
    rows, names = read_glottolog()
    language_rows = [row for row in rows if row["Level"] == "language"]
    known_languages = {str(row["Glottocode"]) for row in language_rows}
    family_by_language = {
        str(row["Glottocode"]): (
            names.get(str(row["Family_ID"])) if row["Family_ID"] is not None else None
        )
        for row in language_rows
    }

    variants, variants_by_language = normalize_geometries(known_languages, family_by_language)
    languages = []
    for row in language_rows:
        language_id = str(row["Glottocode"])
        countries = str(row["Countries"]).split(";") if row["Countries"] else []
        languages.append(
            {
                "id": language_id,
                "name": row["Name"],
                "iso6393": row["ISO639P3code"],
                "familyId": row["Family_ID"],
                "familyName": family_by_language[language_id],
                "macroarea": row["Macroarea"],
                "countries": countries,
                "latitude": row["Latitude"],
                "longitude": row["Longitude"],
                "geometryVariantIds": variants_by_language.get(language_id, []),
            }
        )

    languages.sort(key=lambda language: (str(language["name"]).casefold(), language["id"]))
    write_json(PUBLIC_DATA_DIR / "languages.json", languages)
    write_json(PUBLIC_DATA_DIR / "geometry-variants.json", variants)
    write_json(PUBLIC_DATA_DIR / "geography-datasets.json", DATASETS)
    write_json(
        PUBLIC_DATA_DIR / "manifest.json",
        {
            "schemaVersion": 2,
            "languageCount": len(languages),
            "languageWithGeometryCount": sum(
                bool(language["geometryVariantIds"]) for language in languages
            ),
            "geometryVariantCount": len(variants),
            "vectorLayer": "language_areas",
            "archive": "language-areas.pmtiles",
        },
    )

    if not skip_tiles:
        build_tiles()

    print(
        f"Exported {len(languages):,} languages and {len(variants):,} geometry variants "
        f"({sum(bool(language['geometryVariantIds']) for language in languages):,} languages covered)."
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--skip-tiles",
        action="store_true",
        help="Build catalogs and normalized GeoJSONL without invoking tippecanoe.",
    )
    args = parser.parse_args()
    build(skip_tiles=args.skip_tiles)


if __name__ == "__main__":
    main()
