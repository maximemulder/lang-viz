"""Prepare a small, versioned label table from each profile's display geometry."""

from __future__ import annotations

import json
import math
import unicodedata
from collections import defaultdict
from itertools import pairwise
from pathlib import Path
from typing import Any

import numpy as np
import shapely as geos
from shapely.geometry import Point, Polygon
from shapely.geometry.base import BaseGeometry
from shapely.ops import nearest_points

from pipeline.atlas.topology import Partition, language_geometries, polygons
from pipeline.atlas.topology_cache import (
    GeometrySettings,
    ProfileCache,
    ProfileSource,
    atomic_json,
    fingerprint,
)

SCHEMA_VERSION = 3
PLACEMENT_VERSION = 5
MAX_LABEL_ZOOM = 12
WORLD_DETAIL_ZOOM = 2.0
COMPONENT_LIMIT = 12
OVERVIEW_LIMIT = 16

type Catalog = dict[str, dict[str, Any]]
type Anchor = tuple[float, float, float, int, list[float]]
type Candidate = tuple[Point, float]


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

    endpoints: dict[str, set[str]] = defaultdict(set)
    for path in paths.values():
        for parent in path[:-1]:
            endpoints[parent].add(path[-1])

    result = {}
    for variant, path in paths.items():
        root, endpoint = path[0], path[-1]
        branch = next(
            (node for node in path[1:-1] if 3 <= len(endpoints[node]) < 0.8 * len(endpoints[root])),
            None,
        )
        result[variant] = list(dict.fromkeys([root, *([branch] if branch else []), endpoint]))
    return result


def label_components(geometry: BaseGeometry) -> list[Polygon]:
    components = sorted(polygons(geometry), key=lambda shape: (-shape.area, shape.bounds))
    if len(components) <= COMPONENT_LIMIT:
        return components

    # Reserve some slots for distant components, such as Great Britain in the
    # contemporary English footprint, even among many larger pieces elsewhere.
    def location(shape: Polygon) -> tuple[float, float]:
        west, south, east, north = shape.bounds
        return (west + east) / 2, (south + north) / 2

    def distance(a: tuple[float, float], b: tuple[float, float]) -> float:
        dx = a[0] - b[0]
        return math.hypot(dx - round(dx), a[1] - b[1])

    chosen = components[:5]
    centers = [location(shape) for shape in chosen]
    remaining = [(shape, location(shape), math.sqrt(shape.area)) for shape in components[5:]]
    for _ in range(COMPONENT_LIMIT - len(chosen)):
        index = max(
            range(len(remaining)),
            key=lambda i: remaining[i][2] * min(distance(remaining[i][1], c) for c in centers),
        )
        shape, center, _ = remaining.pop(index)
        chosen.append(shape)
        centers.append(center)
    return chosen


def longitude_latitude(point: Point) -> tuple[float, float]:
    return (
        round(point.x * 360 - 180, 7),
        round(math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * point.y)))), 7),
    )


def interior_candidate(
    geometry: BaseGeometry, boundary: BaseGeometry, point: Point
) -> Candidate | None:
    # Validate the serialized coordinate, so rounding cannot put it at an edge.
    lng, lat = longitude_latitude(point)
    point = Point(
        (lng + 180) / 360,
        (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2,
    )
    if not geometry.contains(point):
        return None
    radius = round(boundary.distance(point), 10)
    return (point, radius) if radius > 0 else None


def candidate_points(geometry: BaseGeometry) -> list[Candidate]:
    shapes = label_components(geometry)
    if not shapes:
        return []

    result: list[Candidate] = []
    boundary = geometry.boundary

    def append(point: Point, spacing: float) -> None:
        candidate = interior_candidate(geometry, boundary, point)
        if candidate is None:
            return
        point, radius = candidate
        if all(
            point.distance(prior) > max(1e-8, min(clearance, radius) * spacing)
            for prior, clearance in result
        ):
            result.append((point, radius))

    for shape in shapes:
        circle = geos.maximum_inscribed_circle(shape)
        widest = Point(circle.coords[0])
        centroid = shape.centroid
        # Find the nearest point to the centroid with useful clearance, including
        # when the centroid falls in a hole or outside a concave footprint.
        inset = circle.length * 0.6
        if not shape.contains(centroid) or shape.boundary.distance(centroid) < inset:
            interior = shape.buffer(-inset)
            centroid = widest if interior.is_empty else nearest_points(centroid, interior)[1]
        append(centroid, 0)
        append(widest, 0.2)

    # Also give large continuous areas local anchors for panning at closer scales.
    main = shapes[0]
    west, south, east, north = main.bounds
    xs, ys = (west, (west + east) / 2, east), (south, (south + north) / 2, north)
    if max(east - west, north - south) > 1 / 64:
        for x in range(2):
            for y in range(2):
                section = main.intersection(geos.box(xs[x], ys[y], xs[x + 1], ys[y + 1]))
                pieces = polygons(section)
                if pieces:
                    circle = geos.maximum_inscribed_circle(max(pieces, key=lambda shape: shape.area))
                    append(Point(circle.coords[0]), 0.5)
    return result


def regional_overviews(geometry: BaseGeometry, members: list[tuple[Point, str]]) -> list[Point]:
    """Find distinct regions with both mapped area and a concentration of members."""
    coords = np.array([(point.x, point.y) for point, _ in members])
    if len(coords) < 2:
        return []
    # Score on a sphere so a neighborhood works near the poles and the date line.
    lng = coords[:, 0] * (2 * np.pi) - np.pi
    lat = np.arctan(np.sinh(np.pi * (1 - 2 * coords[:, 1])))
    directions = np.column_stack((np.cos(lat) * np.cos(lng), np.cos(lat) * np.sin(lng), np.sin(lat)))
    nearby = np.maximum(0, 1 - (2 - 2 * (directions @ directions.T)) / 0.25**2) ** 2
    by_branch: dict[str, list[int]] = defaultdict(list)
    for i, (_, branch) in enumerate(members):
        by_branch[branch].append(i)
    # Each additional language in a nearby branch contributes less than the first.
    density = np.zeros(len(members))
    for indices in by_branch.values():
        density += np.log1p(nearby[:, indices].sum(axis=1))
    regions = []
    centers = []
    for i in np.argsort(-density, kind="stable"):
        if any(nearby[i, j] > 0.25 for j in centers):
            continue
        centers.append(i)
        x, y = coords[i]
        half_width = min(0.10, (1 / 24) / math.cos(lat[i]))
        region = geometry.intersection(
            geos.box(x - half_width, y - half_width, x + half_width, y + half_width)
        )
        parts = polygons(region)
        if parts:
            main = max(parts, key=lambda shape: shape.area)
            ground_area = main.area * math.cos(lat[i]) ** 2
            score = density[i] * ground_area**0.25
            center = region.centroid
            if not geometry.contains(center):
                center = main.centroid
            if not geometry.contains(center):
                center = Point(geos.maximum_inscribed_circle(main).coords[0])
            regions.append((score, center))
        if len(centers) == 8:
            break
    return [point for _, point in sorted(regions, key=lambda region: -region[0])]


def overview_points(
    geometry: BaseGeometry, members: list[tuple[Point, str]], name: str
) -> list[Candidate]:
    components = label_components(geometry)
    if not components:
        return []
    main = components[0]
    boundary = geometry.boundary
    points = []
    if main.area >= geometry.area * (2 / 3):
        center = geometry.centroid
        points.append(center)
        # Offer near-center positions for broader text before moving to a
        # different part of the polygon. Clip the search to the central region.
        current = interior_candidate(geometry, boundary, center)
        if geometry.area >= 1e-4:
            for zoom in (3, 1.5, 1, 0):
                radius = 1.06 * nominal_clearance(name, True) / (512 * 2**zoom)
                if current and current[1] >= radius:
                    continue
                reach = 4 * radius
                x, y = center.x, center.y
                local = geometry.intersection(geos.box(x - reach, y - reach, x + reach, y + reach))
                interior = local.buffer(-radius)
                if not interior.is_empty:
                    points.append(nearest_points(center, interior)[1])
    else:
        points.extend(regional_overviews(geometry, members))
    points.extend(point for point, _ in candidate_points(geometry))
    result: list[Candidate] = []
    for point in points:
        candidate = interior_candidate(geometry, boundary, point)
        if candidate and all(
            candidate[0].distance(prior) > min(clearance, candidate[1]) / 3
            for prior, clearance in result
        ):
            result.append(candidate)
        if len(result) == OVERVIEW_LIMIT:
            break
    return result


def nominal_clearance(name: str, overview: bool) -> float:
    width = 13 * sum(
        1 if unicodedata.east_asian_width(char) in {"F", "W"} else 0.58
        for char in name
        if not unicodedata.combining(char)
    )
    # Overview text can span several nearby areas. Keep its center well inside a member.
    return max(4, width / 10) if overview else math.hypot(width / 2 + 4, 10)


def minimum_zoom(name: str, radius: float, overview: bool) -> float:
    """Nominal fit at 13px in a world 512px wide at zoom zero."""
    required = nominal_clearance(name, overview)
    return max(0, math.ceil(2 * math.log2(required / (512 * radius))) / 2)


def hierarchy_zooms(
    paths: list[list[str]], child_zooms: dict[str, dict[str, float]]
) -> tuple[dict[str, float], dict[str, float]]:
    roots = {path[0] for path in paths}
    reveal_zooms = {root: 0.0 for root in sorted(roots)}
    children_reveal_zooms: dict[str, float] = {}
    handoffs: dict[str, float] = {}
    for parent, children in sorted(child_zooms.items()):
        zooms = sorted(children.values())
        # A single large area cannot open a branch with multiple mapped children.
        early_child = min(1, len(zooms) - 1)
        children_reveal_zooms[parent] = min(9, max(WORLD_DETAIL_ZOOM, zooms[early_child]))
        handoffs[parent] = min(
            9, max(2.5 if parent in roots else 4, zooms[max(early_child, len(zooms) // 4)])
        )

    # Keep each intermediate level eligible for at least half a zoom step.
    for path in sorted(paths, key=len):
        for parent, child in pairwise(path):
            reveal = max(children_reveal_zooms[parent], reveal_zooms[parent] + 0.5)
            reveal_zooms[child] = max(reveal_zooms.get(child, 0), reveal)
    return reveal_zooms, handoffs


def label_table(store: ProfileCache, max_zoom: int, catalog: Catalog) -> dict[str, Any]:
    detailed, _ = store.get_or_build_lod(max_zoom)
    geometries = language_geometries(detailed)
    paths = label_paths(
        catalog,
        {variant: detailed.properties[variant]["language_id"] for variant in geometries},
    )
    parents = {group for path in paths.values() for group in path[:-1]}
    representatives: dict[str, dict[str, tuple[Point, float, str]]] = defaultdict(dict)
    candidates: list[tuple[str, Point, float, list[float]]] = []
    for variant, geometry in sorted(geometries.items()):
        path = paths[variant]
        points = candidate_points(geometry)
        if points:
            for depth, group in enumerate(path[:-1]):
                previous = representatives[group].get(path[-1])
                if previous is None or previous[1] < points[0][1]:
                    representatives[group][path[-1]] = (*points[0], path[depth + 1])
        for point, radius in points:
            zooms = [
                minimum_zoom(
                    catalog[node]["name"], radius, catalog[node]["level"] in {"family", "group"}
                )
                for node in path
            ]
            if min(zooms) <= MAX_LABEL_ZOOM:
                candidates.append((variant, point, radius, zooms))

    faces_by_group: dict[str, list[BaseGeometry]] = defaultdict(list)
    for face, memberships in zip(detailed.faces, detailed.memberships, strict=True):
        groups = {group for variant in memberships for group in paths[variant] if group in parents}
        for group in groups:
            faces_by_group[group].append(face)

    overview_start = len(candidates)
    for group, faces in sorted(faces_by_group.items()):
        if len(representatives[group]) < 2:
            continue
        footprint = geos.coverage_union_all(faces)
        members = [(point, branch) for point, _, branch in representatives[group].values()]
        name = catalog[group]["name"]
        for point, radius in overview_points(footprint, members, name):
            zoom = minimum_zoom(name, radius, overview=True)
            if zoom <= MAX_LABEL_ZOOM:
                candidates.append((group, point, radius, [zoom]))

    # A continuous camera zoom and the underlying integer geometry LOD can differ.
    # Record every LOD that supports each anchor, including rare disappear/reappear cases.
    tree = geos.STRtree([point for _, point, _, _ in candidates])
    masks = [0] * len(candidates)
    owners: dict[int, set[str]] = defaultdict(set)
    for zoom in range(max_zoom, -1, -1):
        partition: Partition = detailed if zoom == max_zoom else store.get_or_build_lod(zoom)[0]
        faces, points = tree.query(partition.faces, predicate="covers")
        for face, point in zip(faces, points, strict=True):
            id = candidates[point][0]
            memberships = partition.memberships[face]
            if point >= overview_start:
                matching = [variant for variant in memberships if id in paths.get(variant, ())]
                if matching:
                    masks[point] |= 1 << zoom
                    owners[point].update(matching)
            elif id in memberships:
                masks[point] |= 1 << zoom

    anchors: dict[str, list[Anchor]] = defaultdict(list)
    overviews: dict[str, list[tuple[Anchor, list[str]]]] = defaultdict(list)
    child_zooms: dict[str, dict[str, float]] = defaultdict(dict)
    for index, ((variant, point, radius, zooms), mask) in enumerate(
        zip(candidates, masks, strict=True)
    ):
        if not mask:
            continue
        first_lod = (mask & -mask).bit_length() - 1
        zooms = [max(zoom, first_lod) for zoom in zooms]
        anchor = (*longitude_latitude(point), radius, mask, zooms)
        if index >= overview_start:
            overviews[variant].append((anchor, sorted(owners[index])))
            continue
        anchors[variant].append(anchor)
        path = paths[variant]
        for i, (parent, child) in enumerate(pairwise(path), start=1):
            by_child = child_zooms[parent]
            by_child[child] = min(by_child.get(child, math.inf), zooms[i])

    reveals, handoffs = hierarchy_zooms([paths[variant] for variant in anchors], child_zooms)
    return {
        "variants": {
            variant: {"path": paths[variant], "anchors": rows} for variant, rows in anchors.items()
        },
        "revealZooms": reveals,
        "handoffZooms": handoffs,
        "overviews": {group: rows for group, rows in overviews.items() if group in handoffs},
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
        key = fingerprint([SCHEMA_VERSION, PLACEMENT_VERSION, archive, stamp])
        name = f"language-labels/v{SCHEMA_VERSION}-{key}/{source.label}.json"
        if not (output / name).is_file():
            table = label_table(store, max_zoom, catalog)
            atomic_json(
                output / name, {"schemaVersion": SCHEMA_VERSION, "archive": archive, **table}
            )
            print(f"{source.label}: labels for {len(table['variants'])} variants", flush=True)
        result.append({**profile, "labels": name})
    return result
