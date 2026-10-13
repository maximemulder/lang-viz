#!/usr/bin/env python3
"""Summarise the Wikidata language extract using only the standard library."""

from __future__ import annotations

import csv
import math
import statistics
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "datasets" / "wikidata"
GLOTTOLOG = ROOT / "datasets" / "glottolog-cldf" / "cldf" / "languages.csv"


def rows(name: str) -> list[dict[str, str]]:
    with (DATA / name).open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def distinct(records: list[dict[str, str]], field: str) -> set[str]:
    return {record[field] for record in records if record.get(field)}


def print_macroarea_coverage(
    title: str,
    codes: set[str],
    glottolog_by_code: dict[str, dict[str, str]],
) -> None:
    totals = Counter(
        row["Macroarea"] or "(none)"
        for row in glottolog_by_code.values()
        if row["Level"] == "language"
    )
    covered = Counter(
        glottolog_by_code[code]["Macroarea"] or "(none)"
        for code in codes
        if code in glottolog_by_code and glottolog_by_code[code]["Level"] == "language"
    )
    print(f"  {title} by macroarea:")
    for macroarea in sorted(totals):
        print(
            f"    {macroarea}: {covered[macroarea]:,}/{totals[macroarea]:,} "
            f"({covered[macroarea] / totals[macroarea]:.1%})"
        )


def main() -> None:
    languages = rows("languages.csv")
    speakers = rows("speaker_counts.csv")
    official = rows("official_status.csv")
    scripts = rows("writing_systems.csv")
    glottolog = rows_from_path(GLOTTOLOG)

    glottolog_by_code = {row["Glottocode"]: row for row in glottolog}
    glottolog_languages = {
        code for code, row in glottolog_by_code.items() if row["Level"] == "language"
    }
    wikidata_codes = distinct(languages, "glottocode")
    matched_codes = wikidata_codes & set(glottolog_by_code)
    matched_languages = wikidata_codes & glottolog_languages
    matched_by_level = Counter(
        glottolog_by_code[code]["Level"] for code in matched_codes
    )
    qids_by_code: dict[str, set[str]] = defaultdict(set)
    codes_by_qid: dict[str, set[str]] = defaultdict(set)
    for row in languages:
        qids_by_code[row["glottocode"]].add(row["wikidata_id"])
        codes_by_qid[row["wikidata_id"]].add(row["glottocode"])

    statement_rows: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in speakers:
        statement_rows[row["statement_id"]].append(row)
    active_statement_rows = {
        key: group
        for key, group in statement_rows.items()
        if group[0]["rank"] != "deprecated"
    }
    speaker_statements = list(active_statement_rows)
    speaker_languages = {
        group[0]["glottocode"] for group in active_statement_rows.values()
    }
    speaker_scope = Counter()
    for group in active_statement_rows.values():
        names = {row.get("applies_to_part_name", "") for row in group}
        speaker_scope.update(name or "(unspecified)" for name in names)

    estimates = []
    for statement_id, group in active_statement_rows.items():
        try:
            value = float(group[0]["speaker_count"])
        except (TypeError, ValueError):
            continue
        if math.isfinite(value) and value >= 0:
            estimates.append(value)

    dated_statements = {
        statement_id
        for statement_id, group in active_statement_rows.items()
        if any(row["point_in_time"] for row in group)
    }
    sourced_statements = {
        statement_id
        for statement_id, group in active_statement_rows.items()
        if any(row["stated_in_id"] or row["reference_url"] for row in group)
    }
    estimate_years = []
    for statement_id, group in active_statement_rows.items():
        value = next((row["point_in_time"] for row in group if row["point_in_time"]), "")
        if value[:4].isdigit():
            estimate_years.append(int(value[:4]))

    today = date.today().isoformat()
    nondeprecated_official = [row for row in official if row["rank"] != "deprecated"]
    active_official = [
        row
        for row in nondeprecated_official
        if (not row["start_time"] or row["start_time"][:10] <= today)
        and (not row["end_time"] or row["end_time"][:10] >= today)
    ]
    official_pairs = {
        (row["glottocode"], row["jurisdiction_id"]) for row in active_official
    }
    official_languages = {code for code, _ in official_pairs}
    jurisdictions = {place for _, place in official_pairs}
    jurisdiction_iso_codes = {row["iso3166_1"] for row in active_official}
    script_pairs = {
        (row["glottocode"], row["writing_system_id"]) for row in scripts
    }

    top_scripts = Counter(
        row["writing_system_name"] or row["writing_system_id"] for row in scripts
    )
    per_language_estimates: dict[str, list[float]] = defaultdict(list)
    for statement_id, group in active_statement_rows.items():
        try:
            per_language_estimates[group[0]["glottocode"]].append(
                float(group[0]["speaker_count"])
            )
        except (TypeError, ValueError):
            pass

    print("Wikidata language extract")
    print(f"  Wikidata items: {len(distinct(languages, 'wikidata_id')):,}")
    print(f"  distinct Glottocodes: {len(wikidata_codes):,}")
    print(f"  codes found anywhere in local Glottolog: {len(matched_codes):,}")
    print(
        "  matched codes by Glottolog level: "
        + ", ".join(f"{level} {count:,}" for level, count in sorted(matched_by_level.items()))
    )
    print(f"  codes absent from local Glottolog: {len(wikidata_codes - set(glottolog_by_code)):,}")
    print(f"  Glottocodes linked to multiple Wikidata items: {sum(len(v) > 1 for v in qids_by_code.values()):,}")
    print(f"  Wikidata items linked to multiple Glottocodes: {sum(len(v) > 1 for v in codes_by_qid.values()):,}")
    print(f"  codes matching Glottolog language-level rows: {len(matched_languages):,}")
    print(f"  language-level Glottolog coverage: {len(matched_languages) / len(glottolog_languages):.1%}")
    print()
    print("Speaker counts")
    print(f"  languages: {len(speaker_languages):,}")
    print(f"  unique statements: {len(speaker_statements):,}")
    print(f"  deprecated statements retained but excluded above: {len(statement_rows) - len(active_statement_rows):,}")
    print(f"  Glottolog language-level coverage: {len(speaker_languages & glottolog_languages) / len(glottolog_languages):.1%}")
    print(f"  statements with point-in-time: {len(dated_statements):,} ({len(dated_statements) / max(len(speaker_statements), 1):.1%})")
    print(f"  statements with source item or URL: {len(sourced_statements):,} ({len(sourced_statements) / max(len(speaker_statements), 1):.1%})")
    if estimate_years:
        print(f"  median year among dated statements: {statistics.median(estimate_years):.0f}")
        print(f"  dated statements before 2000: {sum(year < 2000 for year in estimate_years):,}")
    if estimates:
        print(f"  median statement value: {statistics.median(estimates):,.0f}")
    print(f"  languages with multiple estimates: {sum(len(v) > 1 for v in per_language_estimates.values()):,}")
    print("  most common estimate scopes:")
    for name, count in speaker_scope.most_common(6):
        print(f"    {name}: {count:,}")
    print_macroarea_coverage("coverage", speaker_languages, glottolog_by_code)
    print()
    print("Official status")
    print(f"  languages: {len(official_languages):,}")
    print(f"  jurisdictions: {len(jurisdictions):,}")
    print(f"  distinct ISO 3166-1 codes: {len(jurisdiction_iso_codes):,}")
    print(f"  distinct language-jurisdiction pairs: {len(official_pairs):,}")
    print(f"  deprecated rows retained but excluded above: {len(official) - len(nondeprecated_official):,}")
    print(f"  non-deprecated historical/future rows excluded above: {len(nondeprecated_official) - len(active_official):,}")
    print(f"  Glottolog language-level coverage: {len(official_languages & glottolog_languages) / len(glottolog_languages):.1%}")
    print_macroarea_coverage("coverage", official_languages, glottolog_by_code)
    print()
    print("Writing systems")
    print(f"  languages: {len({code for code, _ in script_pairs}):,}")
    print(f"  distinct language-system pairs: {len(script_pairs):,}")
    print(f"  Glottolog language-level coverage: {len(({code for code, _ in script_pairs} & glottolog_languages)) / len(glottolog_languages):.1%}")
    print_macroarea_coverage(
        "coverage", {code for code, _ in script_pairs}, glottolog_by_code
    )
    print("  most frequent systems:")
    for name, count in top_scripts.most_common(10):
        print(f"    {name}: {count:,}")


def rows_from_path(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


if __name__ == "__main__":
    main()
