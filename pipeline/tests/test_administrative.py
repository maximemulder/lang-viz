#!/usr/bin/env python3
from __future__ import annotations

import base64
import csv
import hashlib
import io
import json
from pathlib import Path

import pytest

from pipeline.administrative import sources
from pipeline.administrative.build import COLUMNS, compile_data


def fixture(tmp_path: Path) -> tuple[Path, Path, dict]:
    source = tmp_path / "joined.csv"
    catalog = tmp_path / "languages.csv"
    rows = [
        {
            "territory_code": "AA",
            "un_containment_codes": "001",
            "language_raw_code": "en",
            "territory_population": "1000",
            "territory_gdp_usd": "10000.0",
            "territory_literacy_percent": "99",
            "population_percent": "40",
            "speaker_count": "400",
            "official_status": "official",
            "language_literacy_percent": "",
            "language_writing_percent": "",
            "iso639_3": "eng",
            "ID": "stan1293",
            "glottocode": "stan1293",
            "glottolog_name": "English",
            "family_glottocode": "indo1319",
            "glottolog_macroarea": "Eurasia",
            "latitude": "53.0",
            "longitude": "-1.0",
            "glottolog_countries": "AA",
        },
        {
            "territory_code": "AA",
            "un_containment_codes": "001",
            "language_raw_code": "en_Latn",
            "territory_population": "1000",
            "territory_gdp_usd": "10000.0",
            "territory_literacy_percent": "99",
            "population_percent": "40",
            "speaker_count": "400",
            "official_status": "unspecified",
            "language_literacy_percent": "",
            "language_writing_percent": "",
            "iso639_3": "eng",
            "ID": "stan1293",
            "glottocode": "stan1293",
            "glottolog_name": "English",
            "family_glottocode": "indo1319",
            "glottolog_macroarea": "Eurasia",
            "latitude": "53.0",
            "longitude": "-1.0",
            "glottolog_countries": "AA",
        },
    ]
    catalog_row = {
        "ID": "stan1293",
        "Glottocode": "stan1293",
        "Name": "English",
        "Level": "language",
        "Language_ID": "",
        "ISO639P3code": "eng",
        "Family_ID": "indo1319",
        "Macroarea": "Eurasia",
        "Latitude": "53.0",
        "Longitude": "-1.0",
        "Countries": "AA",
    }
    with source.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=COLUMNS)
        writer.writeheader()
        writer.writerows(rows)
    with catalog.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=catalog_row)
        writer.writeheader()
        writer.writerow(catalog_row)
        writer.writerow(
            {
                **catalog_row,
                "ID": "indo1319",
                "Glottocode": "indo1319",
                "Name": "Indo-European",
                "Level": "family",
                "ISO639P3code": "",
                "Family_ID": "",
                "Latitude": "",
                "Longitude": "",
                "Countries": "",
            }
        )

    def spec(path: Path) -> dict:
        return {
            "bytes": path.stat().st_size,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        }

    pin = {
        "sourceBranchCommit": "fixture",
        "cldrRelease": None,
        "cldrSourceFile": None,
        "joinedCsv": spec(source),
        "glottolog": spec(catalog),
    }
    return source, catalog, pin


def test_retains_script_rows_and_keeps_join_separate(tmp_path: Path) -> None:
    source, catalog, pin = fixture(tmp_path)
    result = compile_data(source, catalog, pin)
    assert len(result["observations"]) == 2
    assert [row["sourceLanguageCode"] for row in result["observations"]] == ["en", "en_Latn"]
    assert {row["glottocode"] for row in result["languageAssociations"]} == {"stan1293"}
    assert result["families"] == [{"id": "indo1319", "name": "Indo-European"}]
    assert result["atlasAssociations"] == [
        {
            "glottocode": "stan1293",
            "status": "unresolved",
            "matchMethod": None,
            "atlasLanguageId": None,
        }
    ]
    assert result["manifest"]["coverage"]["territoryGlottocodeDuplicateGroups"] == 1
    assert result["manifest"]["coverage"]["unmatchedGlottocodes"] == 0


def test_tampered_source_is_rejected_before_export(tmp_path: Path) -> None:
    source, catalog, pin = fixture(tmp_path)
    source.write_bytes(source.read_bytes() + b"\n")
    with pytest.raises(ValueError, match="modified pinned source"):
        compile_data(source, catalog, pin)


def test_restored_source_is_verified_and_modified_copy_is_preserved(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source, _, pin = fixture(tmp_path)
    output = tmp_path / "restored" / "joined.csv"
    monkeypatch.setattr(sources, "joined_from_github", lambda spec, pin: source.read_bytes())
    sources.restore_joined(output, pin)
    assert output.read_bytes() == source.read_bytes()
    output.write_bytes(b"modified")
    with pytest.raises(ValueError, match="modified pinned source"):
        sources.restore_joined(output, pin)
    assert output.read_bytes() == b"modified"


def test_bad_download_never_installs_source(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _, _, pin = fixture(tmp_path)
    output = tmp_path / "restored" / "joined.csv"
    monkeypatch.setattr(sources, "joined_from_github", lambda spec, pin: b"wrong")
    with pytest.raises(ValueError, match="modified pinned source"):
        sources.restore_joined(output, pin)
    assert not output.exists()


def test_github_blob_response_decodes_pinned_source(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source, _, pin = fixture(tmp_path)
    data = source.read_bytes()
    spec = {
        **pin["joinedCsv"],
        "repository": "example/repo",
        "path": "data/joined.csv",
        "blobSha": "abc123",
    }
    response = json.dumps(
        {
            "sha": "abc123",
            "encoding": "base64",
            "content": base64.b64encode(data).decode("ascii"),
        }
    ).encode("utf-8")
    monkeypatch.setattr(
        sources.urllib.request, "urlopen", lambda *args, **kwargs: io.BytesIO(response)
    )
    assert sources.joined_from_github(spec, pin) == data


@pytest.mark.parametrize(
    "column,value,message",
    [
        ("population_percent", "101", "Out-of-range"),
        ("speaker_count", "999", "does not match"),
        ("glottocode", "xxxx0000", "Unmatched Glottocode"),
        ("language_raw_code", "en", "Duplicate territory/language"),
    ],
)
def test_invalid_join_and_values_fail(
    tmp_path: Path, column: str, value: str, message: str
) -> None:
    source, catalog, pin = fixture(tmp_path)
    with source.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    rows[1][column] = value
    with source.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=COLUMNS)
        writer.writeheader()
        writer.writerows(rows)
    pin["joinedCsv"] = {
        "bytes": source.stat().st_size,
        "sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
    }
    with pytest.raises(ValueError, match=message):
        compile_data(source, catalog, pin)
