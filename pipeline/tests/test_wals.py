#!/usr/bin/env python3
"""Synthetic WALS inputs only: no network, historical checkout or generated browser data."""

import copy
import csv
import hashlib
import io
import json
import tarfile
from pathlib import Path
from unittest.mock import patch

import pytest

from pipeline.wals import build, sources
from pipeline.wals.bibliography import parse_bibtex
from pipeline.wals.snapshot import compare_rows, historical_projection


@pytest.fixture
def rows():
    language = {
        "ID": "aaa",
        "Name": "Recorded variety",
        "Macroarea": "Eurasia",
        "Longitude": "0",
        "Latitude": "0",
        "Glottocode": "abcd1234",
        "ISO639P3code": "aaa",
        "ISO_codes": "aaa bbb",
        "Family": "Family",
        "Subfamily": "",
        "Genus": "Genus",
        "Source": "Ref",
        "Country_ID": "XX",
        "Parent_ID": "family-a",
        "Samples_100": "false",
        "Samples_200": "true",
    }
    return {
        "languages": [
            language,
            {**language, "ID": "bbb", "Name": "Unobserved", "Longitude": "", "Latitude": ""},
            {
                **language,
                "ID": "family-a",
                "Parent_ID": "",
                "Name": "Family",
                "Longitude": "",
                "Latitude": "",
            },
        ],
        "parameters": [
            {"ID": key, "Name": f"Feature {key}", "Chapter_ID": "1", "Description": ""}
            for key in (*build.FEATURES, "99A")
        ],
        "codes": [
            {
                "ID": key + "-1",
                "Name": "Value",
                "Description": "<i>Qualified</i>",
                "Parameter_ID": key,
                "Number": "1",
            }
            for key in (*build.FEATURES, "99A")
        ],
        "values": [
            {
                "ID": "81A-aaa",
                "Language_ID": "aaa",
                "Parameter_ID": "81A",
                "Value": "1",
                "Code_ID": "81A-1",
                "Source": "Ref[12–15]",
                "Example_ID": "ex-1",
                "Comment": "<p>Only <b>main</b> clauses &amp; questions.</p><script>bad()</script>",
            },
            {
                "ID": "99A-aaa",
                "Language_ID": "aaa",
                "Parameter_ID": "99A",
                "Value": "1",
                "Code_ID": "99A-1",
                "Source": "Ref",
                "Example_ID": "",
                "Comment": "",
            },
        ],
        "chapters": [
            {
                "ID": "1",
                "Name": "Chapter",
                "Citation": "Author. Chapter.",
                "Contributor": "Author",
                "Number": "1",
                "Area_ID": "area",
                "Source": "Ref",
            }
        ],
        "areas": [{"ID": "area", "Name": "Area"}],
        "countries": [{"ID": "XX", "Name": "Example"}],
        "examples": [
            {
                "ID": "ex-1",
                "Language_ID": "aaa",
                "Primary_Text": "a b",
                "Analyzed_Word": "a\tb",
                "Gloss": "A\tB",
                "Translated_Text": "A B",
                "Comment": "<em>Qualification</em>",
            }
        ],
    }


def fixture_directory(root: Path, rows: dict) -> Path:
    root.mkdir(exist_ok=True)
    for entry in sources.read_pin()["files"]:
        path = root / entry["name"]
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("fixture")
    relations = {
        "languages": {"Parent_ID": "languages"},
        "parameters": {"Chapter_ID": "chapters"},
        "codes": {"Parameter_ID": "parameters"},
        "values": {
            "Language_ID": "languages",
            "Parameter_ID": "parameters",
            "Code_ID": "codes",
            "Example_ID": "examples",
        },
        "chapters": {"Area_ID": "areas"},
        "examples": {"Language_ID": "languages"},
    }
    metadata = {
        "dc:bibliographicCitation": "Fixture citation",
        "dc:license": "CC-BY-4.0",
        "tables": [],
    }
    for name, entries in rows.items():
        path = root / "cldf" / f"{name}.csv"
        with path.open("w", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=entries[0])
            writer.writeheader()
            writer.writerows(entries)
        columns = [
            {
                "name": key,
                **({"separator": ";" if name == "values" else " "} if key == "Source" else {}),
                **({"separator": " "} if key == "Example_ID" else {}),
                **({"required": True} if key == "ID" else {}),
            }
            for key in entries[0]
        ]
        foreign = [
            {
                "columnReference": [key],
                "reference": {"resource": target + ".csv", "columnReference": ["ID"]},
            }
            for key, target in relations.get(name, {}).items()
        ]
        metadata["tables"].append(
            {
                "url": name + ".csv",
                "tableSchema": {"primaryKey": ["ID"], "columns": columns, "foreignKeys": foreign},
            }
        )
    (root / "cldf/StructureDataset-metadata.json").write_text(json.dumps(metadata))
    (root / "cldf/sources.bib").write_text(
        "@book{Ref, author = {An Author}, title = {A {Nested} Title}, year = {2000}}\n"
    )
    return root


def test_records_evidence_and_missingness(tmp_path, rows):
    result = build.compile_data(fixture_directory(tmp_path, rows), pinned=False)
    assert result["provenance"]["snapshot"] is None
    assert result["provenance"]["commit"] is None
    assert set(result["records"]) == {"aaa", "bbb"}
    assert result["records"]["aaa"]["coordinates"] == [0, 0]
    assert result["records"]["bbb"]["coordinates"] is None
    assert result["records"]["aaa"]["glottocode"] == "abcd1234"
    assert result["records"]["aaa"]["isoCodes"] == ["aaa", "bbb"]
    assert result["diagnostics"]["counts"]["recordsWithoutShortlistedValues"] == 1
    assert result["diagnostics"]["counts"]["omittedNonShortlistedObservations"] == 1
    assert set(result["observations"]) == {"81A-aaa"}
    obs = result["observations"]["81A-aaa"]
    assert obs["references"] == [{"sourceId": "Ref", "pages": "12–15"}]
    assert obs["comment"] == "Only main clauses & questions."
    assert result["examples"]["ex-1"]["comment"] == "Qualification"
    assert result["references"]["Ref"]["fields"]["title"] == "A {Nested} Title"
    assert "atlasId" not in json.dumps(result)


@pytest.mark.parametrize(
    ("table", "index", "field", "value", "message"),
    [
        ("languages", 0, "Latitude", "nan", "nonfinite"),
        ("languages", 0, "Longitude", "181", "out-of-range"),
        ("languages", 0, "Latitude", "-91", "out-of-range"),
        ("languages", 0, "Latitude", "oops", "invalid coordinate"),
        ("languages", 0, "Parent_ID", "unknown", "unknown languages"),
        ("languages", 0, "Country_ID", "BAD", "unknown country"),
        ("languages", 1, "Source", "Missing", "unresolved bibliography"),
        ("parameters", 0, "Chapter_ID", "unknown", "unknown chapters"),
        ("codes", 0, "Number", "0", "positive integer"),
        ("values", 0, "Parameter_ID", "missing", "unknown parameters"),
        ("values", 0, "Code_ID", "12A-1", "category belongs"),
        ("values", 0, "Value", "2", "value differs"),
        ("values", 0, "Language_ID", "family-a", "classification record"),
        ("values", 0, "Example_ID", "missing", "unknown examples"),
        ("values", 0, "Source", "Ref[12", "invalid reference"),
        # Reject invalid evidence even when the observation will not ship to the browser.
        ("values", 1, "Source", "Unknown", "unresolved bibliography"),
        ("values", 1, "Code_ID", "81A-1", "category belongs"),
    ],
)
def test_invalid_sources_fail(tmp_path, rows, table, index, field, value, message):
    rows[table][index][field] = value
    with pytest.raises(ValueError, match=message):
        build.compile_data(fixture_directory(tmp_path, rows), pinned=False)


@pytest.mark.parametrize("kind", ["id", "pair", "category"])
def test_duplicates_fail(tmp_path, rows, kind):
    if kind == "category":
        rows["codes"].append({**rows["codes"][0], "ID": "another"})
    else:
        row = copy.deepcopy(rows["values"][0])
        if kind == "pair":
            row["ID"] = "another"
        rows["values"].append(row)
    with pytest.raises(ValueError, match="duplicate"):
        build.compile_data(fixture_directory(tmp_path, rows), pinned=False)


def test_partial_coordinate_diagnosed_invalid_half_not_hidden(tmp_path, rows):
    rows["languages"][0]["Latitude"] = ""
    result = build.compile_data(fixture_directory(tmp_path, rows), pinned=False)
    assert result["records"]["aaa"]["coordinates"] is None
    assert {"sourceId": "aaa", "reason": "incomplete"} in result["diagnostics"][
        "missingCoordinates"
    ]
    rows["languages"][0]["Longitude"] = "inf"
    with pytest.raises(ValueError, match="nonfinite"):
        build.compile_data(fixture_directory(tmp_path, rows), pinned=False)


def test_determinism_atomic_failure_and_content_validation(tmp_path, rows):
    directory = fixture_directory(tmp_path / "inputs", rows)
    output = tmp_path / "bundle.json"
    build.build(directory, output, pinned=False)
    before, timestamp = output.read_bytes(), output.stat().st_mtime_ns
    build.build(directory, output, pinned=False)
    assert output.read_bytes() == before and output.stat().st_mtime_ns == timestamp
    # Row order does not affect data. Provenance correctly changes with source bytes.
    for entries in rows.values():
        entries.reverse()
    fixture_directory(directory, rows)
    build.build(directory, output, pinned=False)
    old, new = json.loads(before), json.loads(output.read_bytes())
    assert old.pop("provenance") != new.pop("provenance")
    assert old == new
    before = output.read_bytes()
    with (
        patch.object(build.os, "replace", side_effect=OSError("replacement failure")),
        pytest.raises(OSError, match="replacement failure"),
    ):
        build.write_json(output, {"changed": True})
    assert output.read_bytes() == before
    assert not list(tmp_path.glob(".bundle.json-*"))
    (directory / "cldf/sources.bib").write_text("malformed")
    with pytest.raises(ValueError, match="syntax"):
        build.build(directory, output, pinned=False)
    assert output.read_bytes() == before


@pytest.mark.parametrize(
    "text",
    [
        "@book{A,title={unclosed}",
        "@book{A,title=macro}",
        '@book{A,title="first" # "second"}',
        "@book{A,title={one},title={two}}",
        "@book{A,title={one}} @book{a,title={two}}",
        "@book{A,title={one},crossref={B}}",
        "@string{month={January}}",
    ],
)
def test_bibliography_rejects_lossy_or_invalid_input(text):
    with pytest.raises(ValueError):
        parse_bibtex(text)


def test_bibliography_literals_and_sparse_source():
    result = parse_bibtex(
        r"@book{A, title={Nested {Title} with \{literal\}}, year=2000}"
        '@misc{B, note="Personal communication"}'
    )
    assert result["A"]["fields"]["title"] == r"Nested {Title} with \{literal\}"
    assert result["A"]["fields"]["year"] == "2000"
    assert result["B"]["fields"]["note"] == "Personal communication"


def archive_pin(tmp_path, *, malicious=None):
    archive = tmp_path / "fixture.tar.gz"
    data = b"a,b\n1,2\n"
    with tarfile.open(archive, "w:gz") as bundle:
        entry = tarfile.TarInfo("snapshot/cldf/values.csv")
        entry.size = len(data)
        if malicious == "symlink":
            entry.type = tarfile.SYMTYPE
            entry.linkname = "/tmp/elsewhere"
        bundle.addfile(entry, io.BytesIO(data))
        if malicious == "duplicate":
            bundle.addfile(entry, io.BytesIO(data))
    pin = {
        "archive": {
            "bytes": archive.stat().st_size,
            "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
            "prefix": "snapshot",
        },
        "files": [
            {
                "name": "cldf/values.csv",
                "bytes": len(data),
                "sha256": hashlib.sha256(data).hexdigest(),
            }
        ],
    }
    return archive, pin


def test_restore_verification_and_modified_installation(tmp_path):
    archive, pin = archive_pin(tmp_path)
    output = tmp_path / "restored"
    sources.restore(output, pin, archive=archive)
    sources.verify(output, pin)
    before = (output / "cldf/values.csv").stat().st_mtime_ns
    sources.restore(output, pin, archive=archive)
    assert (output / "cldf/values.csv").stat().st_mtime_ns == before
    (output / "cldf/values.csv").write_text("modified")
    with pytest.raises(ValueError, match="mismatch"):
        sources.restore(output, pin, archive=archive)
    assert (output / "cldf/values.csv").read_text() == "modified"


@pytest.mark.parametrize("failure", ["checksum", "member-checksum", "symlink", "duplicate", "path"])
def test_restore_failure_is_atomic(tmp_path, failure):
    archive, pin = archive_pin(tmp_path, malicious=failure)
    if failure == "checksum":
        archive.write_bytes(b"corrupt")
    elif failure == "member-checksum":
        pin["files"][0]["sha256"] = "0" * 64
    elif failure == "path":
        pin["files"][0]["name"] = "../outside"
    with pytest.raises(ValueError):
        sources.restore(tmp_path / "restored", pin, archive=archive)
    assert not (tmp_path / "restored").exists()
    assert not list(tmp_path.glob(".restored-*"))


def test_missing_pin_and_no_implicit_download(tmp_path, rows):
    directory = fixture_directory(tmp_path, rows)
    with (
        patch.object(sources.urllib.request, "urlopen", side_effect=AssertionError("network")),
        pytest.raises(ValueError, match="mismatch"),
    ):
        build.compile_data(directory)


def test_comparison_preserves_all_columns_and_reports_every_change(rows):
    tables = {name + ".csv": {r["ID"]: r for r in entries} for name, entries in rows.items()}
    projection = historical_projection(tables)
    old = projection["wals_clean_long.csv"]
    assert "99A-aaa" in old
    assert old["81A-aaa"]["comment_html"].startswith("<p>")
    updated = copy.deepcopy(old)
    updated["81A-aaa"]["value_label"] = "changed"
    updated["81A-aaa"]["source_refs"] = "Ref[99]"
    del updated["99A-aaa"]
    updated["new"] = {"value_label": "added"}
    report = compare_rows(old, updated)
    assert set(report["changed"]["81A-aaa"]) == {"value_label", "source_refs"}
    assert set(report["removed"]) == {"99A-aaa"}
    assert set(report["added"]) == {"new"}
