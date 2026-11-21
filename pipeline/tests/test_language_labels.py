import shapely as geos
from shapely.geometry import MultiPolygon, Polygon, box

from pipeline.atlas.labels import candidate_points, hierarchy_zooms, label_table, overview_points
from pipeline.atlas.topology import partition_sources, project
from pipeline.atlas.topology_cache import GeometrySettings, ProfileCache, ProfileSource
from pipeline.tests.test_coverage_topology import feature


def test_anchors_include_a_distant_component_and_avoid_holes():
    main = Polygon(
        box(0.1, 0.1, 0.2, 0.2).exterior.coords, [box(0.12, 0.12, 0.18, 0.18).exterior.coords]
    )
    nearby = [box(0.21 + i * 0.01, 0.1, 0.218 + i * 0.01, 0.108) for i in range(18)]
    offshore = box(0.78, 0.48, 0.785, 0.485)
    shape = MultiPolygon([main, *nearby, offshore])
    points = candidate_points(shape)
    assert any(offshore.contains(point) for point, _ in points)
    assert all(shape.contains(point) and clearance > 0 for point, clearance in points)
    assert len(points) <= 28


def test_central_anchor_handles_an_exterior_centroid_and_keeps_a_wider_fallback():
    shape = Polygon(
        [(0.1, 0.1), (0.18, 0.1), (0.18, 0.2), (0.35, 0.2), (0.35, 0.23), (0.1, 0.23)]
    )
    assert not shape.covers(shape.centroid)
    (central, clearance), (widest, wider_clearance), *_ = candidate_points(shape)
    assert shape.contains(central)
    assert central.distance(shape.centroid) < widest.distance(shape.centroid)
    assert clearance >= 0.59 * wider_clearance
    assert wider_clearance > clearance


def test_cohesive_overview_uses_coverage_centroid_over_a_cluster_of_small_members():
    footprint = box(0.1, 0.1, 0.4, 0.35)
    points = [(geos.Point(0.2, 0.32), "branch")] * 10
    anchors = overview_points(footprint, points, "Family")
    assert anchors[0][0].distance(footprint.centroid) < 1e-7
    assert all(footprint.contains(point) for point, _ in anchors)


def test_asset_uses_exact_variant_footprints_and_tracks_absent_lods(tmp_path, monkeypatch):
    mainland = box(0.2, 0.2, 0.34, 0.34)
    island = box(0.72, 0.72, 0.725, 0.725)
    shifted = box(0.45, 0.45, 0.6, 0.6)

    def area(variant, shape):
        record = feature(variant, shape)
        record["properties"]["language_id"] = "language"
        return record

    coarse = partition_sources([area("first", mainland), area("second", shifted)])
    fine = partition_sources(
        [area("first", MultiPolygon([mainland, island])), area("second", shifted)]
    )
    store = ProfileCache(
        tmp_path, ProfileSource("test", "now", tmp_path / "unused", "digest"), GeometrySettings()
    )
    monkeypatch.setattr(store, "get_or_build_lod", lambda zoom: ([coarse, fine][zoom], True))
    catalog = {
        "family": {"id": "family", "level": "family", "name": "Family"},
        "language": {
            "id": "language",
            "level": "language",
            "name": "An Individual Language",
            "parentId": "family",
        },
    }
    table = label_table(store, 1, catalog)
    rows = table["variants"]
    assert rows["first"]["path"] == rows["second"]["path"] == ["family", "language"]
    assert table["handoffZooms"]["family"] >= 2.5
    assert table["revealZooms"] == {"family": 0, "language": 2}

    def anchor_in(row, footprint):
        return footprint.covers(geos.transform(geos.Point(*row[:2]), project))

    assert any(anchor_in(row, island) and row[3] == 2 for row in rows["first"]["anchors"])
    assert all(anchor_in(row, shifted) and row[3] == 3 for row in rows["second"]["anchors"])
    assert all(row[4][1] >= row[4][0] for row in rows["first"]["anchors"])


def test_overview_assets_keep_the_owners_of_a_combined_anchor(tmp_path, monkeypatch):
    west = feature("west", box(0.1, 0.1, 0.24, 0.3))
    east = feature("east", box(0.22, 0.1, 0.32, 0.3))
    for record, language in [(west, "a"), (east, "b")]:
        record["properties"]["language_id"] = language
    partition = partition_sources([west, east])
    store = ProfileCache(
        tmp_path, ProfileSource("test", "now", tmp_path / "unused", "digest"), GeometrySettings()
    )
    monkeypatch.setattr(store, "get_or_build_lod", lambda zoom: (partition, True))
    catalog = {
        "root": {"id": "root", "level": "family", "name": "Root"},
        "a": {"id": "a", "level": "language", "name": "A", "parentId": "root"},
        "b": {"id": "b", "level": "language", "name": "B", "parentId": "root"},
    }
    anchor, owners = label_table(store, 1, catalog)["overviews"]["root"][0]
    assert abs(anchor[0] - (0.21 * 360 - 180)) < 0.05
    assert anchor[3] == 3
    assert owners == ["west"]


def test_reveal_zooms_follow_children_readiness_and_the_parent_reveal():
    paths = [
        ["root", "early", "a"],
        ["root", "early", "b"],
        ["root", "late", "c"],
        ["root", "late", "d"],
        ["isolate"],
    ]
    reveals, handoffs = hierarchy_zooms(
        paths,
        {
            "root": {"early": 0, "late": 1},
            "early": {"a": 0.5, "b": 1},
            "late": {"c": 1, "d": 5},
        },
    )
    assert reveals == {
        "root": 0,
        "isolate": 0,
        "early": 2,
        "late": 2,
        "a": 2.5,
        "b": 2.5,
        "c": 5,
        "d": 5,
    }
    assert handoffs == {"root": 2.5, "early": 4, "late": 5}
