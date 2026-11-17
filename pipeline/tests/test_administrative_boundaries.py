"""Policy and provenance checks for the pinned Natural Earth view."""

from __future__ import annotations

import copy
from pathlib import Path

import pytest

from pipeline.administrative.boundaries import build, sources


@pytest.fixture(scope="module")
def inputs() -> tuple[dict, dict]:
    if not (build.ARCHIVE.exists() and build.CLDR_SOURCE.exists()):
        pytest.skip("Restore pinned Natural Earth and CLDR sources")
    return build.read_json(build.PIN), build.read_json(build.CROSSWALK)


def test_pinned_view_and_browser_assets_agree(inputs: tuple[dict, dict]) -> None:
    pin, crosswalk = inputs
    index, geometry = build.compile_view(build.ARCHIVE, build.CLDR_SOURCE, pin, crosswalk)
    build.verify(build.OUTPUT, build.expected_files())
    assert index["manifest"]["coverage"] == {
        "featureCount": 242,
        "matchedTerritories": 236,
        "ambiguousTerritories": 1,
        "unmatchedTerritories": 21,
        "unassignedFeatures": 5,
    }
    assert len(geometry["features"]) == 242
    by_feature = {item["featureId"]: item for item in index["features"]}
    assert by_feature["country-NLD"]["bounds"][0] > 3  # Mainland focus, not Caribbean islands.
    assert by_feature["country-SOL"]["bounds"][2] < 50
    assert {
        item["sourceName"]
        for item in index["features"]
        if item["featureId"] in crosswalk["unassignedFeatureIds"]
    } == {"Somaliland", "Kosovo", "Northern Cyprus", "Indian Ocean Territories", "Siachen Glacier"}


def test_missing_cldr_territories_now_have_reviewed_shapes(inputs: tuple[dict, dict]) -> None:
    _, crosswalk = inputs
    by_code = {entry["code"]: entry for entry in crosswalk["territories"]}
    assert by_code["LY"]["featureIds"] == ["country-LBY"]
    assert by_code["OM"]["featureIds"] == ["country-OMN"]
    assert by_code["KW"]["featureIds"] == ["country-KWT"]
    assert by_code["SO"]["featureIds"] == ["country-SOM"]
    assert by_code["AU"]["featureIds"] == ["country-AUS", "country-ATC"]
    assert by_code["AU"]["excludedFeatureIds"] == ["country-IOA"]
    assert "country-SOL" in crosswalk["unassignedFeatureIds"]
    assert by_code["XK"]["status"] == "ambiguous"
    assert by_code["XK"]["featureIds"] == ["country-KOS"]
    assert by_code["TW"]["viewpointSensitive"] is True


def test_ambiguous_geometry_cannot_be_silently_matched(inputs: tuple[dict, dict]) -> None:
    pin, original = inputs
    crosswalk = copy.deepcopy(original)
    next(row for row in crosswalk["territories"] if row["code"] == "XK").update(
        status="matched", sourceNumericCode="383"
    )
    with pytest.raises(ValueError, match="numeric source features"):
        build.compile_view(build.ARCHIVE, build.CLDR_SOURCE, pin, crosswalk)


def test_crosswalk_must_cover_all_cldr_codes(inputs: tuple[dict, dict]) -> None:
    pin, original = inputs
    crosswalk = copy.deepcopy(original)
    crosswalk["territories"] = [row for row in crosswalk["territories"] if row["code"] != "LY"]
    with pytest.raises(ValueError, match="cover every CLDR territory"):
        build.compile_view(build.ARCHIVE, build.CLDR_SOURCE, pin, crosswalk)


def test_bad_archive_never_reaches_installed_asset(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, inputs: tuple[dict, dict]
) -> None:
    pin, _ = inputs
    monkeypatch.setattr(sources, "fetch_archive", lambda spec: b"not a pinned archive")
    archive = tmp_path / "countries.zip"
    with pytest.raises(ValueError, match="pinned size and SHA-256"):
        sources.restore(archive, pin)
    assert not archive.exists()
