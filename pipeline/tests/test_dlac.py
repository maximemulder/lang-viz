#!/usr/bin/env python3
import hashlib
import json
from dataclasses import replace
from zipfile import ZipFile

import pytest
import shapefile

from pipeline.atlas import build as atlas
from pipeline.dlac import prepare as dlac


@pytest.fixture
def dlac_archive(tmp_path, monkeypatch):
    stem = tmp_path / "ACSN_MajorLanguages_pgn_wgs84"
    rows = [
        (10, "Han Chinese Languages", "Hakka and Min Groups"),
        (11, "Han Chinese Languages", "Min Supergroup"),
        (12, "Han Chinese and Tibeto-Burman Languages", "Hui Group"),
        (13, "Han Chinese Languages", "Manderin Supergroup"),
        (14, "None (Uninhabited)", ""),
        (15, "Kam-Tai Languages", "Mandarin Supergroup"),
    ]
    with shapefile.Writer(str(stem), shapeType=shapefile.POLYGON) as writer:
        writer.field("CH_LANGS_", "N")
        writer.field("CH_LANGS_I", "N")
        writer.field("LANGUAGE_F", "C", size=80)
        writer.field("CHINESE_GR", "C", size=80)
        for source_id, family, group in rows:
            writer.poly([[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]])
            # The legacy ID intentionally repeats; the unique ID must be used.
            writer.record(source_id, 19, family, group)
    stem.with_suffix(".prj").write_text('GEOGCS["GCS_WGS_1984"]')
    archive_path = tmp_path / "source.zip"
    with ZipFile(archive_path, "w") as archive:
        for ext in ["shp", "shx", "dbf", "prj"]:
            path = stem.with_suffix(f".{ext}")
            archive.write(path, path.name)
    monkeypatch.setattr(
        dlac, "ARCHIVE_SHA256", hashlib.sha256(archive_path.read_bytes()).hexdigest()
    )
    known = {
        "sini1245",
        "mong1329",
        "turk1311",
        "kore1280",
        "hmon1336",
        "taik1256",
        "aust1307",
        "indo1319",
        "mand1415",
        "jiny1235",
        "wuch1236",
        "ganc1239",
        "huiz1242",
        "hakk1236",
        "xian1251",
        "minn1248",
        "ping1245",
        "yuec1235",
    }
    return archive_path, known


def test_shared_partial_and_ambiguous_assignments_survive_conversion(dlac_archive, tmp_path):
    archive_path, known = dlac_archive
    output = dlac.prepare(archive_path, tmp_path / "converted", known)
    features = json.loads(output.read_text())["features"]
    props = [feature["properties"] for feature in features]
    assert [p["cldf:languageReference"] for p in props] == [
        "hakk1236|minn1248",
        "minn1248",
        "huiz1242",
        None,
        None,
        None,
    ]
    assert [p["mappingStatus"] for p in props] == [
        "mapped",
        "mapped",
        "partial",
        "unmapped",
        "uninhabited",
        "inconsistent",
    ]
    assert [p["id"] for p in props] == [f"dlac:{i}" for i in range(10, 16)]
    assert props[3]["CHINESE_GR"] == "Manderin Supergroup"
    assert props[3]["assignments"][0]["label"] == "Mandarin Supergroup"
    assert props[2]["assignments"][0]["status"] == "unresolved"
    assert all(feature["geometry"]["type"] == "Polygon" for feature in features)
    report = json.loads(output.with_name("mapping-report.json").read_text())
    assert report["mappedFeatureCount"] == 3
    assert report["glottocodes"] == ["hakk1236", "huiz1242", "minn1248"]
    assert report["regionalCoverageOnly"] is True


def test_dlac_enters_normal_source_variants_without_descendant_assignment(
    dlac_archive, tmp_path, monkeypatch
):
    archive_path, known = dlac_archive
    source = replace(atlas.SOURCES[-1], path=archive_path)
    monkeypatch.setattr(atlas, "SOURCES", (source,))
    monkeypatch.setattr(atlas, "PROCESSED_DIR", tmp_path / "processed")
    monkeypatch.setattr(atlas, "NORMALIZED_GEOMETRIES", tmp_path / "processed/areas.geojsonl")
    monkeypatch.setattr(atlas, "read_asher_traditional_quality", dict)
    levels = {code: "family" if code == "minn1248" else "language" for code in known}
    levels["desc1234"] = "language"
    variants, references = atlas.normalize_geometries(set(levels), {}, levels)
    by_id = {v["languageId"]: v for v in variants}
    assert set(by_id) == {"hakk1236", "minn1248", "huiz1242"}
    assert "desc1234" not in references
    assert by_id["minn1248"]["sourceFeatureIds"] == ["dlac:10", "dlac:11"]
    assert by_id["minn1248"]["featureCount"] == 2
    assert by_id["minn1248"]["geometryKind"] == "source"
    assert by_id["minn1248"]["sourceYear"] == 1987
    assert by_id["minn1248"]["temporalCoverage"]["label"] == "China, 1985–1987"
    normalized = [json.loads(line) for line in atlas.NORMALIZED_GEOMETRIES.read_text().splitlines()]
    assert len(normalized) == 4
    assert len({f["id"] for f in normalized}) == 4
    assert all(f["properties"]["dataset_id"] == "dlac1987china" for f in normalized)


def test_changed_archive_and_unknown_catalog_ids_fail_before_export(dlac_archive, tmp_path):
    archive_path, known = dlac_archive
    output = tmp_path / "converted"
    with pytest.raises(ValueError, match="Unknown DLAC Glottocode"):
        dlac.prepare(archive_path, output, known - {"huiz1242"})
    archive_path.write_bytes(b"changed source")
    with pytest.raises(ValueError, match="checksum"):
        dlac.prepare(archive_path, output, known)
    assert not output.exists()


def test_unexpected_labels_require_an_explicit_crosswalk_change():
    record = {"LANGUAGE_F": "Unknown Languages", "CHINESE_GR": "", "CH_LANGS_": 1}
    with pytest.raises(ValueError, match="Unexpected DLAC label"):
        dlac.convert_record(record, {}, {})
