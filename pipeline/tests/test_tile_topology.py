#!/usr/bin/env python3
"""Shared borders, junctions, islands and holes survive native LOD export."""

import gzip
import json
import math
from collections import Counter
from itertools import pairwise

import mapbox_vector_tile
import pytest

from pipeline.atlas.topology import partition_sources, quantize_partition, simplify_partition
from pipeline.atlas.topology_build import create_database, write_level


def feature(label, rings):
    # Build in normalized Mercator space, then give the pipeline normal GeoJSON.
    def lnglat(point):
        x, y = point
        return [x * 360 - 180, math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y))))]

    return {
        "type": "Feature",
        "properties": {"variant_id": label},
        "geometry": {"type": "Polygon", "coordinates": [[lnglat(p) for p in r] for r in rings]},
    }


def box(x, y, width):
    return [
        (x / 4096, y / 4096),
        ((x + width) / 4096, y / 4096),
        ((x + width) / 4096, (y + width) / 4096),
        (x / 4096, (y + width) / 4096),
        (x / 4096, y / 4096),
    ]


@pytest.fixture(scope="module")
def tiles(tmp_path_factory):
    directory = tmp_path_factory.mktemp("topology")
    junction = (0.56, 0.351)
    left_arc = [
        (0.54, 0.35),
        (0.544, 0.3505),
        (0.548, 0.3493),
        (0.552, 0.3518),
        (0.556, 0.3498),
        junction,
    ]
    right_arc = [
        junction,
        (0.564, 0.3501),
        (0.568, 0.3522),
        (0.572, 0.3499),
        (0.576, 0.3506),
        (0.58, 0.35),
    ]
    bottom_arc = [
        junction,
        (0.5605, 0.355),
        (0.5593, 0.36),
        (0.561, 0.365),
        (0.5598, 0.37),
        (0.5604, 0.375),
        (0.56, 0.38),
    ]
    top = [(0.54, 0.32), (0.58, 0.32), *reversed(right_arc), *reversed(left_arc[:-1]), (0.54, 0.32)]
    left = [*left_arc, *bottom_arc[1:], (0.54, 0.38), left_arc[0]]
    right = [*right_arc, (0.58, 0.38), *reversed(bottom_arc)]
    source = directory / "areas.geojsonl"
    source.write_text(
        "\n".join(
            json.dumps(f)
            for f in [
                feature("top", [top]),
                feature("left", [left]),
                feature("right", [right]),
                # A small island must retain its location and area.
                feature("tiny", [box(2600.8, 1400.8, 8)]),
                feature("host", [box(2700, 1400, 40), list(reversed(box(2710, 1410, 20)))]),
                feature("overlap", [box(2720, 1400, 40)]),
            ]
        )
        + "\n"
    )
    partition = partition_sources(json.loads(line) for line in source.read_text().splitlines())
    database = create_database(directory / "areas.mbtiles", 2)
    for zoom in range(3):
        low = simplify_partition(quantize_partition(partition, zoom), zoom)
        write_level(low, zoom, directory, database)

    def decode(z):
        x, y = math.floor(0.54 * 2**z), math.floor(0.32 * 2**z)
        data = database.execute(
            "SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?",
            (z, x, 2**z - 1 - y),
        ).fetchone()[0]
        layer = mapbox_vector_tile.decode(
            gzip.decompress(data), default_options={"y_coord_down": True}
        )["language_areas"]

        # Compare in a common 4096-unit world grid, independent of tile extent.
        def project(coordinates):
            if isinstance(coordinates[0], (int, float)):
                px, py = coordinates
                return [
                    (x + px / layer["extent"]) * 4096 / 2**z,
                    (y + py / layer["extent"]) * 4096 / 2**z,
                ]
            return [project(c) for c in coordinates]

        for f in layer["features"]:
            f["geometry"]["coordinates"] = project(f["geometry"]["coordinates"])
        return {f["properties"]["variant_id"]: f["geometry"] for f in layer["features"]}

    yield decode
    database.close()


def signed_area(ring):
    return sum(a[0] * b[1] - b[0] * a[1] for a, b in pairwise(ring)) / 2


@pytest.mark.parametrize("zoom", [0, 1, 2])
def test_shared_arcs_and_junctions_survive_coarser_lods(tiles, zoom):
    geometries = tiles(zoom)
    rings = [geometries[label]["coordinates"][0] for label in ["top", "left", "right"]]
    xs, ys = zip(*(p for ring in rings for p in ring))
    left, right, top, bottom = min(xs), max(xs), min(ys), max(ys)
    edges = Counter((tuple(a), tuple(b)) for ring in rings for a, b in pairwise(ring))
    for (a, b), count in edges.items():
        exterior = (
            a[0] == b[0] == left
            or a[0] == b[0] == right
            or a[1] == b[1] == top
            or a[1] == b[1] == bottom
        )
        if not exterior:
            assert edges[b, a] == count, f"Unmatched shared boundary at zoom {zoom}: {a}, {b}"
    assert sum(abs(signed_area(ring)) for ring in rings) == (right - left) * (bottom - top)
    if zoom == 0:
        assert sum(map(len, rings)) < sum(
            len(tiles(2)[label]["coordinates"][0]) for label in ["top", "left", "right"]
        ), "Low zoom should still simplify the shared arcs"


def test_small_components_keep_their_location_and_genuine_holes_remain(tiles):
    geometries = tiles(0)
    tiny = geometries["tiny"]["coordinates"][0]
    assert abs(signed_area(tiny)) == pytest.approx(64)
    xs, ys = zip(*tiny)
    # Extent 8192 rounds within a quarter unit of this 4096-unit world grid.
    assert (min(xs), min(ys), max(xs), max(ys)) == pytest.approx(
        (2600.8, 1400.8, 2608.8, 1408.8), abs=0.25
    )
    host = geometries["host"]["coordinates"]
    assert len(host) == 2, "A genuine hole must not be filled to hide simplification gaps"
    assert abs(signed_area(host[1])) > 0
    assert "overlap" in geometries, "Overlapping contributors must remain separate"
