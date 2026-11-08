#!/usr/bin/env python3
import hashlib
import json
from dataclasses import replace
from zipfile import ZipFile

import pytest
import shapefile

from pipeline.atlas import build as atlas
from pipeline.atlas.catalog import read_source_languoids
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
        (16, "Mongolian and Han Chinese Languages", "Mandarin Supergroup"),
        (17, "Korean Languages", ""),
        (18, "Kam-Tai and Han Chinese Languages", "Mandarin Supergroup"),
        (19, "Tibeto-Burman Languages", ""),
        (20, "Han Chinese Languages", "Shaozhou Tuhua"),
        (21, "Han Chinese Languages", "Danzhou Dialect (Unclassified)"),
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
        "sino1245",
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
    known.update(entry["id"] for entry in read_source_languoids(known, {"dlac1987china"}))
    return archive_path, known


def test_shared_source_defined_and_inconsistent_assignments_survive_conversion(
    dlac_archive, tmp_path
):
    archive_path, known = dlac_archive
    output = dlac.prepare(archive_path, tmp_path / "converted", known)
    features = json.loads(output.read_text())["features"]
    props = [feature["properties"] for feature in features]
    assert [p["cldf:languageReference"] for p in props] == [
        "hakk1236|minn1248",
        "minn1248",
        "huiz1242",
        "mand1415",
        None,
        None,
        "mong1329|mand1415",
        "kore1280",
        "taik1256|mand1415",
        None,
        None,
        None,
    ]
    assert [p["mappingStatus"] for p in props] == [
        "mapped",
        "mapped",
        "mapped",
        "mapped",
        "uninhabited",
        "inconsistent",
        "mapped",
        "mapped",
        "mapped",
        "mapped",
        "mapped",
        "mapped",
    ]
    assert [p["id"] for p in props] == [f"dlac:{i}" for i in range(10, 22)]
    assert props[3]["CHINESE_GR"] == "Manderin Supergroup"
    assert props[3]["assignments"][0]["label"] == "Mandarin Supergroup"
    assert props[2]["assignments"][0]["status"] == "source-defined"
    assert props[2]["atlas:languageReference"] == "dlac1987china:tibeto-burman|huiz1242"
    assert [p["atlas:languageReference"] for p in props[9:]] == [
        "dlac1987china:tibeto-burman",
        "dlac1987china:shaozhou-tuhua",
        "dlac1987china:danzhou",
    ]
    assert all(feature["geometry"]["type"] == "Polygon" for feature in features)
    report = json.loads(output.with_name("mapping-report.json").read_text())
    assert report["mappedFeatureCount"] == 10
    assert report["sourceLanguoidIds"] == [
        "dlac1987china:danzhou",
        "dlac1987china:shaozhou-tuhua",
        "dlac1987china:tibeto-burman",
    ]
    assert len(report["languoidIds"]) == 10
    assert report["glottocodes"] == [
        "hakk1236",
        "huiz1242",
        "kore1280",
        "mand1415",
        "minn1248",
        "mong1329",
        "taik1256",
    ]
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
    families = {
        "sino1245",
        "sini1245",
        "mong1329",
        "turk1311",
        "hmon1336",
        "taik1256",
        "aust1307",
        "indo1319",
        "minn1248",
        "ping1245",
    }
    levels = {code: "family" if code in families else "language" for code in known}
    levels.update(
        {
            e["id"]: e["level"]
            for e in read_source_languoids(
                {code for code in known if ":" not in code}, {"dlac1987china"}
            )
        }
    )
    # Additional known descendants must not inherit any broad group polygon.
    levels.update({"desc1234": "language", "cmnd1234": "dialect"})
    variants, references = atlas.normalize_geometries(set(levels), {}, levels)
    by_id = {v["languageId"]: v for v in variants}
    assert set(by_id) == {
        "hakk1236",
        "minn1248",
        "huiz1242",
        "mand1415",
        "mong1329",
        "kore1280",
        "taik1256",
        "dlac1987china:tibeto-burman",
        "dlac1987china:shaozhou-tuhua",
        "dlac1987china:danzhou",
    }
    assert {"desc1234", "cmnd1234"}.isdisjoint(references)
    assert by_id["mand1415"]["sourceFeatureIds"] == ["dlac:13", "dlac:16", "dlac:18"]
    assert by_id["mong1329"]["sourceFeatureIds"] == ["dlac:16"]
    assert by_id["kore1280"]["sourceFeatureIds"] == ["dlac:17"]
    assert by_id["taik1256"]["sourceFeatureIds"] == ["dlac:18"]
    assert by_id["dlac1987china:tibeto-burman"]["sourceFeatureIds"] == ["dlac:12", "dlac:19"]
    assert by_id["minn1248"]["sourceFeatureIds"] == ["dlac:10", "dlac:11"]
    assert by_id["minn1248"]["featureCount"] == 2
    assert by_id["minn1248"]["geometryKind"] == "source"
    assert by_id["minn1248"]["sourceYear"] == 1987
    assert by_id["minn1248"]["temporalCoverage"]["label"] == "China, 1985–1987"
    normalized = [json.loads(line) for line in atlas.NORMALIZED_GEOMETRIES.read_text().splitlines()]
    assert len(normalized) == 14
    assert len({f["id"] for f in normalized}) == 14
    tibeto = [
        f for f in normalized if f["properties"]["language_id"] == "dlac1987china:tibeto-burman"
    ]
    assert all(f["properties"]["level"] == "group" for f in tibeto)
    assert all(f["properties"]["dataset_id"] == "dlac1987china" for f in normalized)


def test_changed_archive_and_unknown_catalog_ids_fail_before_export(dlac_archive, tmp_path):
    archive_path, known = dlac_archive
    output = tmp_path / "converted"
    with pytest.raises(ValueError, match="Unknown DLAC Glottocode"):
        dlac.prepare(archive_path, output, known - {"huiz1242"})
    with pytest.raises(ValueError, match="Unknown DLAC source languoid"):
        dlac.prepare(archive_path, output, known - {"dlac1987china:tibeto-burman"})
    archive_path.write_bytes(b"changed source")
    with pytest.raises(ValueError, match="checksum"):
        dlac.prepare(archive_path, output, known)
    assert not output.exists()


def test_unexpected_labels_require_an_explicit_crosswalk_change():
    record = {"LANGUAGE_F": "Unknown Languages", "CHINESE_GR": "", "CH_LANGS_": 1}
    with pytest.raises(ValueError, match="Unexpected DLAC label"):
        dlac.convert_record(record, {}, {})


def test_build_exports_source_entries_and_geometry_together(dlac_archive, tmp_path, monkeypatch):
    archive, known = dlac_archive
    rows = [
        {
            "Glottocode": code,
            "Name": code,
            "Level": "family" if code in {"sino1245", "sini1245"} else "language",
            "ISO639P3code": None,
            "Family_ID": None if code == "sino1245" else "sino1245",
            "Language_ID": None,
            "Macroarea": None,
            "Countries": None,
            "Latitude": None,
            "Longitude": None,
        }
        for code in known
        if ":" not in code
    ]
    monkeypatch.setattr(
        atlas,
        "read_glottolog",
        lambda: (
            rows,
            {r["Name"]: "Sino-Tibetan" if r["Name"] == "sino1245" else r["Name"] for r in rows},
        ),
    )
    monkeypatch.setattr(atlas, "read_alternative_names", dict)
    monkeypatch.setattr(atlas, "read_parent_ids", lambda ids: {"sini1245": "sino1245"})
    monkeypatch.setattr(atlas, "read_asher_traditional_quality", dict)
    monkeypatch.setattr(atlas, "SOURCES", (replace(atlas.SOURCES[-1], path=archive),))
    monkeypatch.setattr(atlas, "PROCESSED_DIR", tmp_path / "processed")
    monkeypatch.setattr(atlas, "NORMALIZED_GEOMETRIES", tmp_path / "processed/areas.geojsonl")
    monkeypatch.setattr(atlas, "PUBLIC_DATA_DIR", tmp_path / "public")
    atlas.build(skip_tiles=True)
    exported = {e["id"]: e for e in json.loads((tmp_path / "public/languages.json").read_text())}
    assert set(exported) == known
    for language_id in [code for code in known if ":" in code]:
        entry = exported[language_id]
        assert entry["classification"]["kind"] == "source"
        assert "glottocode" not in entry["classification"]
        assert entry["parentId"] == (
            "sino1245" if language_id.endswith(":tibeto-burman") else "sini1245"
        )
        assert entry["familyId"] == "sino1245"
        assert entry["familyName"] == "Sino-Tibetan"
        assert entry["parentLanguageId"] is None
        assert entry["geometryVariantIds"] == [f"dlac1987china:contemporary:{language_id}"]
    assert exported["huiz1242"]["classification"]["glottocode"] == "huiz1242"
    normalized = [json.loads(line) for line in atlas.NORMALIZED_GEOMETRIES.read_text().splitlines()]
    assert all(
        f["properties"]["family"] == "Sino-Tibetan"
        for f in normalized
        if f["properties"]["language_id"].startswith("dlac1987china:")
    )
