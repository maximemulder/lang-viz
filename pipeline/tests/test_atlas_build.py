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
    assert by_id["vari1234"]["bounds"] == [3, 0, 10, 1]
    assert by_id["vari1234"]["temporalCoverage"]["quality"] == "mixed"
    assert by_id["shar1234"]["temporalCoverage"]["quality"] == "direct"
    assert by_id["root1234"]["temporalCoverage"]["quality"] == "direct"
    normalized = [json.loads(line) for line in atlas.NORMALIZED_GEOMETRIES.read_text().splitlines()]
    parts = [f for f in normalized if f["properties"]["language_id"] == "vari1234"]
    assert [f["geometry"] for f in parts] == [f["geometry"] for f in original[3:6]]
    assert all(f["properties"]["level"] == "dialect" for f in parts)
    assert len({f["properties"]["variant_id"] for f in parts}) == 1
    assert len({f["id"] for f in normalized}) == len(normalized)


def test_camera_bounds_cross_dateline_and_reject_empty_geometry():
    geometry = {"type": "Polygon", "coordinates": [[[179, -2], [-179, -2], [-179, 3], [179, -2]]]}
    assert atlas.geometry_bounds([{"geometry": geometry}]) == [179, -2, 181, 3]
    with pytest.raises(ValueError, match="empty"):
        atlas.geometry_bounds([{"geometry": {"type": "Polygon", "coordinates": []}}])


def test_default_build_publishes_shared_lods_parts_and_camera_metadata(tmp_path, monkeypatch):
    from shapely import box

    from pipeline.tests.test_coverage_topology import feature as source_feature

    if not atlas.find_tile_join():
        pytest.skip("Build tile-join to exercise the default atlas entry point")
    public, processed = tmp_path / "public", tmp_path / "processed"
    normalized = processed / "areas.geojsonl"
    variant_id = "test:contemporary:lang1234"
    row = dict.fromkeys(
        [
            "ISO639P3code",
            "Family_ID",
            "Language_ID",
            "Macroarea",
            "Countries",
            "Latitude",
            "Longitude",
        ]
    )
    row.update(Glottocode="lang1234", Name="Language", Level="language")
    monkeypatch.setattr(atlas, "PUBLIC_DATA_DIR", public)
    monkeypatch.setattr(atlas, "PROCESSED_DIR", processed)
    monkeypatch.setattr(atlas, "NORMALIZED_GEOMETRIES", normalized)
    monkeypatch.setattr(atlas, "read_glottolog", lambda: ([row], {"lang1234": "Language"}))
    monkeypatch.setattr(atlas, "read_alternative_names", dict)
    monkeypatch.setattr(atlas, "read_parent_ids", lambda _: {})
    monkeypatch.setattr(atlas, "read_source_languoids", lambda *_: [])

    def normalize(*_):
        record = source_feature(variant_id, box(0.48, 0.48, 0.52, 0.52))
        record["properties"].update(
            language_id="lang1234", dataset_id="test", temporal_view="contemporary"
        )
        processed.mkdir(exist_ok=True)
        normalized.write_text(json.dumps(record) + "\n")
        return [
            {
                "id": variant_id,
                "languageId": "lang1234",
                "datasetId": "test",
                "temporalCoverage": {"viewId": "contemporary"},
                "sourceFile": "fixture.geojson",
                "sourceFeatureIds": ["1"],
                "bounds": [-7.2, -7.2, 7.2, 7.2],
            }
        ], {"lang1234": [variant_id]}

    monkeypatch.setattr(atlas, "normalize_geometries", normalize)
    atlas.build(jobs=1)
    manifest = json.loads((public / "manifest.json").read_text())
    assert manifest["geometryBuild"]["kind"] == "shared-coverage"
    assert manifest["geometryMaxZoom"] == 8
    assert (public / manifest["geometryProfiles"][0]["archive"]).is_file()
    assert json.loads((public / manifest["geometryBounds"]).read_text()) == {
        variant_id: [-7.2, -7.2, 7.2, 7.2]
    }
    profile = manifest["coverageParts"]["profiles"][0]
    parts = public / manifest["coverageParts"]["directory"]
    index = json.loads((parts / profile["tileIndex"]).read_text())
    assert set(index) == {str(z) for z in range(9)}
    assert all(
        (parts / profile["id"] / f"{z}-{xy}.pbf").is_file() for z in index for xy in index[z]
    )
    assert len(list((processed / "topology" / "canonical").rglob("*.jsonl.gz"))) == 1

    # Catalog refreshes must keep valid prepared branches and publish the same LODs.
    manifest["branchCoverage"] = {"directory": "branches/", "maxZoom": 0, "signatures": []}
    atlas.write_json(public / "manifest.json", manifest)
    atlas.build(jobs=1)
    assert json.loads((public / "manifest.json").read_text()) == manifest


def test_unmatched_references_are_reported_and_not_assigned_to_other_entries(source):
    source, _ = source
    with pytest.warns(UserWarning, match="Unmatched languoid IDs"):
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
    monkeypatch.setattr(
        atlas, "read_parent_ids", lambda ids: {"lang1234": "root1234", "dial1234": "lang1234"}
    )
    monkeypatch.setattr(atlas, "normalize_geometries", lambda *args: ([], {}))
    monkeypatch.setattr(atlas, "read_source_languoids", lambda *args: [])
    atlas.build(skip_tiles=True)
    exported = {r["id"]: r for r in json.loads((tmp_path / "languages.json").read_text())}
    assert len(exported) == 3
    assert exported["lang1234"]["classification"] == {"kind": "glottolog", "glottocode": "lang1234"}
    assert exported["dial1234"]["parentLanguageId"] == "lang1234"
    assert exported["dial1234"]["parentId"] == "lang1234"
    assert exported["lang1234"]["parentId"] == "root1234"
    assert exported["root1234"]["parentId"] is None
    assert json.loads((tmp_path / "manifest.json").read_text())["schemaVersion"] == 5
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


def test_classification_paths_export_immediate_parents_including_dialect_groups(
    tmp_path, monkeypatch
):
    path = tmp_path / "values.csv"
    pl.DataFrame(
        {
            "Language_ID": ["subf1234", "lang1234", "dial1234", "leaf1234", "root1234", "root1234"],
            "Parameter_ID": ["classification"] * 5 + ["subclassification"],
            "Value": [
                "root1234",
                "root1234/subf1234",
                "root1234/subf1234/lang1234",
                "root1234/subf1234/lang1234/dial1234",
                None,
                "ignored",
            ],
        }
    ).write_csv(path)
    monkeypatch.setattr(atlas, "GLOTTOLOG_VALUES", path)
    assert atlas.read_parent_ids(
        {"root1234", "subf1234", "lang1234", "dial1234", "leaf1234", "isol1234"}
    ) == {
        "subf1234": "root1234",
        "lang1234": "subf1234",
        "dial1234": "lang1234",
        "leaf1234": "dial1234",
    }


@pytest.mark.parametrize(
    "paths, message",
    [
        (["missing1"], "Unknown languoid"),
        (["root1234/leaf1234"], "Cyclic classification"),
        (["root1234/root1234"], "Cyclic classification"),
        (["root1234", "root1234"], "Duplicate classification"),
    ],
)
def test_invalid_classification_fails(tmp_path, monkeypatch, paths, message):
    path = tmp_path / "values.csv"
    pl.DataFrame(
        {
            "Language_ID": ["leaf1234"] * len(paths),
            "Parameter_ID": ["classification"] * len(paths),
            "Value": paths,
        }
    ).write_csv(path)
    monkeypatch.setattr(atlas, "GLOTTOLOG_VALUES", path)
    with pytest.raises(ValueError, match=message):
        atlas.read_parent_ids({"root1234", "leaf1234"})


def test_cycles_across_classification_paths_fail(tmp_path, monkeypatch):
    path = tmp_path / "values.csv"
    pl.DataFrame(
        {
            "Language_ID": ["root1234", "leaf1234"],
            "Parameter_ID": ["classification"] * 2,
            "Value": ["leaf1234", "root1234"],
        }
    ).write_csv(path)
    monkeypatch.setattr(atlas, "GLOTTOLOG_VALUES", path)
    with pytest.raises(ValueError, match="Cyclic classification"):
        atlas.read_parent_ids({"root1234", "leaf1234"})
