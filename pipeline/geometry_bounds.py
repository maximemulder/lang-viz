"""Compact geographic bounds for source geometry, including dateline crossings."""

from __future__ import annotations

import math
from typing import Any


def geometry_bounds(features: list[dict[str, Any]]) -> list[float]:
    """Fit actual source footprints using the shortest enclosing longitude arc."""
    longitudes: set[float] = set()
    south, north = 90.0, -90.0

    def coordinates(value: list) -> None:
        nonlocal south, north
        if value and isinstance(value[0], (int, float)):
            lon, lat = value[:2]
            if math.isfinite(lon) and math.isfinite(lat):
                longitudes.add(lon % 360)
                south, north = min(south, lat), max(north, lat)
        else:
            for child in value:
                coordinates(child)

    def geometry(value: dict) -> None:
        if value.get("type") == "GeometryCollection":
            for child in value["geometries"]:
                geometry(child)
        else:
            coordinates(value.get("coordinates", []))

    for feature in features:
        if feature.get("geometry"):
            geometry(feature["geometry"])
    if not longitudes:
        raise ValueError("Cannot locate an empty source geometry")
    ordered = sorted(longitudes)
    gaps = [
        ((ordered[(i + 1) % len(ordered)] - value) % 360, ordered[(i + 1) % len(ordered)])
        for i, value in enumerate(ordered)
    ]
    gap, start = max(gaps) if len(ordered) > 1 else (360, ordered[0])
    west = (start + 180) % 360 - 180
    return [round(v, 6) for v in (west, south, west + 360 - gap, north)]
