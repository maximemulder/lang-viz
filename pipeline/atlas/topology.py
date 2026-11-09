#!/usr/bin/env python3
"""Build selection-independent coverage before simplifying any display geometry.

GEOS owns the shared boundary network through its polygonal coverage operations.
The persistent intermediate is a labelled, edge-matched partition, not display
tiles. Language polygons and prepared parts are materializations of the same LOD.
"""

from __future__ import annotations

import json
import math
from collections import defaultdict
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import shapely as geos
from shapely import Geometry
from shapely.errors import GEOSException

# About four centimetres at the equator. This is GEOS's numerical precision,
# independent of zoom; it is not the previous 512-unit display grid.
SOURCE_GRID = 2**-30
EXTENT = 8192
MAX_ZOOM = 8
ALGORITHM_VERSION = 5
LOD_VERSION = 4
PARTITION_VERSION = 1
AREA_INDEX_ZOOM = 5


@dataclass
class Partition:
    faces: np.ndarray
    memberships: list[tuple[str, ...]]
    properties: dict[str, dict[str, Any]]
    repairs: list[dict[str, Any]]
    stats: dict[str, Any] = field(default_factory=dict)


def project(coordinates: np.ndarray) -> np.ndarray:
    result = coordinates.copy()
    result[:, 0] = (result[:, 0] + 180) / 360
    latitudes = np.clip(result[:, 1], -85.0511287798066, 85.0511287798066)
    result[:, 1] = (1 - np.arcsinh(np.tan(latitudes * np.pi / 180)) / np.pi) / 2
    return result


def polygons(geometry: Geometry) -> list[Geometry]:
    if geometry.is_empty:
        return []
    if geometry.geom_type == "Polygon":
        return [geometry]
    if geometry.geom_type in ("MultiPolygon", "GeometryCollection"):
        return [p for child in geometry.geoms for p in polygons(child)]
    return []


def wrap_world(geometry: Geometry) -> list[Geometry]:
    """Normalize source longitudes that extend slightly past the antimeridian."""
    minx, _, maxx, _ = geometry.bounds
    if minx >= 0 and maxx <= 1:
        return polygons(geometry)
    result = []
    for offset in range(math.floor(minx), math.floor(maxx) + 1):
        clipped = geos.intersection(
            geometry, geos.box(offset, 0, offset + 1, 1), grid_size=SOURCE_GRID
        )
        shifted = geos.transform(
            clipped, lambda coordinates, offset=offset: coordinates - [offset, 0]
        )
        result.extend(polygons(shifted))
    return result


def validate_coverage(faces: np.ndarray, stage: str) -> None:
    if not np.all(geos.is_valid(faces)) or not geos.coverage_is_valid(faces):
        invalid = geos.coverage_invalid_edges(faces)
        count = int(np.count_nonzero(~geos.is_empty(invalid)))
        raise ValueError(f"{stage}: invalid coverage ({count} mismatched boundaries)")


def merge_memberships(
    faces: np.ndarray, memberships: list[tuple[str, ...]], cells: np.ndarray | None = None
) -> tuple[np.ndarray, list[tuple[str, ...]]]:
    """Remove source-component edges that carry no membership distinction."""
    groups = defaultdict(list)
    for index, (face, members) in enumerate(zip(faces, memberships, strict=True)):
        cell = tuple(cells[index]) if cells is not None else ()
        groups[(cell, members)].append(face)
    result: list[Geometry] = []
    labels: list[tuple[str, ...]] = []
    for (_, members), pieces in sorted(groups.items()):
        joined = geos.disjoint_subset_union_all(pieces) if len(pieces) > 1 else pieces[0]
        for polygon in polygons(joined):
            result.append(polygon)
            labels.append(members)
    array = np.array(result, dtype=object)
    return array, labels


def split_point_contacts(
    faces: np.ndarray, memberships: list[tuple[str, ...]]
) -> tuple[np.ndarray, list[tuple[str, ...]], int]:
    """Decompose complex point contacts without moving or deleting any area.

    A shell and hole may touch at one point in a valid Polygon. When another
    coverage face also meets that point, GEOS coverage validation/simplification
    can reject it. Constrained triangulation of the affected neighborhood gives
    it ordinary shared edges, using only existing boundary vertices. Actual
    overlaps or unmatched boundaries still fail final validation.
    """
    if not np.all(geos.is_valid(faces)):
        raise ValueError("Coverage contains invalid polygon rings")
    if geos.coverage_is_valid(faces):
        return faces, memberships, 0
    invalid = geos.coverage_invalid_edges(faces)
    affected = np.flatnonzero(~geos.is_empty(invalid))
    neighbors = set(geos.STRtree(faces).query(faces[affected], predicate="intersects")[1])
    result: list[Geometry] = []
    labels: list[tuple[str, ...]] = []
    split_count = 0
    for i, (face, members) in enumerate(zip(faces, memberships, strict=True)):
        if i in neighbors:
            pieces = geos.get_parts(geos.constrained_delaunay_triangles(face))
            if not geos.union_all(pieces).equals(face):
                raise ValueError("Point-contact decomposition changed coverage")
            result.extend(pieces)
            labels.extend([members] * len(pieces))
            split_count += 1
        else:
            result.append(face)
            labels.append(members)
    array = np.array(result, dtype=object)
    validate_coverage(array, "Point-contact decomposition")
    return array, labels, split_count


def partition_sources(
    features: Iterable[dict[str, Any]],
    *,
    repair_invalid: bool = True,
    log: Callable[[str], None] = lambda _: None,
) -> Partition:
    """Node original boundaries once, polygonize, and label every atomic face.

    Bounded empty faces are retained as constraints: genuine holes must not be
    filled merely because no language contributes to them. No hierarchy policy
    is applied here, so removing a child can still expose its ancestor.
    """
    groups: dict[str, list[Geometry]] = defaultdict(list)
    properties: dict[str, dict[str, Any]] = {}
    repairs: list[dict[str, Any]] = []
    for feature in features:
        props = feature["properties"]
        variant = props["variant_id"]
        properties.setdefault(variant, {**props, "_feature_id": feature.get("id", 0)})
        geometry = geos.transform(geos.from_geojson(json.dumps(feature["geometry"])), project)
        if not geometry.is_valid:
            reason = geos.is_valid_reason(geometry)
            if not repair_invalid:
                raise ValueError(f"Invalid source geometry {variant}: {reason}")
            repaired = geos.make_valid(geometry, method="linework")
            repairs.append({"variantId": variant, "featureId": feature.get("id"), "reason": reason})
            geometry = repaired
        pieces = wrap_world(geometry)
        if pieces:
            groups[variant].extend(
                polygons(geos.set_precision(geos.union_all(pieces), SOURCE_GRID))
            )

    variants = sorted(groups)
    sources = np.array([geos.union_all(groups[v], grid_size=SOURCE_GRID) for v in variants])
    log(f"{len(sources)} source variants, {len(repairs)} recorded repairs")
    network = geos.union_all(geos.boundary(sources), grid_size=SOURCE_GRID)
    faces = geos.set_precision(geos.get_parts(geos.polygonize(geos.get_parts(network))), 0)
    log(f"{len(faces)} atomic faces")
    if not np.all(geos.is_valid(faces)):
        raise ValueError("Original partition contains invalid polygon rings")

    # Query prepared source polygons against a point index. The reverse query
    # (testing every point within unprepared source polygons) is much slower.
    points = geos.point_on_surface(faces)
    source_indices, face_indices = geos.STRtree(points).query(sources, predicate="contains")
    labels: list[list[str]] = [[] for _ in faces]
    for source, face in zip(source_indices, face_indices, strict=True):
        labels[face].append(variants[source])
    memberships = [tuple(sorted(members)) for members in labels]
    log(f"{len(set(memberships))} distinct membership sets")
    # Do not dissolve the high-precision micro-components here. Polygonization
    # already establishes a planar mesh; coordinate collapse and redundant-edge
    # removal belong to each display LOD, where those components are representable.
    return Partition(faces, memberships, properties, repairs)


def simplify_partition(
    partition: Partition,
    zoom: int,
    tolerance_pixels: float = 1,
    boundary_tolerance_pixels: float = 0.05,
) -> Partition:
    if not 0 <= zoom <= MAX_ZOOM or any(
        not math.isfinite(t) or t < 0 for t in [tolerance_pixels, boundary_tolerance_pixels]
    ):
        raise ValueError("Invalid LOD settings")
    active = [i for i, m in enumerate(partition.memberships) if m]
    faces, memberships, splits = split_point_contacts(
        partition.faces[active], [partition.memberships[i] for i in active]
    )
    # Coastlines and genuine uncovered regions need a much smaller error than
    # interior language borders. Simplify them gently, then simplify shared
    # internal edges while preserving that coverage boundary.
    faces = geos.coverage_simplify(faces, boundary_tolerance_pixels / (512 * 2**zoom))
    faces = geos.coverage_simplify(
        faces, tolerance_pixels / (512 * 2**zoom), simplify_boundary=False
    )
    validate_coverage(faces, f"LOD {zoom}")
    return Partition(
        faces,
        memberships,
        partition.properties,
        partition.repairs,
        {**partition.stats, "simplificationPointContactSplits": splits},
    )


def language_geometries(partition: Partition) -> dict[str, Geometry]:
    """Reconstruct variants without another language-to-language overlay."""
    groups: dict[str, list[Geometry]] = defaultdict(list)
    for face, members in zip(partition.faces, partition.memberships, strict=True):
        if not face.is_empty:
            for member in members:
                groups[member].append(face)
    return {member: geos.disjoint_subset_union_all(faces) for member, faces in groups.items()}


class SourceAreaIndex:
    """Exact area transfer with cached regional subdivisions of canonical faces.

    Repeatedly intersecting a tiny face with an entire continental coastline is
    expensive. Subdivide both operands into the same processing regions first.
    These are exact geometric clips, independent of display precision or LOD.
    """

    def __init__(self, partition: Partition):
        active = [i for i, members in enumerate(partition.memberships) if members]
        self.faces = partition.faces[active]
        self.memberships = [partition.memberships[i] for i in active]
        self.areas = geos.area(self.faces)
        self.index = geos.STRtree(self.faces)
        self.count = 2**AREA_INDEX_ZOOM
        self.regions: dict[tuple[int, int], tuple[np.ndarray, list[tuple[str, ...]], Any]] = {}

    def region(self, x: int, y: int):
        key = (x, y)
        if key not in self.regions:
            bounds = geos.box(
                x / self.count, y / self.count, (x + 1) / self.count, (y + 1) / self.count
            )
            candidates = self.index.query(bounds)
            pieces = self.faces[candidates].copy()
            inside = geos.covers(bounds, pieces)
            pieces[~inside] = geos.intersection(pieces[~inside], bounds, grid_size=SOURCE_GRID)
            for i in np.flatnonzero(
                geos.get_type_id(pieces) == geos.GeometryType.GEOMETRYCOLLECTION
            ):
                pieces[i] = geos.MultiPolygon(polygons(pieces[i]))
            visible = np.flatnonzero(geos.area(pieces) > 0)
            pieces = pieces[visible]
            members = [self.memberships[candidates[i]] for i in visible]
            self.regions[key] = pieces, members, geos.STRtree(pieces)
        return self.regions[key]

    def majority(self, face: Geometry) -> tuple[str, ...]:
        candidates = self.index.query(face)
        if sum(self.areas[candidates]) * 2 < face.area:
            return ()
        areas: dict[tuple[str, ...], float] = defaultdict(float)
        minx, miny, maxx, maxy = face.bounds
        for x in range(
            max(0, math.floor(minx * self.count)),
            min(self.count - 1, math.floor(maxx * self.count)) + 1,
        ):
            for y in range(
                max(0, math.floor(miny * self.count)),
                min(self.count - 1, math.floor(maxy * self.count)) + 1,
            ):
                bounds = geos.box(
                    x / self.count, y / self.count, (x + 1) / self.count, (y + 1) / self.count
                )
                chunk = (
                    face
                    if bounds.covers(face)
                    else geos.intersection(face, bounds, grid_size=SOURCE_GRID)
                )
                if chunk.area == 0:
                    continue
                if chunk.geom_type == "GeometryCollection":
                    chunk = geos.MultiPolygon(polygons(chunk))
                pieces, members, index = self.region(x, y)
                local = index.query(chunk)
                values = geos.area(geos.intersection(chunk, pieces[local], grid_size=SOURCE_GRID))
                for source, area in zip(local, values, strict=True):
                    areas[members[source]] += area
        areas[()] += max(0, face.area - sum(areas.values()))
        return max(sorted(areas), key=areas.get)


def precision_candidates(
    partition: Partition, grid: float
) -> tuple[np.ndarray, list[dict[str, Any]]]:
    """Rounding aids label transfer; it never owns the authoritative geometry.

    GEOS precision reduction can fail on valid complex shell/hole contacts. Keep
    the original face in the area index and omit only its rounded label candidate.
    The shared network is built independently from all original boundaries.
    """
    rounded = np.empty_like(partition.faces)
    failures = []
    for start in range(0, len(rounded), 4096):
        stop = min(start + 4096, len(rounded))
        try:
            rounded[start:stop] = geos.set_precision(partition.faces[start:stop], grid)
        except GEOSException:
            for index in range(start, stop):
                try:
                    rounded[index] = geos.set_precision(partition.faces[index], grid)
                except GEOSException as error:
                    rounded[index] = geos.Polygon()
                    failures.append(
                        {
                            "face": index,
                            "members": partition.memberships[index],
                            "reason": str(error),
                        }
                    )
    return rounded, failures


def quantize_partition(
    partition: Partition,
    zoom: int,
    log: Callable[[str], None] = lambda _: None,
    area_index: SourceAreaIndex | None = None,
) -> Partition:
    """Resolve coordinate collapse in one shared network, before simplification.

    Independent polygon precision reduction can create overlaps and small gaps,
    even when the original coverage is valid. Re-node the rounded network and
    label its disjoint faces. Ambiguous rounded overlaps conservatively retain
    all surviving memberships. Unassigned faces use the original majority area,
    including uncovered area, so a collapsed island cannot label an entire hole.
    """
    grid = 1 / (EXTENT * 2**zoom)
    rounded, precision_failures = precision_candidates(partition, grid)
    active = np.flatnonzero(~geos.is_empty(rounded))
    # Tile cuts are part of the shared network. Their intersections become
    # topology nodes, so simplification cannot remove the rounded seam points.
    cuts = np.arange(2**zoom + 1) / 2**zoom
    lines = [[[x, 0], [x, 1]] for x in cuts] + [[[0, y], [1, y]] for y in cuts]
    network = geos.union_all(
        np.concatenate([geos.boundary(partition.faces), geos.linestrings(lines)]), grid_size=grid
    )
    # Keep integer lattice coordinates, but clear GEOS's persistent precision
    # model. Later unions must not snap already-simplified edges a second time.
    faces = geos.set_precision(geos.get_parts(geos.polygonize(geos.get_parts(network))), 0)
    log(f"zoom {zoom}: {len(faces)} faces at encoding precision")
    points = geos.point_on_surface(faces)
    source_indices, face_indices = geos.STRtree(points).query(rounded[active], predicate="contains")
    # A representative point alone could let a collapsed island label a large
    # surrounding face. Accept a rounded label only if it covers the whole face.
    geos.prepare(rounded[active])
    covered = geos.covers(rounded[active[source_indices]], faces[face_indices])
    source_indices, face_indices = source_indices[covered], face_indices[covered]
    labels: list[set[str]] = [set() for _ in faces]
    assigned = np.zeros(len(faces), dtype=bool)
    for source, face in zip(source_indices, face_indices, strict=True):
        assigned[face] = True
        labels[face].update(partition.memberships[active[source]])
    if precision_failures:
        failed = partition.faces[[failure["face"] for failure in precision_failures]]
        affected = np.unique(geos.STRtree(faces).query(failed, predicate="intersects")[1])
        # A neighbor's rounded polygon may cover the failed face's region.
        # Reclassify every affected region from original areas, even if that
        # neighbor supplied a provisional label, so no contributor is masked.
        assigned[affected] = False
        for index in affected:
            labels[index].clear()
    missing = np.flatnonzero(~assigned)
    log(f"zoom {zoom}: resolving {len(missing)} collapsed-face neighborhoods")
    if len(missing):
        area_index = area_index or SourceAreaIndex(partition)
        for index in missing:
            labels[index].update(area_index.majority(faces[index]))
    cells = np.floor(geos.get_coordinates(points) * 2**zoom).astype(np.int32)
    # Empty regions constrain the shared network and label transfer, but do not
    # enter the display coverage. In particular, validating a single world-size
    # ocean polygon against every island makes GEOS's validator quadratic.
    visible = np.array([i for i, members in enumerate(labels) if members], dtype=int)
    faces, memberships = merge_memberships(
        faces[visible], [tuple(sorted(labels[i])) for i in visible], cells[visible]
    )
    faces, memberships, splits = split_point_contacts(faces, memberships)
    log(f"zoom {zoom}: {len(faces)} valid display faces")
    return Partition(
        faces,
        memberships,
        partition.properties,
        partition.repairs,
        {
            "collapsedFaces": len(rounded) - len(active),
            "relabelledFaces": len(missing),
            "pointContactSplits": splits,
            "labelPrecisionFallbacks": precision_failures,
        },
    )
