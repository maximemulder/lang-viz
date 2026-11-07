#!/usr/bin/env python3
# /// script
# requires-python = ">=3.12"
# dependencies = ["pyshp==3.1.6", "shapely==2.2.0", "pyproj==3.8.0"]
# ///
"""Audit DLAC against the locally generated atlas; never modify production artifacts.

Run: bash pipeline/dlac/fetch.sh && uv run --script pipeline/dlac/assess.py
Candidate correspondences are hypotheses, not an approved import crosswalk.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
from collections import Counter, defaultdict
from pathlib import Path
from zipfile import ZipFile

import shapefile
from pyproj import Transformer
from shapely import make_valid, transform
from shapely.geometry import shape
from shapely.ops import unary_union
from shapely.validation import explain_validity

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "data/processed/dlac-assessment"
ARCHIVE = ROOT / "datasets/dlac/raw/ACSN_MajorLanguages_pgn.zip"
SHA256 = "7cb94506f9e18d457b1234f99cbd42a11a4ce52552f33d97c07c3e47a956c5bb"

# Exact observed values, including truncations and the source's spelling error.
GROUPS = {
    "Manderin Supergroup": ["Mandarin Supergroup"],
    "Mandarin Sg and Shaozhou Tuhua": ["Mandarin Supergroup", "Shaozhou Tuhua"],
    "Mandarin Supergroup and Pinghu": ["Mandarin Supergroup", "Pinghua Group"],
    "Mandarin and Pinghua Groups": ["Mandarin Supergroup", "Pinghua Group"],
    "Hakka and Min Groups": ["Hakka Group", "Min Supergroup"],
    "Hakka and Yue (Cantonese) Grou": ["Hakka Group", "Yue (Cantonese) Group"],
}


def csv_rows(path):
    with path.open(encoding="utf-8-sig", newline="") as stream:
        return list(csv.DictReader(stream))


def write_csv(path, rows):
    with path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def assess():
    if hashlib.sha256(ARCHIVE.read_bytes()).hexdigest() != SHA256:
        raise ValueError("DLAC archive differs from the inspected V6.0 file")
    catalog = json.loads((ROOT / "app/public/data/languages.json").read_text())
    languages = {row["id"]: row for row in catalog}
    variants = json.loads((ROOT / "app/public/data/geometry-variants.json").read_text())
    candidates = csv_rows(Path(__file__).with_name("candidates.csv"))
    lookup = {(row["field"], row["label"]): row for row in candidates}
    for row in candidates:
        if row["glottocode"] and row["glottocode"] not in languages:
            raise ValueError(f"Unknown candidate Glottocode: {row}")

    # Read directly from the ZIP; no extraction or source-file changes.
    with ZipFile(ARCHIVE) as archive:
        stem = "ACSN_MajorLanguages_pgn_wgs84"
        reader = shapefile.Reader(
            **{ext: io.BytesIO(archive.read(f"{stem}.{ext}")) for ext in ["shp", "shx", "dbf"]}
        )
        crs = archive.read(f"{stem}.prj").decode()
        records = list(reader.iterShapeRecords())
        bbox = list(reader.bbox)

    by_candidate = defaultdict(list)
    assignments = []
    invalid = []
    raw_counts = {field: Counter() for field in ["LANGUAGE_F", "CHINESE_GR"]}
    source_ids = Counter()
    legacy_ids = Counter()
    unmapped = []
    shared = inconsistent = 0
    for entry in records:
        record = entry.record.as_dict()
        source_id = str(record["CH_LANGS_"])
        source_ids[source_id] += 1
        legacy_ids[str(record["CH_LANGS_I"])] += 1
        geometry = shape(entry.shape.__geo_interface__)
        if not geometry.is_valid:
            invalid.append({"source_id": source_id, "reason": explain_validity(geometry)})
        # Repair only the analysis copy; retain the original ZIP unchanged.
        analysis_geometry = make_valid(geometry) if not geometry.is_valid else geometry
        for field, counts in raw_counts.items():
            counts[record[field]] += 1
        family_label, group_label = record["LANGUAGE_F"], record["CHINESE_GR"]
        components = []
        if family_label != "None (Uninhabited)":
            for component in (
                family_label.removesuffix(" Languages")
                .replace(", and ", ", ")
                .replace(" and ", ", ")
                .split(", ")
            ):
                label = component + " Languages"
                if label == "Han Chinese Languages" and group_label:
                    continue
                components.append(("LANGUAGE_F", label))
            components.extend(
                ("CHINESE_GR", label)
                for label in GROUPS.get(group_label, [group_label] if group_label else [])
            )
        shared += len(components) > 1
        inconsistent += bool(group_label and "Han Chinese" not in family_label)
        pending = []
        for field, label in components:
            candidate = lookup[(field, label)]  # Fail on unexpected source labels.
            target = candidate["glottocode"]
            assignments.append(
                {
                    "source_id": source_id,
                    "legacy_id": record["CH_LANGS_I"],
                    "language_f": family_label,
                    "chinese_gr": group_label,
                    "component": label,
                    "glottocode": target,
                    "status": candidate["status"],
                }
            )
            if target:
                by_candidate[target].append(analysis_geometry)
            else:
                pending.append(label)
        if pending:
            unmapped.append({"source_id": source_id, "components": pending})

    # Classification-aware joins: count direct matches separately from descendants.
    children = defaultdict(list)
    for row in catalog:
        children[row["parentId"]].append(row["id"])

    def branch(node):
        found, stack = set(), [node]
        while stack:
            current = stack.pop()
            if current in found:
                raise ValueError("Cycle or duplicate in classification")
            found.add(current)
            stack.extend(children[current])
        return found

    typology = {
        name: {
            r["Glottocode"]
            for r in csv_rows(ROOT / f"datasets/{name}/cldf/languages.csv")
            if r["Glottocode"]
        }
        for name in ["wals", "diacl"]
    }
    summary_rows = []
    for candidate in candidates:
        target = candidate["glottocode"]
        if not target:
            continue
        node = languages[target]
        subtree = branch(target)
        own = [v for v in variants if v["languageId"] == target]
        row = {
            **candidate,
            "name": node["name"],
            "level": node["level"],
            "source_features": len(by_candidate.get(target, [])),
            "existing_own_sources": "|".join(sorted({v["datasetId"] for v in own})),
            "descendant_languages": sum(
                languages[n]["level"] == "language" for n in subtree - {target}
            ),
        }
        for name, codes in typology.items():
            row[name + "_direct"] = int(target in codes)
            row[name + "_descendant_languoids"] = len((subtree - {target}) & codes)
        summary_rows.append(row)

    # Compare only seven relatively clear language-level Chinese group candidates.
    # Family-wide and contested supergroup comparisons would exaggerate equivalence.
    compare_ids = {
        "jiny1235",
        "wuch1236",
        "ganc1239",
        "huiz1242",
        "hakk1236",
        "xian1251",
        "yuec1235",
    }
    project = Transformer.from_crs("EPSG:4326", "EPSG:6933", always_xy=True).transform
    projected = {
        node: transform(unary_union(by_candidate[node]), project, interleaved=False)
        for node in compare_ids
    }
    geographic = []
    cache = {}
    for variant in variants:
        node = variant["languageId"]
        if node not in compare_ids or variant["layer"] != "contemporary":
            continue
        folder = ROOT / "datasets/glottography" / variant["datasetId"] / "cldf"
        if variant["datasetId"] == "asher2007world":
            folder /= "contemporary"
        path = folder / variant["sourceFile"]
        if path not in cache:
            cache[path] = json.loads(path.read_text())["features"]
        geometries = [
            shape(f["geometry"])
            for f in cache[path]
            if node in (f["properties"].get("cldf:languageReference") or "").split("|")
        ]
        if not geometries:
            raise ValueError(f"Missing geometry for {variant['id']}")
        existing = transform(
            unary_union([make_valid(g) for g in geometries]), project, interleaved=False
        )
        incoming = projected[node]
        intersection = incoming.intersection(existing).area
        geographic.append(
            {
                "glottocode": node,
                "name": languages[node]["name"],
                "dataset": variant["datasetId"],
                "intersection_over_union": round(intersection / incoming.union(existing).area, 4),
                "dlac_area_covered_by_existing": round(intersection / incoming.area, 4),
                "existing_area_covered_by_dlac": round(intersection / existing.area, 4),
            }
        )

    mapped_ids = set(by_candidate)
    summary = {
        "doi": "10.7910/DVN/OHYYXH",
        "version": "6.0",
        "archive_sha256": SHA256,
        "feature_count": len(records),
        "bbox": bbox,
        "crs": crs,
        "invalid_geometries": invalid,
        "coordinate_count": sum(len(r.shape.points) for r in records),
        "unique_source_ids": len(source_ids),
        "duplicate_legacy_ids": {k: v for k, v in legacy_ids.items() if v > 1},
        "raw_label_counts": raw_counts,
        "shared_features": shared,
        "uninhabited_features": raw_counts["LANGUAGE_F"]["None (Uninhabited)"],
        "inconsistent_han_label_features": inconsistent,
        "features_with_unresolved_components": unmapped,
        "candidate_nodes_with_features": len(mapped_ids),
        "candidate_levels": Counter(languages[n]["level"] for n in mapped_ids),
        "candidate_nodes_without_existing_own_areas": sorted(
            mapped_ids - {v["languageId"] for v in variants}
        ),
        "direct_typology_matches": {
            name: sorted(codes & mapped_ids) for name, codes in typology.items()
        },
        "comparison_method": "Unclipped full source extents; EPSG:6933 equal-area planar measurements; make_valid on analysis copies only. Candidate matches are provisional. No ground-truth accuracy claim.",
        "production_catalog_sha256": hashlib.sha256(
            (ROOT / "app/public/data/languages.json").read_bytes()
        ).hexdigest(),
        "production_variants_sha256": hashlib.sha256(
            (ROOT / "app/public/data/geometry-variants.json").read_bytes()
        ).hexdigest(),
    }
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
    write_csv(OUTPUT / "assignments.csv", assignments)
    write_csv(OUTPUT / "candidate-coverage.csv", summary_rows)
    write_csv(OUTPUT / "boundary-comparison.csv", geographic)
    print(
        json.dumps(
            {
                k: summary[k]
                for k in [
                    "feature_count",
                    "candidate_nodes_with_features",
                    "candidate_levels",
                    "shared_features",
                    "uninhabited_features",
                    "candidate_nodes_without_existing_own_areas",
                ]
            },
            indent=2,
        )
    )
    print(f"Assessment written to {OUTPUT}")


if __name__ == "__main__":
    assess()
