#!/usr/bin/env python3
"""Small lexical fixtures; no restored datasets or network required."""

import copy
import hashlib
import io
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from pipeline.etymology import build as adapter
from pipeline.etymology import sources


@pytest.fixture
def inputs():
    raw = {
        "MetaData": {"TimeStamp": "fixture", "JsonUrl": "https://example.invalid/export"},
        "Languages": {
            "10": {
                "Name": "Modern",
                "FkLanguageReliabilityId": 1,
                "FocalPointWgs84": {"Latitude": 0, "Longitude": "0"},
            },
            "20": {
                "Name": "Ancestor",
                "FkLanguageReliabilityId": 1,
                "TimeFrame": {"From": -1000, "Until": 0},
            },
        },
        "LanguageReliabilities": {"1": "Attested"},
        "Lexemes": {
            "1": {
                "FkLanguageId": 10,
                "FormTranscriptionPlain": "vīnum",
                "SourceReferences": [{"FkSourceId": 1, "Note": "word evidence"}],
            },
            "2": {
                "FkLanguageId": 20,
                "FormTranscriptionPlain": "ancestor",
                "SourceReferences": [{"FkSourceId": 1}],
            },
            "3": {
                "FkLanguageId": 20,
                "FormTranscriptionPlain": "placeholder",
                "SourceReferences": [{"FkSourceId": 999}],
            },
        },
        "Etymologies": {
            "4": {
                "FkParentId": 2,
                "FkChildId": 1,
                "FkReliabilityId": 4,
                "SourceReferences": [{"FkSourceId": 1, "LocationWithinSource": "p. 12"}],
            }
        },
        "EtymologicalReliabilities": {
            "0": {"Name": "Unspecified"},
            "4": {"Name": "Certainly borrowed"},
        },
        "Sources": {
            "1": {"CitationKey": "Example", "FullCitation": "Full citation"},
            "999": {"CitationKey": "Stub", "FullCitation": "Placeholder source"},
        },
        "WordLists": {
            "1": {
                "Name": "Collection",
                "WordListCategories": {
                    "1": {
                        "Name": "Category",
                        "WordListItems": {"9": {"Name": "wine", "ConnectedLexemes": [1, 2, 1]}},
                    }
                },
            }
        },
    }
    tree = {
        "MetaData": {"TimeStamp": "fixture tree"},
        "Root": {
            "Node": {"LanguageTreeId": 1, "Label": "root"},
            "Children": [
                {
                    "Node": {"LanguageTreeId": 2, "Label": "Family"},
                    "Children": [
                        {"Node": {"LanguageTreeId": 3, "Label": "Modern", "FkLanguageId": 10}}
                    ],
                }
            ],
        },
    }
    return raw, tree


def write_inputs(directory, inputs):
    directory.mkdir(exist_ok=True)
    for name, value in zip(("lexical-database.json", "language-tree.json"), inputs, strict=True):
        (directory / name).write_text(json.dumps(value), encoding="utf-8")


def test_preserves_zero_utf8_optional_values_and_distinct_evidence(inputs):
    raw, tree = inputs
    raw["Sources"]["1"]["Note"] = None
    result = adapter.compile_data(raw, tree)
    assert result["languages"]["10"]["lat"] == 0
    assert result["languages"]["10"]["lon"] == 0
    assert result["languages"]["10"]["path"] == ["Family", "Modern"]
    assert result["languages"]["20"]["family"] == "Unmapped in tree"
    assert result["languages"]["20"]["time"] == {"From": -1000, "Until": 0}
    assert result["languages"]["20"]["lat"] is None
    assert result["lexemes"]["1"]["f"] == "vīnum"
    assert result["lexemes"]["1"]["ipa"] == ""
    assert result["lexemes"]["3"]["stub"] is True
    assert result["concepts"]["9"]["lexemes"] == ["1", "2"]
    assert result["lexemes"]["1"]["refs"] != result["edges"][0]["refs"]
    assert result["types"]["0"] == "Unspecified"
    assert result["sources"]["1"]["Note"] == ""
    assert raw["Sources"]["1"]["Note"] is None


@pytest.mark.parametrize(
    ("table", "key", "field", "value", "message"),
    [
        ("Lexemes", "1", "FkLanguageId", 9999, "Lexemes.1.FkLanguageId: unknown"),
        ("Lexemes", "1", "FkLanguageId", True, "decimal identifier"),
        ("Lexemes", "1", "FormTranscriptionPlain", 42, "expected a string"),
        ("Lexemes", "1", "Meaning", [], "expected a string"),
        ("Lexemes", "1", "SourceReferences", None, "expected an array"),
        ("Etymologies", "4", "FkParentId", 9999, "FkParentId: unknown"),
        ("Etymologies", "4", "FkChildId", 9999, "FkChildId: unknown"),
        ("Etymologies", "4", "FkReliabilityId", 2, "FkReliabilityId: unknown"),
        ("Languages", "10", "FkLanguageReliabilityId", 5, "reliability: unknown"),
        ("Languages", "10", "TimeFrame", {"From": 1, "Until": -1}, "reversed time"),
        ("Languages", "10", "TimeFrame", {"From": True}, "integer year"),
        ("Languages", "10", "TimeFrame", {"Other": 1}, "unknown time field"),
        ("Sources", "1", "FullCitation", None, "expected a string"),
    ],
)
def test_invalid_records_fail_explicitly(inputs, table, key, field, value, message):
    raw, tree = inputs
    raw[table][key][field] = value
    with pytest.raises(adapter.DataError, match=message):
        adapter.compile_data(raw, tree)


@pytest.mark.parametrize("table,key", [("Lexemes", "1"), ("Etymologies", "4")])
def test_word_and_relationship_source_joins_are_both_validated(inputs, table, key):
    raw, tree = inputs
    raw[table][key]["SourceReferences"] = [{"FkSourceId": 9999}]
    with pytest.raises(adapter.DataError, match="FkSourceId: unknown"):
        adapter.compile_data(raw, tree)


def test_unknown_and_conflicting_concept_membership(inputs):
    raw, tree = inputs
    item = raw["WordLists"]["1"]["WordListCategories"]["1"]["WordListItems"]["9"]
    item["ConnectedLexemes"] = [99]
    with pytest.raises(adapter.DataError, match="concept 9 member: unknown"):
        adapter.compile_data(raw, tree)
    item["ConnectedLexemes"] = []
    raw["WordLists"]["2"] = copy.deepcopy(raw["WordLists"]["1"])
    raw["WordLists"]["2"]["WordListCategories"]["1"]["WordListItems"]["9"]["Name"] = "different"
    with pytest.raises(adapter.DataError, match="conflicting names"):
        adapter.compile_data(raw, tree)


@pytest.mark.parametrize(
    "point",
    [
        {"Latitude": "nan", "Longitude": 0},
        {"Latitude": 91, "Longitude": 0},
        {"Latitude": 0, "Longitude": "inf"},
        {"Latitude": 0, "Longitude": -181},
        {"Latitude": True, "Longitude": 0},
        {"Latitude": "bad", "Longitude": 0},
    ],
)
def test_invalid_coordinates_are_not_silently_omitted(inputs, point):
    raw, tree = inputs
    raw["Languages"]["10"]["FocalPointWgs84"] = point
    with pytest.raises(adapter.DataError, match="coordinate"):
        adapter.compile_data(raw, tree)


def test_incomplete_point_has_an_explicit_diagnostic(inputs):
    raw, tree = inputs
    raw["Languages"]["10"]["FocalPointWgs84"] = {"Latitude": 0}
    result = adapter.compile_data(raw, tree)
    assert result["languages"]["10"]["lat"] is None
    assert result["languages"]["10"]["lon"] is None
    assert result["diagnostics"] == [
        {"languageId": "10", "message": "Incomplete focal point omitted"}
    ]


def test_tree_rejects_ambiguous_placement_and_unknown_languages(inputs):
    raw, tree = inputs
    node = tree["Root"]["Children"][0]["Children"][0]
    duplicate = copy.deepcopy(node)
    duplicate["Node"]["LanguageTreeId"] = 4
    tree["Root"]["Children"].append(duplicate)
    with pytest.raises(adapter.DataError, match="duplicate language 10"):
        adapter.compile_data(raw, tree)
    duplicate["Node"]["FkLanguageId"] = 9999
    with pytest.raises(adapter.DataError, match="unknown identifier 9999"):
        adapter.compile_data(raw, tree)


def test_duplicate_json_keys_and_invalid_utf8_are_rejected(tmp_path):
    source = tmp_path / "bad.json"
    source.write_text('{"Lexemes": {}, "Lexemes": {}}')
    with pytest.raises(adapter.DataError, match="duplicate key Lexemes"):
        adapter.read_input(source)
    source.write_bytes(b"\xff")
    with pytest.raises(adapter.DataError, match="invalid UTF-8 JSON"):
        adapter.read_input(source)


def test_determinism_content_freshness_and_atomic_publication(inputs, tmp_path, monkeypatch):
    write_inputs(tmp_path, inputs)
    output = tmp_path / "output/word-trails.json"
    first = adapter.build(tmp_path, pinned=False)
    assert adapter.publish(first, output)
    original = output.read_bytes()
    original_mtime = output.stat().st_mtime_ns
    assert not adapter.publish(adapter.build(tmp_path, pinned=False), output)
    assert output.stat().st_mtime_ns == original_mtime
    assert b"v\xc4\xabnum" in original
    source = tmp_path / "lexical-database.json"
    stat = source.stat()
    inputs[0]["Lexemes"]["1"]["FormTranscriptionPlain"] = "changed"
    write_inputs(tmp_path, inputs)
    os.utime(source, ns=(stat.st_atime_ns, stat.st_mtime_ns))
    second = adapter.build(tmp_path, pinned=False)
    assert second["provenance"]["inputs"][0]["sha256"] != first["provenance"]["inputs"][0]["sha256"]

    def failed_replace(*_args):
        raise OSError("injected replacement failure")

    monkeypatch.setattr(adapter.os, "replace", failed_replace)
    with pytest.raises(OSError, match="injected"):
        adapter.publish(second, output)
    assert output.read_bytes() == original
    assert list(output.parent.iterdir()) == [output]
    monkeypatch.undo()
    assert adapter.publish(second, output)
    assert output.read_bytes() != original


def test_invalid_build_fails_under_python_optimization_without_replacing_output(inputs, tmp_path):
    inputs[0]["Etymologies"]["4"]["FkParentId"] = 9999
    write_inputs(tmp_path, inputs)
    output = tmp_path / "word-trails.json"
    output.write_text("previous working bundle")
    result = subprocess.run(
        [
            sys.executable,
            "-O",
            "-m",
            "pipeline.etymology.build",
            "--unpinned",
            "--source-dir",
            str(tmp_path),
            "--output-dir",
            str(tmp_path),
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 1
    assert "FkParentId: unknown" in result.stderr
    assert "Traceback" not in result.stderr
    assert output.read_text() == "previous working bundle"


def fixture_pin(inputs):
    contents = {
        name: json.dumps(value).encode()
        for name, value in zip(("lexical-database.json", "language-tree.json"), inputs, strict=True)
    }
    pin = {
        "files": [
            {
                "name": name,
                "url": f"https://example.invalid/{name}",
                "bytes": len(value),
                "sha256": hashlib.sha256(value).hexdigest(),
            }
            for name, value in contents.items()
        ]
    }
    return pin, contents


def test_source_restore_verifies_before_install_and_preserves_existing_inputs(
    inputs, tmp_path, monkeypatch
):
    pin, contents = fixture_pin(inputs)

    def download(url, **_kwargs):
        return io.BytesIO(contents[Path(url).name])

    monkeypatch.setattr(sources.urllib.request, "urlopen", download)
    output = tmp_path / "sources"
    sources.restore(output, pin)
    sources.verify(output, pin)
    monkeypatch.setattr(
        sources.urllib.request, "urlopen", lambda *_a, **_k: pytest.fail("downloaded twice")
    )
    sources.restore(output, pin)
    (output / "lexical-database.json").write_text("modified")
    with pytest.raises(ValueError, match="checksum/size mismatch"):
        sources.restore(output, pin)
    assert (output / "lexical-database.json").read_text() == "modified"


def test_invalid_download_is_never_installed(inputs, tmp_path, monkeypatch):
    pin, _contents = fixture_pin(inputs)
    monkeypatch.setattr(sources.urllib.request, "urlopen", lambda *_a, **_k: io.BytesIO(b"invalid"))
    output = tmp_path / "sources"
    with pytest.raises(ValueError, match="checksum/size mismatch"):
        sources.restore(output, pin)
    assert list(tmp_path.iterdir()) == []


def test_unpinned_sources_are_rejected_by_default(inputs, tmp_path):
    write_inputs(tmp_path, inputs)
    with pytest.raises(ValueError, match="checksum/size mismatch"):
        adapter.build(tmp_path)
