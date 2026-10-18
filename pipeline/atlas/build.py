#!/usr/bin/env python3
from __future__ import annotations

import argparse
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
        path=PROJECT_ROOT
        / "datasets/glottography/asher2007world/cldf/contemporary/languages.geojson",
    ),
    GeographySource(
        variant_prefix="asher2007world:traditional",
        dataset_id="asher2007world",
        layer="traditional",
        label="Asher — traditional",
        path=PROJECT_ROOT
        / "datasets/glottography/asher2007world/cldf/traditional/languages.geojson",
    ),
    GeographySource(
        variant_prefix="carling2025diacl:mixed",
        dataset_id="carling2025diacl",
        layer="mixed",
        label="DiACL — mixed periods",
        path=PROJECT_ROOT / "datasets/glottography/carling2025diacl/cldf/languages.geojson",
    ),
    GeographySource(
        variant_prefix="bouckaert2012indoeuropean:historical",
        dataset_id="bouckaert2012indoeuropean",
        layer="historical",
        label="Bouckaert — historical",
        path=PROJECT_ROOT
        / "datasets/glottography/bouckaert2012indoeuropean/cldf/languages.geojson",
    ),
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


def normalize_geometries(
    known_languages: set[str], family_by_language: dict[str, str | None]
) -> tuple[list[dict[str, Any]], dict[str, list[str]]]:
    variants: list[dict[str, Any]] = []
    variants_by_language: dict[str, list[str]] = defaultdict(list)
    seen_variant_ids: set[str] = set()
    feature_id = 1

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

                color = str(properties.get("fill") or "#cb5d3e")
                normalized = {
                    "type": "Feature",
                    "id": feature_id,
                    "properties": {
                        "variant_id": variant_id,
                        "language_id": language_id,
                        "dataset_id": source.dataset_id,
                        "layer": source.layer,
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
            "schemaVersion": 1,
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
