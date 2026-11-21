"""Prepare a small, versioned label table from each profile's display geometry."""

from __future__ import annotations

import json
import math
import unicodedata
from collections import defaultdict
from pathlib import Path
from typing import Any

import shapely as geos
from shapely.geometry import Point
from shapely.geometry.base import BaseGeometry

from pipeline.atlas.topology import Partition, language_geometries, polygons
from pipeline.atlas.topology_cache import (
    GeometrySettings,
    ProfileCache,
    ProfileSource,
    atomic_json,
    fingerprint,
)

SCHEMA_VERSION = 1
MAX_LABEL_ZOOM = 12
COMPONENT_LIMIT = 8

type Catalog = dict[str, dict[str, Any]]
type Anchor = tuple[float, float, float, int, list[float]]


def label_paths(catalog: Catalog, language_ids: dict[str, str]) -> dict[str, list[str]]:
    """Choose one mapped intermediate branch between the root and the leaf."""
    paths: dict[str, list[str]] = {}
    for variant, language_id in language_ids.items():
        language = catalog[language_id]
        if language["level"] == "dialect" and language.get("parentLanguageId") in catalog:
            language = catalog[language["parentLanguageId"]]
        ancestry = [language["id"]]
        parent = language.get("parentId")
        while parent in catalog and parent not in ancestry:
            ancestry.append(parent)
            parent = catalog[parent].get("parentId")
        paths[variant] = ancestry[::-1]

    children: dict[str, set[str]] = defaultdict(set)
    endpoints: dict[str, set[str]] = defaultdict(set)
    for path in paths.values():
        for parent, child in zip(path, path[1:]):
            children[parent].add(child)
            endpoints[parent].add(path[-1])

    result = {}
    for variant, path in paths.items():
        root, endpoint = path[0], path[-1]
        branch = next(
            (
                node
                for node in path[1:-1]
                if len(children[node]) >= 2 and len(endpoints[node]) < 0.8 * len(endpoints[root])
            ),
            None,
        )
        result[variant] = list(dict.fromkeys([root, *([branch] if branch else []), endpoint]))
    return result


def candidate_points(geometry: BaseGeometry) -> list[tuple[Point, float]]:
    components = sorted(polygons(geometry), key=lambda shape: (-shape.area, shape.bounds))
    if not components:
        return []
    # Also give large continuous areas local anchors for panning at closer scales.
    main = components[0]
    west, south, east, north = main.bounds
    xs, ys = (west, (west + east) / 2, east), (south, (south + north) / 2, north)
    shapes: list[BaseGeometry] = list(components[:COMPONENT_LIMIT])
    if max(east - west, north - south) > 1 / 64:
        for x in range(2):
            for y in range(2):
                section = main.intersection(geos.box(xs[x], ys[y], xs[x + 1], ys[y + 1]))
                pieces = polygons(section)
                if pieces:
                    shapes.append(max(pieces, key=lambda shape: shape.area))

    result: list[tuple[Point, float]] = []
    boundary = geometry.boundary
    for shape in shapes:
        circle = geos.maximum_inscribed_circle(shape)
        x, y = circle.coords[0]
        # Validate the serialized coordinate, so rounding cannot put it at an edge.
        lng = round(x * 360 - 180, 7)
        lat = round(math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y)))), 7)
        point = Point(
            (lng + 180) / 360,
            (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2,
        )
        radius = round(boundary.distance(point), 10)
        if radius <= 0 or not geometry.contains(point):
            continue
        if all(point.distance(prior) > min(clearance, radius) / 2 for prior, clearance in result):
            result.append((point, radius))
    return result


def minimum_zoom(name: str, radius: float, overview: bool) -> float:
    """Nominal fit at 13px in a world 512px wide at zoom zero."""
    width = 13 * sum(
        1 if unicodedata.east_asian_width(char) in {"F", "W"} else 0.58
        for char in name
        if not unicodedata.combining(char)
    )
    # Overview text can span several nearby areas. Keep its center well inside a member.
    required = max(6, width / 6) if overview else math.hypot(width / 2 + 4, 10)
    return max(0, math.ceil(2 * math.log2(required / (512 * radius))) / 2)


def label_table(store: ProfileCache, max_zoom: int, catalog: Catalog) -> dict[str, Any]:
    detailed, _ = store.get_or_build_lod(max_zoom)
    geometries = language_geometries(detailed)
    paths = label_paths(
        catalog,
        {variant: detailed.properties[variant]["language_id"] for variant in geometries},
    )
    candidates = []
    for variant, geometry in sorted(geometries.items()):
        path = paths[variant]
        for point, radius in candidate_points(geometry):
            zooms = [
                minimum_zoom(
                    catalog[node]["name"], radius, catalog[node]["level"] in {"family", "group"}
                )
                for node in path
            ]
            if min(zooms) <= MAX_LABEL_ZOOM:
                candidates.append((variant, point, radius, zooms))

    # A continuous camera zoom and the underlying integer geometry LOD can differ.
    # Record every LOD that supports each anchor, including rare disappear/reappear cases.
    tree = geos.STRtree([point for _, point, _, _ in candidates])
    masks = [0] * len(candidates)
    for zoom in range(max_zoom, -1, -1):
        partition: Partition = detailed if zoom == max_zoom else store.get_or_build_lod(zoom)[0]
        faces, points = tree.query(partition.faces, predicate="covers")
        for face, point in zip(faces, points, strict=True):
            if candidates[point][0] in partition.memberships[face]:
                masks[point] |= 1 << zoom

    anchors: dict[str, list[Anchor]] = defaultdict(list)
    child_zooms: dict[str, dict[str, float]] = defaultdict(dict)
    roots: set[str] = set()
    for (variant, point, radius, zooms), mask in zip(candidates, masks, strict=True):
        if not mask:
            continue
        first_lod = (mask & -mask).bit_length() - 1
        zooms = [max(zoom, first_lod) for zoom in zooms]
        lng = round(point.x * 360 - 180, 7)
        lat = round(math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * point.y)))), 7)
        anchors[variant].append((lng, lat, radius, mask, zooms))
        path = paths[variant]
        roots.add(path[0])
        for i, (parent, child) in enumerate(zip(path, path[1:]), start=1):
            by_child = child_zooms[parent]
            by_child[child] = min(by_child.get(child, math.inf), zooms[i])

    # The lower quartile gives early readable children a chance while a dense branch
    # keeps its overview longer. The viewport can retain a parent with no usable child.
    handoffs = {}
    for parent, children in sorted(child_zooms.items()):
        zooms = sorted(children.values())
        handoffs[parent] = min(9, max(2.5 if parent in roots else 4, zooms[len(zooms) // 4]))
    return {
        "variants": {
            variant: {"path": paths[variant], "anchors": rows} for variant, rows in anchors.items()
        },
        "handoffZooms": handoffs,
    }


def publish_labels(
    sources: list[ProfileSource],
    profiles: list[dict[str, Any]],
    output: Path,
    cache: Path,
    settings: GeometrySettings,
    max_zoom: int,
    catalog_path: Path,
) -> list[dict[str, Any]]:
    catalog = {
        row["id"]: {
            field: row.get(field)
            for field in ("id", "name", "level", "parentId", "parentLanguageId")
        }
        for row in json.loads(catalog_path.read_text())
    }
    stamp = fingerprint(catalog)
    by_profile = {(source.dataset, source.period): source for source in sources}
    result = []
    for profile in profiles:
        source = by_profile.get((profile["datasetId"], profile["viewId"]))
        if source is None:
            raise ValueError("Source profile changed; rebuild the atlas first")
        store = ProfileCache(cache, source, settings)
        archive = f"geometry/{store.archive_key(max_zoom)}/{source.label}.pmtiles"
        if profile["archive"] != archive or not (output / archive).is_file():
            raise ValueError(f"{source.label}: geometry changed; rebuild the atlas first")
        key = fingerprint([SCHEMA_VERSION, archive, stamp])
        name = f"language-labels/v{SCHEMA_VERSION}-{key}/{source.label}.json"
        if not (output / name).is_file():
            table = label_table(store, max_zoom, catalog)
            atomic_json(
                output / name, {"schemaVersion": SCHEMA_VERSION, "archive": archive, **table}
            )
            print(f"{source.label}: labels for {len(table['variants'])} variants", flush=True)
        result.append({**profile, "labels": name})
    return result
