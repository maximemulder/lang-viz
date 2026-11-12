#!/usr/bin/env python3
"""Explicit full-snapshot gate and complete historical-table reconciliation.

Never invoked by ordinary fixture tests. Requires explicitly restored upstream
and comparison inputs; does not download or modify browser assets.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import Counter
from pathlib import Path

from pipeline.release_utils import digest

from .build import compile_data, load_tables, require, write_json
from .sources import ROOT, read_pin, source_directory, verify

LANGUAGE_COLUMNS = dict(
    zip(
        [
            "language_id",
            "language_name",
            "macroarea",
            "latitude",
            "longitude",
            "glottocode",
            "iso639_3",
            "family",
            "subfamily",
            "genus",
            "iso_codes",
            "sample_100",
            "sample_200",
            "country_ids",
            "language_source_refs",
            "parent_id",
        ],
        [
            "ID",
            "Name",
            "Macroarea",
            "Latitude",
            "Longitude",
            "Glottocode",
            "ISO639P3code",
            "Family",
            "Subfamily",
            "Genus",
            "ISO_codes",
            "Samples_100",
            "Samples_200",
            "Country_ID",
            "Source",
            "Parent_ID",
        ],
        strict=True,
    )
)


def historical_projection(tables: dict) -> dict:
    """Project upstream fields into the old cleaned schema, without consulting old values."""
    languages, features, codes = (tables[n + ".csv"] for n in ("languages", "parameters", "codes"))
    language_rows = {
        k: {target: row[source] for target, source in LANGUAGE_COLUMNS.items()}
        for k, row in languages.items()
        if not k.startswith(("family-", "subfamily-", "genus-"))
    }
    observations, counts = {}, Counter()
    for key, row in tables["values.csv"].items():
        lang = language_rows[row["Language_ID"]]
        feature = features[row["Parameter_ID"]]
        chapter = tables["chapters.csv"][feature["Chapter_ID"]]
        category = codes[row["Code_ID"]]
        observations[key] = {
            "observation_id": key,
            **{
                k: lang[k]
                for k in (
                    "language_id",
                    "language_name",
                    "glottocode",
                    "iso639_3",
                    "macroarea",
                    "latitude",
                    "longitude",
                    "family",
                    "subfamily",
                    "genus",
                )
            },
            "feature_id": row["Parameter_ID"],
            "feature_name": feature["Name"],
            "area": tables["areas.csv"][chapter["Area_ID"]]["Name"],
            "chapter_id": chapter["ID"],
            "code_id": category["ID"],
            "value_code": row["Value"],
            "value_label": category["Name"],
            "value_description": category["Description"],
            "source_refs": row["Source"],
            "comment_html": row["Comment"],
            "example_ids": row["Example_ID"],
        }
        counts[category["ID"]] += 1
    categories = {
        key: {
            "code_id": key,
            "feature_id": row["Parameter_ID"],
            "feature_name": features[row["Parameter_ID"]]["Name"],
            "value_code": row["Number"],
            "value_label": row["Name"],
            "value_description": row["Description"],
            "observed_languages": str(counts[key]),
        }
        for key, row in codes.items()
    }
    return {
        "languages_clean.csv": language_rows,
        "wals_clean_long.csv": observations,
        "category_codebook.csv": categories,
    }


def compare_rows(before: dict, after: dict) -> dict:
    changed = {}
    for key in sorted(before.keys() & after.keys()):
        old, new = before[key], after[key]
        diff = {
            column: {"before": old.get(column), "after": new.get(column)}
            for column in sorted(old.keys() | new.keys())
            if old.get(column) != new.get(column)
        }
        if diff:
            changed[key] = diff
    return {
        "beforeCount": len(before),
        "afterCount": len(after),
        "added": {key: after[key] for key in sorted(after.keys() - before.keys())},
        "removed": {key: before[key] for key in sorted(before.keys() - after.keys())},
        "changed": changed,
    }


def reconcile(directory: Path, comparison: Path, tables: dict) -> dict:
    verify(comparison, read_pin(True))
    projected = historical_projection(tables)
    report = {}
    for filename, key_column in [
        ("languages_clean.csv", "language_id"),
        ("wals_clean_long.csv", "observation_id"),
        ("category_codebook.csv", "code_id"),
    ]:
        with (comparison / filename).open(newline="", encoding="utf-8") as stream:
            rows = list(csv.DictReader(stream))
        before = {row[key_column]: row for row in rows}
        require(len(before) == len(rows), filename, "duplicate comparison ID")
        report[filename] = compare_rows(before, projected[filename])
    audit = json.loads((comparison / "audit.json").read_text())
    # Recheck the historical claim against actual new source bytes, not audit prose.
    audit_hashes = {}
    for name, sha in audit["raw_sha256"].items():
        path = directory / "cldf" / name
        current = digest(path)
        normalized = hashlib.sha256(path.read_bytes().replace(b"\r\n", b"\n")).hexdigest()
        audit_hashes[name] = {
            "historical": sha,
            "current": current,
            "explanation": "identical"
            if sha == current
            else "historical hash used LF line endings"
            if sha == normalized
            else "unexplained",
        }
    return {
        "tables": report,
        "historicalAuditHashes": audit_hashes,
        "differenceCount": sum(
            len(r[k]) for r in report.values() for k in ("added", "removed", "changed")
        ),
    }


def check(directory: Path, comparison: Path, output: Path) -> dict:
    bundle = compile_data(directory)
    _, tables, _ = load_tables(directory)
    report = reconcile(directory, comparison, tables)
    expected = json.loads(Path(__file__).with_name("snapshot.json").read_text())
    report["counts"] = bundle["diagnostics"]["counts"]
    report["observationsByFeature"] = bundle["diagnostics"]["observationsByFeature"]
    report["sourceCommit"] = read_pin()["commit"]
    report["comparisonCommit"] = read_pin(True)["commit"]
    report["passed"] = (
        report["counts"] == expected["counts"]
        and report["observationsByFeature"] == expected["observationsByFeature"]
        and report["differenceCount"] == expected["differenceCount"]
        and all(h["explanation"] != "unexplained" for h in report["historicalAuditHashes"].values())
    )
    write_json(output, report)  # Preserve the complete diff even when the gate fails.
    require(report["passed"], "snapshot", f"unexpected counts or differences; inspect {output}")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, default=source_directory())
    parser.add_argument("--comparison-dir", type=Path, default=source_directory(True))
    parser.add_argument(
        "--output", type=Path, default=ROOT / "app/test-results/wals-01/snapshot.json"
    )
    args = parser.parse_args()
    try:
        report = check(args.source_dir, args.comparison_dir, args.output)
    except (OSError, ValueError, KeyError, csv.Error) as error:
        parser.exit(1, f"WALS snapshot check failed: {error}\n")
    print(
        f"Passed: {report['counts']['sourceObservations']} observations; "
        f"{report['differenceCount']} historical differences. Report: {args.output}"
    )


if __name__ == "__main__":
    main()
