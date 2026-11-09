#!/usr/bin/env python3
"""Exercise the real tiler: valid individual polygons can still drift apart."""

import json
import math
import shutil
import subprocess
from collections import Counter
from itertools import pairwise
from pathlib import Path

import pytest

from pipeline.atlas import build as atlas


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
    binary = atlas.find_tippecanoe()
    decoder = Path(binary).with_name("tippecanoe-decode") if binary else None
    if not decoder or not decoder.is_file():
        decoder = shutil.which("tippecanoe-decode")
    if not binary or not decoder:
        pytest.skip("Build Tippecanoe and tippecanoe-decode to exercise tiled topology")
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
                # A one-cell island that the default area diffusion can discard.
                feature("tiny", [box(2600.8, 1400.8, 8)]),
                feature("host", [box(2700, 1400, 40), list(reversed(box(2710, 1410, 20)))]),
                feature("overlap", [box(2720, 1400, 40)]),
            ]
        )
        + "\n"
    )
    archive = directory / "areas.pmtiles"
    # Use the production command, without publishing real metadata/profiles.
    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(atlas, "NORMALIZED_GEOMETRIES", source)
        patch.setattr(atlas, "PMTILES_ARCHIVE", archive)
        patch.setattr(atlas, "build_geometry_profiles", lambda: None)
        atlas.build_tiles()

    def decode(z):
        x, y = math.floor(0.54 * 2**z), math.floor(0.32 * 2**z)
        decoded = json.loads(
            subprocess.check_output(
                [str(decoder), "--integer-coordinates", str(archive), str(z), str(x), str(y)],
                text=True,
            )
        )
        layer = decoded["features"][0]

        # Compare in a common 4096-unit world grid, independent of tile extent.
        def project(coordinates):
            if isinstance(coordinates[0], (int, float)):
                px, py = coordinates
                return [
                    (x + px / layer["properties"]["extent"]) * 4096 / 2**z,
                    (y + py / layer["properties"]["extent"]) * 4096 / 2**z,
                ]
            return [project(c) for c in coordinates]

        for f in layer["features"]:
            f["geometry"]["coordinates"] = project(f["geometry"]["coordinates"])
        return {f["properties"]["variant_id"]: f["geometry"] for f in layer["features"]}

    return decode


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
    assert abs(signed_area(tiny)) > 0
    assert all(2600 <= x <= 2608 and 1400 <= y <= 1408 for x, y in tiny)
    host = geometries["host"]["coordinates"]
    assert len(host) == 2, "A genuine hole must not be filled to hide simplification gaps"
    assert abs(signed_area(host[1])) > 0
    assert "overlap" in geometries, "Overlapping contributors must remain separate"
