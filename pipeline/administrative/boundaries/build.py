#!/usr/bin/env python3
"""Validate the boundary view and build its separate browser assets."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import tarfile
import tempfile
from collections import Counter, defaultdict
from pathlib import Path

from shapely.geometry import Point, Polygon
from shapely.validation import make_valid

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
PIN = HERE / "sources.json"
CROSSWALK = HERE / "crosswalk.json"
TOPOLOGY = ROOT / "data/administrative/boundaries/world-atlas-2.0.2-countries-50m.json"
ISO_ARCHIVE = ROOT / "data/administrative/boundaries/iso-3166-1-2.1.1.tgz"
CLDR_SOURCE = ROOT / "data/administrative/source/cldr_glottolog_joined.csv"
OUTPUT = ROOT / "app/public/administrative/boundaries"


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def iso_mapping(archive: Path) -> dict[str, str]:
    with tarfile.open(archive, mode="r:gz") as tar:
        member = tar.extractfile("package/dist/iso-3166.js")
        if member is None:
            raise ValueError("Pinned ISO package is missing its code table")
        source = member.read().decode("utf-8")
    pairs = re.findall(r"alpha2: '([A-Z]{2})',\s*alpha3: '[A-Z]{3}',\s*numeric: '(\d{3})'", source)
    mapping = dict(pairs)
    if len(pairs) != 249 or len(mapping) != len(pairs) or len(set(mapping.values())) != len(pairs):
        raise ValueError("Unexpected pinned ISO 3166-1 code inventory")
    return mapping


def territory_codes(source: Path) -> set[str]:
    with source.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames is None or "territory_code" not in reader.fieldnames:
            raise ValueError("Missing CLDR territory_code column")
        codes = {row["territory_code"] for row in reader}
    if not codes or any(not re.fullmatch(r"[A-Z]{2}", code) for code in codes):
        raise ValueError("Invalid CLDR territory inventory")
    return codes


def feature_id(index: int) -> str:
    return f"country-{index:03d}"


def decode_arcs(topology: dict) -> list[list[tuple[float, float]]]:
    transform = topology.get("transform")
    if not isinstance(transform, dict):
        raise TypeError("Expected quantized TopoJSON transform")
    scale, translate = transform["scale"], transform["translate"]
    decoded = []
    for arc in topology["arcs"]:
        x = y = 0
        points = []
        for dx, dy in arc:
            x += dx
            y += dy
            points.append((x * scale[0] + translate[0], y * scale[1] + translate[1]))
        if len(points) < 2:
            raise ValueError("Degenerate TopoJSON arc")
        decoded.append(points)
    return decoded


def ring(indices: list[int], arcs: list[list[tuple[float, float]]]) -> list[tuple[float, float]]:
    points: list[tuple[float, float]] = []
    for index in indices:
        actual = index if index >= 0 else ~index
        if actual >= len(arcs):
            raise ValueError("TopoJSON arc index exceeds source inventory")
        segment = arcs[actual] if index >= 0 else list(reversed(arcs[actual]))
        if points and points[-1] != segment[0]:
            raise ValueError("Disconnected TopoJSON ring")
        points.extend(segment if not points else segment[1:])
    if len(points) < 4 or points[0] != points[-1]:
        raise ValueError("Open or degenerate TopoJSON ring")
    return points


def representative_point(geometry: dict, arcs: list[list[tuple[float, float]]]) -> list[float]:
    kind = geometry["type"]
    if kind == "Polygon":
        parts = [geometry["arcs"]]
    elif kind == "MultiPolygon":
        parts = geometry["arcs"]
    else:
        raise ValueError(f"Unexpected country geometry type: {kind}")
    candidates = []
    for part in parts:
        exterior = ring(part[0], arcs)
        # An island crossing the antimeridian can look like a 360°-wide strip
        # to planar geometry. Ignore that artifact when choosing a marker.
        if max(x for x, _ in exterior) - min(x for x, _ in exterior) > 300 and not any(
            abs(x) < 150 for x, _ in exterior
        ):
            continue
        polygon = Polygon(exterior, [ring(hole, arcs) for hole in part[1:]])
        if polygon.is_empty:
            continue
        fixed = make_valid(polygon) if not polygon.is_valid else polygon
        pieces = list(fixed.geoms) if hasattr(fixed, "geoms") else [fixed]
        candidates.extend(
            piece for piece in pieces if piece.geom_type == "Polygon" and not piece.is_empty
        )
    if not candidates:
        raise ValueError("No usable country polygon for representative point")
    polygon = max(candidates, key=lambda shape: shape.area)
    point = polygon.representative_point()
    if not polygon.contains(point):
        raise ValueError("Representative point is outside country polygon")
    longitude, latitude = round(point.x, 6), round(point.y, 6)
    if not (-180 <= longitude <= 180 and -90 <= latitude <= 90) or not polygon.covers(
        Point(longitude, latitude)
    ):
        raise ValueError("Out-of-range representative point")
    return [longitude, latitude]


def compile_view(
    topology_path: Path, iso_archive: Path, cldr_source: Path, pin: dict, crosswalk: dict
) -> dict:
    from pipeline.administrative.boundaries.sources import check_file

    check_file(topology_path, pin["worldAtlas"])
    check_file(iso_archive, pin["iso3166"])
    topology = read_json(topology_path)
    country_object = topology.get("objects", {}).get("countries", {})
    if topology.get("type") != "Topology" or country_object.get("type") != "GeometryCollection":
        raise ValueError("Expected world-atlas countries TopoJSON")
    geometries = country_object["geometries"]
    if len(geometries) != pin["worldAtlas"]["featureCount"]:
        raise ValueError("Unexpected country geometry count")
    arcs = decode_arcs(topology)
    features = []
    feature_by_id = {}
    by_numeric = defaultdict(list)
    for index, geometry in enumerate(geometries):
        source_id = geometry.get("id")
        if source_id is not None and not re.fullmatch(r"\d{3}", source_id):
            raise ValueError("Unexpected world-atlas numeric ID")
        name = geometry.get("properties", {}).get("name")
        if not isinstance(name, str) or not name:
            raise ValueError("Unnamed world-atlas geometry")
        feature = {
            "featureId": feature_id(index),
            "topologyIndex": index,
            "sourceNumericId": source_id,
            "sourceName": name,
            "point": representative_point(geometry, arcs),
        }
        features.append(feature)
        feature_by_id[feature["featureId"]] = feature
        if source_id:
            by_numeric[source_id].append(feature["featureId"])

    if crosswalk.get("schemaVersion") != 1 or crosswalk.get("viewId") != pin["viewId"]:
        raise ValueError("Crosswalk schema or view mismatch")
    entries = crosswalk.get("territories")
    if not isinstance(entries, list):
        raise TypeError("Missing territory crosswalk entries")
    codes = territory_codes(cldr_source)
    if len(entries) != len(codes) or {row.get("code") for row in entries} != codes:
        raise ValueError("Crosswalk must explicitly cover every CLDR territory once")
    if [row["code"] for row in entries] != sorted(codes):
        raise ValueError("Crosswalk entries must be sorted by CLDR code")
    iso = iso_mapping(iso_archive)
    used_features: set[str] = set()
    statuses: Counter[str] = Counter()
    for row in entries:
        code, status = row["code"], row.get("status")
        ids = row.get("featureIds")
        if status not in {"matched", "ambiguous", "unmatched"} or not isinstance(ids, list):
            raise ValueError(f"Invalid crosswalk status or feature IDs for {code}")
        if len(set(ids)) != len(ids) or any(fid not in feature_by_id for fid in ids):
            raise ValueError(f"Unknown or repeated crosswalk feature for {code}")
        if status == "matched":
            numeric = iso.get(code)
            if numeric is None or row.get("sourceNumericCode") != numeric:
                raise ValueError(f"Matched territory lacks pinned ISO mapping: {code}")
            if ids != by_numeric.get(numeric):
                raise ValueError(
                    f"Matched territory must cover all and only its source geometries: {code}"
                )
            if used_features.intersection(ids):
                raise ValueError(f"Boundary geometry assigned to multiple territories: {code}")
            used_features.update(ids)
        else:
            if status == "unmatched" and ids:
                raise ValueError(f"Unmatched territory has polygon candidates: {code}")
            if status == "ambiguous" and not ids:
                raise ValueError(f"Ambiguous territory needs explicit candidates: {code}")
            if not row.get("reason"):
                raise ValueError(f"Unresolved territory needs an explanation: {code}")
        statuses[status] += 1
    if sum(statuses.values()) != len(codes):
        raise ValueError("Unexpected boundary crosswalk coverage")
    if crosswalk.get("unassignedFeatureIds") != [
        feature["featureId"] for feature in features if feature["featureId"] not in used_features
    ]:
        raise ValueError("Crosswalk must inventory every unassigned source geometry")
    return {
        "schemaVersion": 1,
        "viewId": pin["viewId"],
        "manifest": {
            "worldview": pin["worldview"],
            "worldAtlas": pin["worldAtlas"],
            "iso3166": pin["iso3166"],
            "crosswalkSha256": sha256(CROSSWALK.read_bytes()),
            "topologySha256": pin["worldAtlas"]["sha256"],
            "producerRevision": f"sha256:{sha256(Path(__file__).read_bytes())}",
            "coverage": {
                "featureCount": len(features),
                "matchedTerritories": statuses["matched"],
                "ambiguousTerritories": statuses["ambiguous"],
                "unmatchedTerritories": statuses["unmatched"],
                "unassignedFeatures": len(geometries) - len(used_features),
            },
            "attribution": [
                {
                    "name": "world-atlas 2.0.2",
                    "url": "https://github.com/topojson/world-atlas",
                    "license": "ISC",
                },
                {
                    "name": "Natural Earth 4.1.0 Admin-0",
                    "url": "https://www.naturalearthdata.com/",
                    "license": "public domain",
                },
                {
                    "name": "iso-3166-1 2.1.1",
                    "url": "https://www.npmjs.com/package/iso-3166-1",
                    "license": "MIT",
                },
            ],
        },
        "features": features,
    }


def expected_files(topology: Path, iso_archive: Path, cldr_source: Path) -> dict[str, bytes]:
    pin, crosswalk = read_json(PIN), read_json(CROSSWALK)
    index = compile_view(topology, iso_archive, cldr_source, pin, crosswalk)
    return {
        "geometry.topojson": topology.read_bytes(),
        "crosswalk.json": CROSSWALK.read_bytes(),
        "feature-index.json": (
            json.dumps(index, ensure_ascii=False, separators=(",", ":")) + "\n"
        ).encode(),
    }


def build(output: Path, files: dict[str, bytes]) -> None:
    output.mkdir(parents=True, exist_ok=True)
    for name, data in files.items():
        target = output / name
        if target.exists() and target.read_bytes() == data:
            continue
        with tempfile.NamedTemporaryFile(dir=output, prefix=".boundary-", delete=False) as handle:
            staged = Path(handle.name)
            try:
                handle.write(data)
                handle.flush()
                staged.replace(target)
            finally:
                staged.unlink(missing_ok=True)


def verify(output: Path, files: dict[str, bytes]) -> None:
    for name, data in files.items():
        target = output / name
        if not target.is_file() or target.is_symlink() or target.read_bytes() != data:
            raise ValueError(f"Missing or stale boundary asset: {target}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("build", "verify"))
    parser.add_argument("--topology", type=Path, default=TOPOLOGY)
    parser.add_argument("--iso-archive", type=Path, default=ISO_ARCHIVE)
    parser.add_argument("--cldr-source", type=Path, default=CLDR_SOURCE)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()
    try:
        files = expected_files(args.topology, args.iso_archive, args.cldr_source)
        if args.command == "build":
            build(args.output, files)
        verify(args.output, files)
    except (OSError, ValueError, KeyError, TypeError, tarfile.TarError) as error:
        parser.exit(1, f"Boundary {args.command} failed: {error}\n")
    print(f"Verified {len(files)} independent boundary assets in {args.output}")


if __name__ == "__main__":
    main()
