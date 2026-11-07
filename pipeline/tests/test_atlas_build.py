#!/usr/bin/env python3
import json
from dataclasses import replace

import polars as pl
import pytest

from pipeline.atlas import build as atlas


def feature(glottocode, feature_id, year="2007", x=0):
    return {
        "type": "Feature",
        "properties": {
            "cldf:languageReference": glottocode,
            "id": feature_id,
            "year": year,
        },
        "geometry": {
            "type": "Polygon",
            "coordinates": [[[x, 0], [x + 1, 0], [x + 1, 1], [x, 0]]],
        },
    }


def collection(path, features):
    path.write_text(json.dumps({"type": "FeatureCollection", "features": features}))


@pytest.fixture
def source(tmp_path, monkeypatch):
    source = replace(
        atlas.SOURCES[1],
        path=tmp_path / "languages.geojson",
        supplementary_files=("families.geojson", "dialects.geojson", "features.geojson"),
    )
    collection(source.path, [feature("lang1234", "prepared-language")])
    collection(tmp_path / "families.geojson", [feature("root1234", "prepared-family")])
    collection(tmp_path / "dialects.geojson", [feature("dial1234", "prepared-dialect")])
    original = [
        feature("lang1234", "language-original"),
        feature("subf1234", "subfamily-original"),
        feature("dial1234", "dialect-original"),
        feature("vari1234", "dialect-part-1", "traditional", x=3),
        feature("vari1234", "dialect-part-2", x=5),
        feature("|shar1234|vari1234", "shared-original", "traditional", x=9),
        feature(None, "unassigned"),
    ]
    collection(tmp_path / "features.geojson", original)
    monkeypatch.setattr(atlas, "SOURCES", (source,))
    monkeypatch.setattr(atlas, "PROCESSED_DIR", tmp_path)
    monkeypatch.setattr(atlas, "NORMALIZED_GEOMETRIES", tmp_path / "areas.geojsonl")
    monkeypatch.setattr(atlas, "read_asher_traditional_quality", lambda: {"root1234": "direct"})
    return source, original


def test_all_levels_and_source_parts_without_aggregation(source):
    source, original = source
    levels = {
        "root1234": "family",
        "subf1234": "family",
        "lang1234": "language",
        "dial1234": "dialect",
        "vari1234": "dialect",
        "shar1234": "dialect",
        "none1234": "language",
    }
    variants, by_languoid = atlas.normalize_geometries(set(levels), {}, levels)
    by_id = {v["languageId"]: v for v in variants}
    assert set(by_id) == set(levels) - {"none1234"}
    assert all(len(ids) == 1 for ids in by_languoid.values())
    assert by_id["root1234"]["geometryKind"] == "dataset-family"
    assert by_id["dial1234"]["geometryKind"] == "dataset-dialect"
    assert by_id["subf1234"]["geometryKind"] == "source"
    assert by_id["vari1234"]["featureCount"] == 3
    assert by_id["vari1234"]["temporalCoverage"]["quality"] == "mixed"
    assert by_id["shar1234"]["temporalCoverage"]["quality"] == "direct"
    assert by_id["root1234"]["temporalCoverage"]["quality"] == "direct"
    normalized = [json.loads(line) for line in atlas.NORMALIZED_GEOMETRIES.read_text().splitlines()]
    parts = [f for f in normalized if f["properties"]["language_id"] == "vari1234"]
    assert [f["geometry"] for f in parts] == [f["geometry"] for f in original[3:6]]
    assert all(f["properties"]["level"] == "dialect" for f in parts)
    assert len({f["properties"]["variant_id"] for f in parts}) == 1
    assert len({f["id"] for f in normalized}) == len(normalized)


def test_unmatched_references_are_reported_and_not_assigned_to_other_entries(source):
    source, _ = source
    with pytest.warns(UserWarning, match="Unmatched Glottocodes"):
        groups = list(atlas.source_geometries(source, {"lang1234"}))
    assert [(languoid, file) for languoid, file, _ in groups] == [("lang1234", "languages.geojson")]


def test_duplicate_prepared_areas_fail(source):
    source, _ = source
    collection(source.path, [feature("lang1234", "a"), feature("lang1234", "b")])
    with pytest.raises(ValueError, match="Duplicate prepared area"):
        list(atlas.source_geometries(source, {"lang1234"}))


def test_catalog_exports_unmappable_entries_and_aliases_at_every_level(tmp_path, monkeypatch):
    rows = []
    for code, level in [("root1234", "family"), ("lang1234", "language"), ("dial1234", "dialect")]:
        rows.append(
            {
                "Glottocode": code,
                "Name": code,
                "Level": level,
                "ISO639P3code": None,
                "Family_ID": "root1234" if level != "family" else None,
                "Language_ID": "lang1234" if level == "dialect" else None,
                "Macroarea": None,
                "Countries": None,
                "Latitude": None,
                "Longitude": None,
            }
        )
    monkeypatch.setattr(atlas, "PUBLIC_DATA_DIR", tmp_path)
    monkeypatch.setattr(
        atlas, "read_glottolog", lambda: (rows, {r["Glottocode"]: r["Name"] for r in rows})
    )
    monkeypatch.setattr(atlas, "read_alternative_names", lambda: {"dial1234": ["上海", "Shànghǎi"]})
    monkeypatch.setattr(atlas, "normalize_geometries", lambda *args: ([], {}))
    atlas.build(skip_tiles=True)
    exported = {r["id"]: r for r in json.loads((tmp_path / "languages.json").read_text())}
    assert len(exported) == 3
    assert exported["dial1234"]["parentLanguageId"] == "lang1234"
    assert exported["dial1234"]["alternativeNames"] == ["上海", "Shànghǎi"]
    assert all(r["geometryVariantIds"] == [] for r in exported.values())
    assert json.loads((tmp_path / "manifest.json").read_text())["languoidCount"] == 3


def test_alternative_names_are_deduplicated(tmp_path, monkeypatch):
    path = tmp_path / "names.csv"
    pl.DataFrame({"Language_ID": ["dial1234"] * 3, "Name": ["上海", "上海", "Shànghǎi"]}).write_csv(
        path
    )
    monkeypatch.setattr(atlas, "GLOTTOLOG_NAMES", path)
    assert atlas.read_alternative_names() == {"dial1234": ["Shànghǎi", "上海"]}
