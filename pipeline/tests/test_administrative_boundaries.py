"""Policy and provenance checks for the opt-in boundary view."""

from __future__ import annotations

import copy
import csv
import tarfile
from pathlib import Path

import pytest

from pipeline.administrative.boundaries import build, sources


@pytest.fixture(scope="module")
def inputs() -> tuple[dict, dict]:
    if not (build.TOPOLOGY.exists() and build.ISO_ARCHIVE.exists() and build.CLDR_SOURCE.exists()):
        pytest.skip("Restore pinned ADM-01/02 sources before integration checks")
    return build.read_json(build.PIN), build.read_json(build.CROSSWALK)


def test_pinned_view_and_browser_assets_agree(inputs: tuple[dict, dict]) -> None:
    pin, crosswalk = inputs
    index = build.compile_view(build.TOPOLOGY, build.ISO_ARCHIVE, build.CLDR_SOURCE, pin, crosswalk)
    build.verify(
        build.OUTPUT, build.expected_files(build.TOPOLOGY, build.ISO_ARCHIVE, build.CLDR_SOURCE)
    )
    assert index["manifest"]["coverage"] == {
        "featureCount": 241,
        "matchedTerritories": 230,
        "ambiguousTerritories": 1,
        "unmatchedTerritories": 20,
        "unassignedFeatures": 10,
    }


def test_disputed_and_split_geometries_have_explicit_outcomes(inputs: tuple[dict, dict]) -> None:
    _, crosswalk = inputs
    by_code = {entry["code"]: entry for entry in crosswalk["territories"]}
    assert by_code["XK"]["status"] == "ambiguous"
    assert by_code["XK"]["featureIds"] == ["country-130"]
    assert by_code["AC"]["status"] == "unmatched"
    assert by_code["AU"]["featureIds"] == ["country-225", "country-229"]
    assert by_code["TW"]["viewpointSensitive"] is True
    assert by_code["PS"]["viewpointSensitive"] is True
    assert "country-130" in crosswalk["unassignedFeatureIds"]


def test_ambiguous_geometry_cannot_be_silently_matched(inputs: tuple[dict, dict]) -> None:
    pin, source_crosswalk = inputs
    crosswalk = copy.deepcopy(source_crosswalk)
    next(entry for entry in crosswalk["territories"] if entry["code"] == "XK").update(
        status="matched", sourceNumericCode="383"
    )
    with pytest.raises(ValueError, match="pinned ISO mapping"):
        build.compile_view(build.TOPOLOGY, build.ISO_ARCHIVE, build.CLDR_SOURCE, pin, crosswalk)


def test_crosswalk_must_cover_all_cldr_codes(inputs: tuple[dict, dict]) -> None:
    pin, source_crosswalk = inputs
    crosswalk = copy.deepcopy(source_crosswalk)
    crosswalk["territories"] = [row for row in crosswalk["territories"] if row["code"] != "EH"]
    with pytest.raises(ValueError, match="cover every CLDR territory"):
        build.compile_view(build.TOPOLOGY, build.ISO_ARCHIVE, build.CLDR_SOURCE, pin, crosswalk)


def test_statistics_do_not_change_geometry_or_crosswalk(
    inputs: tuple[dict, dict], tmp_path: Path
) -> None:
    pin, crosswalk = inputs
    source = tmp_path / "territories.csv"
    with build.CLDR_SOURCE.open(encoding="utf-8-sig", newline="") as handle:
        records = list(csv.DictReader(handle))
    records[0]["speaker_count"] = "987654321"
    with source.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=records[0].keys())
        writer.writeheader()
        writer.writerows(records)
    original = build.compile_view(
        build.TOPOLOGY, build.ISO_ARCHIVE, build.CLDR_SOURCE, pin, crosswalk
    )
    altered = build.compile_view(build.TOPOLOGY, build.ISO_ARCHIVE, source, pin, crosswalk)
    assert altered == original


def test_bad_archive_never_reaches_installed_asset(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, inputs: tuple[dict, dict]
) -> None:
    pin, _ = inputs
    monkeypatch.setattr(sources, "fetch_archive", lambda spec: b"not a pinned archive")
    topology = tmp_path / "countries-50m.json"
    with pytest.raises(tarfile.TarError):
        sources.restore(topology, tmp_path / "iso.tgz", pin)
    assert not topology.exists()
