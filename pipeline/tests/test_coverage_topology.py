#!/usr/bin/env python3
import json
import math
import sqlite3

import mapbox_vector_tile
import numpy as np
import pytest
import shapely as geos
from shapely import Polygon, box
from shapely.errors import GEOSException
from shapely.geometry import shape

from pipeline.atlas.topology import (
    Partition,
    SourceAreaIndex,
    language_geometries,
    partition_sources,
    quantize_partition,
    simplify_partition,
    split_point_contacts,
    validate_coverage,
)
from pipeline.atlas.topology_build import (
    atomic_json,
    build,
    create_database,
    export_catalog,
    load_partition,
    restore_parts,
    save_partition,
    write_level,
)


def feature(variant, geometry):
    # Fixtures use normalized Mercator, like the canonical intermediate.
    def lnglat(coordinates):
        result = coordinates.copy()
        result[:, 0] = result[:, 0] * 360 - 180
        result[:, 1] = np.degrees(np.arctan(np.sinh(math.pi * (1 - 2 * result[:, 1]))))
        return result

    return {
        "type": "Feature",
        "properties": {"variant_id": variant},
        "geometry": json_geometry(geos.transform(geometry, lnglat)),
    }


def json_geometry(geometry):
    import json

    return json.loads(geos.to_geojson(geometry))


def test_partition_keeps_overlap_memberships_and_real_holes():
    parent = Polygon(
        box(0.2, 0.2, 0.6, 0.6).exterior.coords, [box(0.3, 0.3, 0.35, 0.35).exterior.coords]
    )
    child = box(0.4, 0.4, 0.7, 0.7)
    partition = partition_sources([feature("parent", parent), feature("child", child)])
    assert set(partition.memberships) == {(), ("parent",), ("child",), ("child", "parent")}
    reconstructed = language_geometries(partition)
    assert reconstructed["parent"].symmetric_difference(parent).area < 1e-8
    assert reconstructed["child"].symmetric_difference(child).area < 1e-8
    # The parent remains recoverable when the child is hidden.
    assert reconstructed["parent"].contains(geos.Point(0.5, 0.5))
    assert not reconstructed["parent"].contains(geos.Point(0.32, 0.32))


def test_source_component_edges_are_removed_before_lod():
    partition = partition_sources(
        [feature("a", box(0.2, 0.2, 0.4, 0.4)), feature("a", box(0.3, 0.2, 0.5, 0.4))]
    )
    assert partition.memberships == [("a",)]
    assert len(partition.faces) == 1


def test_shared_junctions_and_small_faces_survive_simplification():
    arc = [(0.5, 0.2), (0.500001, 0.3), (0.499999, 0.4), (0.5, 0.5)]
    inputs = [
        feature("left", Polygon([(0.2, 0.2), *arc, (0.5, 0.8), (0.2, 0.8), (0.2, 0.2)])),
        feature("top", Polygon([*arc, (0.8, 0.5), (0.8, 0.2), arc[0]])),
        feature("bottom", box(0.5, 0.5, 0.8, 0.8)),
        feature("small", box(0.85, 0.85, 0.85001, 0.85001)),
    ]
    partition = partition_sources(inputs)
    detailed = simplify_partition(partition, 8)
    coarse = simplify_partition(partition, 0)
    assert sum(geos.get_num_coordinates(coarse.faces)) < sum(
        geos.get_num_coordinates(detailed.faces)
    )
    assert not any(geos.is_empty(coarse.faces))
    assert coarse.memberships == partition.memberships
    validate_coverage(coarse.faces, "test")
    covered = geos.coverage_union_all(
        [f for f, m in zip(coarse.faces, coarse.memberships, strict=True) if m != ("small",)]
    )
    assert covered.symmetric_difference(box(0.2, 0.2, 0.8, 0.8)).area < 1e-8


def test_invalid_source_repair_is_recorded_and_can_be_rejected():
    invalid = feature(
        "bowtie", Polygon([(0.2, 0.2), (0.4, 0.4), (0.2, 0.4), (0.4, 0.2), (0.2, 0.2)])
    )
    with pytest.raises(ValueError, match="Invalid source geometry bowtie"):
        partition_sources([invalid], repair_invalid=False)
    partition = partition_sources([invalid])
    assert partition.repairs[0]["variantId"] == "bowtie"
    assert "Self-intersection" in partition.repairs[0]["reason"]
    assert set(partition.memberships) == {("bowtie",)}


def test_invalid_coverage_cannot_be_simplified_silently():
    partition = Partition(np.array([box(0, 0, 2, 2), box(1, 1, 3, 3)]), [("a",), ("b",)], {}, [])
    with pytest.raises(ValueError, match="invalid coverage"):
        validate_coverage(partition.faces, "input")


@pytest.mark.parametrize("diagonal", [False, True])
def test_parts_and_source_geometry_share_encoded_boundaries_across_tiles(tmp_path, diagonal):
    records = (
        [feature("a", Polygon(np.array([(8180, 8170), (8220, 8175), (8200, 8220)]) / 16384))]
        if diagonal
        else [
            feature("a", box(0.48, 0.48, 0.505, 0.52)),
            feature("b", box(0.495, 0.48, 0.52, 0.52)),
        ]
    )
    partition = partition_sources(records)
    low = simplify_partition(quantize_partition(partition, 1), 1)
    database = create_database(tmp_path / "source.mbtiles", 1)
    stats = write_level(low, 1, tmp_path, database)
    assert set(stats["tiles"]) == {"0-0", "0-1", "1-0", "1-1"}
    for x in range(2):
        for y in range(2):
            parts = mapbox_vector_tile.decode(
                (tmp_path / f"1-{x}-{y}.pbf").read_bytes(),
                default_options={"y_coord_down": True},
            )["overlap_coverage"]["features"]
            import gzip
            import json

            source = mapbox_vector_tile.decode(
                gzip.decompress(
                    database.execute(
                        "SELECT tile_data FROM tiles WHERE zoom_level=1 AND tile_column=? AND tile_row=?",
                        (x, 1 - y),
                    ).fetchone()[0]
                ),
                default_options={"y_coord_down": True},
            )["language_areas"]["features"]
            geometries = [shape(f["geometry"]) for f in parts]
            validate_coverage(np.array(geometries), "decoded tile")
            for variant in ("a",) if diagonal else ("a", "b"):
                selected = [
                    shape(f["geometry"])
                    for f in parts
                    if variant
                    in (
                        [f["properties"]["variantId"]]
                        if "variantId" in f["properties"]
                        else json.loads(f["properties"]["variantIds"])
                    )
                ]
                expected = geos.union_all(selected)
                actual = geos.union_all(
                    [
                        shape(f["geometry"])
                        for f in source
                        if f["properties"]["variant_id"] == variant
                    ]
                ).intersection(box(0, 0, 8192, 8192))
                assert actual.equals(expected)
    database.close()


def test_canonical_partition_cache_preserves_memberships_and_repairs(tmp_path):
    partition = partition_sources([feature("a", box(0.2, 0.2, 0.4, 0.4))])
    path = tmp_path / "partition.jsonl.gz"
    save_partition(path, partition)
    restored = load_partition(path)
    assert restored.memberships == partition.memberships
    assert restored.properties == partition.properties
    assert restored.repairs == partition.repairs
    assert geos.equals_exact(restored.faces, partition.faces, 0).all()


def test_shared_quantization_rebuilds_a_valid_mesh_when_small_faces_collapse():
    rng = np.random.default_rng(23)
    points = geos.multipoints((4096 + rng.uniform(-4, 4, (30, 2))) / 8192)
    bounds = box(4092 / 8192, 4092 / 8192, 4100 / 8192, 4100 / 8192)
    faces = geos.get_parts(geos.voronoi_polygons(points, extend_to=bounds))
    faces = geos.intersection(faces, bounds)
    faces = faces[~geos.is_empty(faces)]
    validate_coverage(faces, "input")
    partition = Partition(faces, [(str(i),) for i in range(len(faces))], {}, [])
    rounded = quantize_partition(partition, 0)
    validate_coverage(rounded.faces, "rounded")
    assert geos.union_all(
        [f for f, m in zip(rounded.faces, rounded.memberships, strict=True) if m]
    ).equals(bounds)
    assert not np.any(geos.get_precision(rounded.faces))


def test_collapsed_island_cannot_assign_its_membership_to_surrounding_region():
    tiny = box(0.5 - 1e-6, 0.5 - 1e-6, 0.5 + 1e-6, 0.5 + 1e-6)
    bounds = box(0.25, 0.25, 0.75, 0.75)
    partition = Partition(
        np.array([bounds.difference(tiny), tiny]), [("parent",), ("island",)], {}, []
    )
    rounded = quantize_partition(partition, 0)
    active = [(f, m) for f, m in zip(rounded.faces, rounded.memberships, strict=True) if m]
    assert len(active) == 1 and active[0][1] == ("parent",)
    assert active[0][0].equals(bounds)


def test_shell_hole_point_contact_is_decomposed_without_geometry_changes():
    # Minimized from the Asher world mesh: a hole touches its shell at the
    # same vertex as an exterior face. Both individual polygons are valid.
    small = Polygon([(0, 0), (1, 2), (2, 3), (3, 3), (0, 0)])
    large = Polygon(
        [(-49, 95), (0, 0), (103, -575), (-49, 95)], [[(0, 0), (-1, 0), (-2, -1), (0, 0)]]
    )
    faces, members, count = split_point_contacts(np.array([small, large]), [("a",), ("b",)])
    assert count > 0
    validate_coverage(faces, "decomposed")
    for expected, label in [(small, ("a",)), (large, ("b",))]:
        actual = geos.union_all([f for f, m in zip(faces, members, strict=True) if m == label])
        assert actual.equals(expected)


def test_area_transfer_across_processing_regions_counts_uncovered_area():
    partition = Partition(
        np.array([box(0.1, 0.1, 0.4, 0.4), box(0.4, 0.1, 0.7, 0.4)]),
        [("a", "parent"), ("b", "parent")],
        {},
        [],
    )
    index = SourceAreaIndex(partition)
    assert index.majority(box(0.35, 0.2, 0.6, 0.3)) == ("b", "parent")
    assert index.majority(box(0, 0, 0.3, 0.5)) == ()


def test_source_geometry_past_the_antimeridian_is_wrapped_without_area_loss():
    partition = partition_sources([feature("a", box(0.99, 0.45, 1.01, 0.55))])
    geometry = language_geometries(partition)["a"]
    assert geometry.contains(geos.Point(0.005, 0.5))
    assert geometry.contains(geos.Point(0.995, 0.5))
    assert 0 <= geometry.bounds[0] < geometry.bounds[2] <= 1
    assert abs(geometry.area - 0.002) < 1e-8


def test_failed_precision_candidate_keeps_its_original_membership(monkeypatch):
    original = box(0.25, 0.25, 0.5, 0.5)
    partition = Partition(np.array([original]), [("a",)], {}, [])
    native = geos.set_precision

    def fail_label_candidate(geometry, grid, **options):
        if grid == 1 / 8192 and any(g.equals(original) for g in np.atleast_1d(geometry)):
            raise GEOSException("Forced complex-hole precision failure")
        return native(geometry, grid, **options)

    monkeypatch.setattr(geos, "set_precision", fail_label_candidate)
    rounded = quantize_partition(partition, 0)
    assert rounded.memberships == [("a",)]
    assert rounded.faces[0].equals(original)
    assert rounded.stats["labelPrecisionFallbacks"][0]["members"] == ("a",)


def test_failed_candidate_cannot_be_masked_by_a_rounded_neighbor(monkeypatch):
    left, right = box(0.25, 0.25, 0.375, 0.5), box(0.375, 0.25, 0.5, 0.5)
    partition = Partition(np.array([left, right]), [("a",), ("b",)], {}, [])
    native = geos.set_precision

    def fail_and_expand(geometry, grid, **options):
        if grid == 1 / 8192:
            if any(g.equals(right) for g in np.atleast_1d(geometry)):
                raise GEOSException("Forced complex-hole precision failure")
            if isinstance(geometry, geos.Geometry) and geometry.equals(left):
                return box(0.25, 0.25, 0.5, 0.5)
        return native(geometry, grid, **options)

    monkeypatch.setattr(geos, "set_precision", fail_and_expand)
    rounded = quantize_partition(partition, 0)
    reconstructed = language_geometries(rounded)
    assert reconstructed["a"].equals(left)
    assert reconstructed["b"].equals(right)


def test_integrated_archive_parts_and_restore_use_the_canonical_cache(tmp_path):
    from pipeline.atlas.build import find_tile_join

    binary = find_tile_join()
    if not binary:
        pytest.skip("Build tile-join to exercise PMTiles packaging")
    source = tmp_path / "input.geojsonl"
    records = [
        feature("a", box(0.48, 0.48, 0.505, 0.52)),
        feature("b", box(0.495, 0.48, 0.52, 0.52)),
    ]
    for record in records:
        record["properties"].update(dataset_id="test", temporal_view="contemporary")
    source.write_text("\n".join(json.dumps(f) for f in records) + "\n")
    output, cache = tmp_path / "public", tmp_path / "cache"
    manifest = build(source, output, cache, binary, max_zoom=1)
    assert manifest["geometryMaxZoom"] == 1
    atomic_json(output / "manifest.json", manifest)
    assert (output / manifest["archive"]).stat().st_size > 0
    assert (output / manifest["geometryProfiles"][0]["archive"]).is_file()
    profile = manifest["coverageParts"]["profiles"][0]
    directory = output / manifest["coverageParts"]["directory"]
    path = directory / profile["id"] / "1-0-0.pbf"
    expected = path.read_bytes()
    archive_bytes = (output / manifest["archive"]).read_bytes()
    canonical_file = next(cache.glob("v*/test/contemporary.jsonl.gz"))
    canonical_file.unlink()
    path.unlink()
    restore_parts(source, output, cache)
    assert path.read_bytes() == expected
    assert not canonical_file.exists(), "A cached LOD must not require rebuilding the master"
    assert (output / manifest["archive"]).read_bytes() == archive_bytes
    # Resuming must also restore a lost source cache, even when parts and their
    # completion statistics survived. Otherwise packaging could publish no LODs.
    database_path = next(cache.glob("**/contemporary.mbtiles"))
    with sqlite3.connect(database_path) as database:
        source_tiles = database.execute("SELECT * FROM tiles ORDER BY 1, 2, 3").fetchall()
        database.execute("DELETE FROM tiles WHERE zoom_level=1")
    build(source, output, cache, binary, max_zoom=1)
    with sqlite3.connect(database_path) as database:
        assert database.execute("SELECT * FROM tiles ORDER BY 1, 2, 3").fetchall() == source_tiles
    # A source change cannot silently attach incompatible parts to old geometry.
    source.write_text(source.read_text() + "\n")
    with pytest.raises(ValueError, match="source or algorithm changed"):
        restore_parts(source, output, cache)


def test_preview_catalog_excludes_unbuilt_geometry_and_preserves_the_control(tmp_path):
    source, output = tmp_path / "control", tmp_path / "preview"
    source.mkdir()
    metadata = {
        "manifest.json": {
            "schemaVersion": 5,
            "geometryIndex": "geometry-index.json",
            "branchCoverage": {"directory": "old/"},
        },
        "languages.json": [
            {"id": "a", "geometryVariantIds": ["x", "y"]},
            {"id": "b", "geometryVariantIds": ["y"]},
        ],
        "geometry-variants.json": [
            {"id": "x", "datasetId": "one", "temporalCoverage": {"viewId": "contemporary"}},
            {"id": "y", "datasetId": "two", "temporalCoverage": {"viewId": "contemporary"}},
        ],
        "geometry-index.json": [{"id": "x"}, {"id": "y"}],
        "geography-datasets.json": [{"id": "one"}, {"id": "two"}],
    }
    for name, value in metadata.items():
        atomic_json(source / name, value)
    geometry = {
        "archive": "new.pmtiles",
        "geometryProfiles": [
            {"datasetId": "one", "viewId": "contemporary", "archive": "one.pmtiles"}
        ],
    }
    export_catalog(source, output, geometry)
    manifest = json.loads((output / "manifest.json").read_text())
    assert manifest["geometryVariantCount"] == 1 and manifest["languoidWithGeometryCount"] == 1
    assert "branchCoverage" not in manifest
    languages = json.loads((output / "languages.json").read_text())
    assert languages[0]["geometryVariantIds"] == ["x"] and languages[1]["geometryVariantIds"] == []
    assert json.loads((source / "languages.json").read_text()) == metadata["languages.json"]


def test_parallel_profiles_match_serial_geometry_and_cache_outputs(tmp_path):
    from pipeline.atlas.build import find_tile_join

    binary = find_tile_join()
    if not binary:
        pytest.skip("Build tile-join to exercise parallel PMTiles packaging")
    source = tmp_path / "input.geojsonl"
    records = []
    for dataset in ("larger", "smaller"):
        for label, geometry in [
            ("parent", box(0.48, 0.48, 0.52, 0.52)),
            ("child", box(0.495, 0.495, 0.505, 0.505)),
        ]:
            record = feature(f"{dataset}:{label}", geometry)
            record["properties"].update(dataset_id=dataset, temporal_view="contemporary")
            records.append(record)
    source.write_text("\n".join(json.dumps(record) for record in records) + "\n")
    manifests = []
    for name, jobs in [("serial", 1), ("parallel", 2)]:
        manifests.append(
            build(
                source,
                tmp_path / name / "public",
                tmp_path / name / "cache",
                binary,
                max_zoom=1,
                jobs=jobs,
            )
        )
    assert manifests[0] == manifests[1], "Scheduling must not change asset identities or ordering"
    serial, parallel = tmp_path / "serial", tmp_path / "parallel"
    tiles = sorted((serial / "public").rglob("*.pbf"))
    assert tiles
    for path in tiles:
        assert (
            path.read_bytes()
            == (parallel / "public" / path.relative_to(serial / "public")).read_bytes()
        )
    for path in (serial / "cache").rglob("*.mbtiles"):
        other = parallel / "cache" / path.relative_to(serial / "cache")
        with sqlite3.connect(path) as a, sqlite3.connect(other) as b:
            assert (
                a.execute("SELECT * FROM tiles ORDER BY 1, 2, 3").fetchall()
                == b.execute("SELECT * FROM tiles ORDER BY 1, 2, 3").fetchall()
            )
    report_name = manifests[1]["geometryBuild"]["report"]
    report = json.loads((parallel / "public" / report_name).read_text())
    assert report["execution"]["workers"] == 2
    assert len({p["timings"]["processId"] for p in report["profiles"].values()}) == 2
    # A resumed parallel build must reuse each profile's completed levels.
    build(source, parallel / "public", parallel / "cache", binary, max_zoom=1, jobs=2)
    report = json.loads((parallel / "public" / report_name).read_text())
    assert all(
        level["reused"]
        for profile in report["profiles"].values()
        for level in profile["timings"]["levels"].values()
    )


def test_failed_parallel_profile_preserves_the_published_archive(tmp_path):
    from pipeline.atlas.build import find_tile_join

    binary = find_tile_join()
    if not binary:
        pytest.skip("Build tile-join to exercise parallel PMTiles packaging")
    records = []
    for dataset in ("good", "bad"):
        record = feature(f"{dataset}:a", box(0.48, 0.48, 0.52, 0.52))
        record["properties"].update(dataset_id=dataset, temporal_view="contemporary")
        if dataset == "bad":
            del record["properties"]["variant_id"]
        records.append(record)
    source = tmp_path / "input.geojsonl"
    source.write_text("\n".join(json.dumps(record) for record in records) + "\n")
    output = tmp_path / "public"
    output.mkdir()
    archive = output / "language-areas.pmtiles"
    archive.write_bytes(b"previous published archive")
    with pytest.raises(KeyError, match="variant_id"):
        build(source, output, tmp_path / "cache", binary, max_zoom=1, jobs=2)
    assert archive.read_bytes() == b"previous published archive"
    assert not list(output.rglob("report.json")), "Incomplete profile sets cannot publish a report"
