#!/usr/bin/env python3
"""Materialize shared-coverage LODs as ordinary MVT/PMTiles browser assets.

Run independently with --output to evaluate new geometry without publishing it
to the app. Both the offline cache and output paths are resumable build products.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
import shutil
import sqlite3
import subprocess
import time
from collections import defaultdict
from collections.abc import Iterable
from contextlib import ExitStack, closing
from pathlib import Path
from typing import Any

import mapbox_vector_tile
import numpy as np
import shapely as geos
from mapbox_vector_tile.encoder import on_invalid_geometry_raise

from pipeline.atlas.topology import (
    ALGORITHM_VERSION,
    AREA_INDEX_ZOOM,
    EXTENT,
    LOD_VERSION,
    MAX_ZOOM,
    PARTITION_VERSION,
    SOURCE_GRID,
    Partition,
    SourceAreaIndex,
    partition_sources,
    polygons,
    quantize_partition,
    simplify_partition,
    split_point_contacts,
)


def atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, separators=(",", ":")) + "\n")
    temporary.replace(path)


def save_partition(path: Path, partition: Partition) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    with gzip.open(temporary, "wt") as output:
        output.write(
            json.dumps(
                {
                    "properties": partition.properties,
                    "repairs": partition.repairs,
                    "stats": partition.stats,
                }
            )
            + "\n"
        )
        for geometry, members in zip(partition.faces, partition.memberships, strict=True):
            output.write(json.dumps([members, geometry.wkb_hex], separators=(",", ":")) + "\n")
    temporary.replace(path)


def load_partition(path: Path) -> Partition:
    with gzip.open(path, "rt") as source:
        metadata = json.loads(next(source))
        rows = [json.loads(line) for line in source]
    return Partition(
        geos.from_wkb([bytes.fromhex(row[1]) for row in rows]),
        [tuple(row[0]) for row in rows],
        metadata["properties"],
        metadata["repairs"],
        metadata.get("stats", {}),
    )


def source_profiles(source: Path, cache: Path) -> dict[tuple[str, str], Path]:
    """Spool once; never retain every dataset's coordinates in Python objects."""
    index = cache / "profiles.json"
    if index.exists():
        return {
            (p["dataset"], p["period"]): cache / p["path"] for p in json.loads(index.read_text())
        }
    cache.mkdir(parents=True, exist_ok=True)
    profiles: dict[tuple[str, str], Path] = {}
    with ExitStack() as stack, source.open() as lines:
        handles = {}
        for line in lines:
            props = json.loads(line)["properties"]
            key = (props["dataset_id"], props["temporal_view"])
            if key not in handles:
                path = cache / f"{len(profiles)}.geojsonl"
                profiles[key] = path
                handles[key] = stack.enter_context(path.open("w"))
            handles[key].write(line)
    atomic_json(
        index, [{"dataset": d, "period": p, "path": path.name} for (d, p), path in profiles.items()]
    )
    return profiles


def read_features(path: Path) -> Iterable[dict[str, Any]]:
    with path.open() as lines:
        for line in lines:
            yield json.loads(line)


def tile_geometry(geometry: geos.Geometry, zoom: int, x: int, y: int) -> geos.Geometry:
    def transform(coordinates):
        return coordinates * (EXTENT * 2**zoom) - np.array([x, y]) * EXTENT

    return geos.set_precision(geos.transform(geometry, transform), 0)


def encode_tile(layer: str, features: list[dict[str, Any]]) -> bytes:
    if not features:
        return b""
    return mapbox_vector_tile.encode(
        {"name": layer, "features": features},
        default_options={
            "extents": EXTENT,
            "y_coord_down": True,
            "on_invalid_geometry": on_invalid_geometry_raise,
        },
    )


def clipped_features(
    geometries: np.ndarray,
    attributes: list[dict[str, Any]],
    indices: Iterable[int],
    bounds: geos.Geometry,
    zoom: int,
    x: int,
    y: int,
) -> list[dict[str, Any]]:
    features = []
    grid = 1 / (EXTENT * 2**zoom)
    for index in indices:
        geometry = geometries[index]
        clipped = (
            geometry
            if bounds.covers(geometry)
            else geos.intersection(geometry, bounds, grid_size=grid)
        )
        pieces = polygons(clipped)
        if not pieces:
            continue
        geometry = pieces[0] if len(pieces) == 1 else geos.MultiPolygon(pieces)
        props = attributes[index]
        features.append(
            {
                "geometry": tile_geometry(geometry, zoom, x, y),
                "properties": {k: v for k, v in props.items() if not k.startswith("_")},
                "id": props.get("_feature_id", 0),
            }
        )
    return features


def tile_candidates(geometries: np.ndarray, zoom: int) -> list[tuple[int, int]]:
    count = 2**zoom
    candidates: set[tuple[int, int]] = set()
    for minx, miny, maxx, maxy in geos.bounds(geometries):
        if not math.isfinite(minx):
            continue
        # Include a small source buffer so outlines do not expose clipping edges.
        padding = 64 / EXTENT / count
        for x in range(
            max(0, math.floor((minx - padding) * count)),
            min(count, math.floor((maxx + padding) * count) + 1),
        ):
            for y in range(
                max(0, math.floor((miny - padding) * count)),
                min(count, math.floor((maxy + padding) * count) + 1),
            ):
                candidates.add((x, y))
    return sorted(candidates)


def feature_members(feature: dict[str, Any]) -> tuple[str, ...]:
    props = feature["properties"]
    return (props["variantId"],) if "variantId" in props else tuple(json.loads(props["variantIds"]))


def source_features(
    parts: list[dict[str, Any]], properties: dict[str, dict[str, Any]]
) -> list[dict[str, Any]]:
    """Assemble buffered language polygons from the same clipped membership faces.

    Faces already contain native tile-cut vertices. Clipping buffered neighbors
    before assembly keeps buffer rounding outside the native tile interior.
    """
    groups: dict[str, list[geos.Geometry]] = defaultdict(list)
    for part in parts:
        for member in feature_members(part):
            groups[member].append(part["geometry"])
    return [
        {
            "geometry": geos.disjoint_subset_union_all(pieces),
            "properties": {k: v for k, v in properties[member].items() if not k.startswith("_")},
            "id": properties[member].get("_feature_id", 0),
        }
        for member, pieces in sorted(groups.items())
    ]


def valid_parts(features: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], int]:
    if not features:
        return features, 0
    faces, members, splits = split_point_contacts(
        np.array([f["geometry"] for f in features]), [feature_members(f) for f in features]
    )
    return [
        {
            "geometry": face,
            "properties": {"variantId": ids[0]}
            if len(ids) == 1
            else {"variantIds": json.dumps(ids, separators=(",", ":"))},
        }
        for face, ids in zip(faces, members, strict=True)
    ], splits


def write_level(
    partition: Partition, zoom: int, parts: Path, database: sqlite3.Connection | None
) -> dict[str, Any]:
    """Clip only after global simplification and shared coordinate quantization."""
    active = [
        i
        for i, members in enumerate(partition.memberships)
        if members and not partition.faces[i].is_empty
    ]
    faces = partition.faces[active]
    members = [partition.memberships[i] for i in active]
    part_attributes = [
        {"variantId": ids[0]}
        if len(ids) == 1
        else {"variantIds": json.dumps(ids, separators=(",", ":"))}
        for ids in members
    ]
    face_index = geos.STRtree(faces)
    names: list[str] = []
    positions = source_positions = source_tiles = total_bytes = export_splits = 0
    for x, y in tile_candidates(faces, zoom):
        count = 2**zoom
        bounds = geos.box(x / count, y / count, (x + 1) / count, (y + 1) / count)
        candidates = sorted(face_index.query(bounds, predicate="intersects"))
        features = clipped_features(faces, part_attributes, candidates, bounds, zoom, x, y)
        features, splits = valid_parts(features)
        export_splits += splits
        if features:
            data = encode_tile("overlap_coverage", features)
            target = parts / f"{zoom}-{x}-{y}.pbf"
            temporary = target.with_suffix(".tmp")
            temporary.write_bytes(data)
            temporary.replace(target)
            names.append(f"{x}-{y}")
            total_bytes += len(data)
            positions += sum(int(geos.get_num_coordinates(f["geometry"])) for f in features)

        if database is None:
            continue
        buffer = 64 / EXTENT / count
        buffered = geos.box(
            x / count - buffer,
            y / count - buffer,
            (x + 1) / count + buffer,
            (y + 1) / count + buffer,
        )
        candidates = sorted(face_index.query(buffered, predicate="intersects"))
        buffered_parts = clipped_features(faces, part_attributes, candidates, buffered, zoom, x, y)
        features = source_features(buffered_parts, partition.properties)
        if features:
            data = encode_tile("language_areas", features)
            source_tiles += 1
            source_positions += sum(int(geos.get_num_coordinates(f["geometry"])) for f in features)
            database.execute(
                "INSERT OR REPLACE INTO tiles VALUES (?, ?, ?, ?)",
                (zoom, x, count - 1 - y, gzip.compress(data, mtime=0)),
            )
    if database is not None:
        database.commit()
    return {
        "tiles": names,
        "positions": positions,
        "sourcePositions": source_positions,
        "sourceTiles": source_tiles,
        "bytes": total_bytes,
        "exportPointContactSplits": export_splits,
    }


def restore_parts(
    source: Path,
    output: Path,
    cache: Path,
    *,
    datasets: list[str] | None = None,
    periods: list[str] | None = None,
    max_zoom: int = MAX_ZOOM,
) -> None:
    """Repair missing parts from the canonical partition, never from source LODs."""
    manifest_path = output / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    descriptor = manifest.get("geometryBuild", {})
    if descriptor.get("kind") != "shared-coverage":
        raise ValueError("This manifest was not built with shared coverage")
    settings = json.loads((output / descriptor["report"]).read_text())["settings"]
    with source.open("rb") as input_file:
        source_hash = hashlib.file_digest(input_file, "sha256").hexdigest()
    if settings["version"] != ALGORITHM_VERSION or settings["source"] != source_hash:
        raise ValueError("Canonical source or algorithm changed; rebuild the atlas first")
    config = manifest["coverageParts"]
    matched = 0
    for profile in config["profiles"]:
        dataset, period = profile["datasetId"], profile["viewId"]
        if (datasets and dataset not in datasets) or (periods and period not in periods):
            continue
        matched += 1
        directory = output / config["directory"]
        parts = directory / profile["id"]
        parts.mkdir(parents=True, exist_ok=True)
        try:
            index = json.loads((directory / profile["tileIndex"]).read_text())
        except FileNotFoundError:
            index = {}
        partition = None
        for zoom in range(min(max_zoom, settings["maxZoom"]) + 1):
            if str(zoom) in index and all(
                (parts / f"{zoom}-{name}.pbf").exists() for name in index[str(zoom)]
            ):
                continue
            lod_fingerprint = hashlib.sha256(
                json.dumps({**settings, "version": LOD_VERSION}, sort_keys=True).encode()
            ).hexdigest()[:20]
            lod_file = cache / lod_fingerprint / f"{profile['id']}/lod-{zoom}.jsonl.gz"
            if lod_file.exists():
                low = load_partition(lod_file)
            else:
                if partition is None:
                    partition_file = (
                        cache
                        / f"v{PARTITION_VERSION}-{source_hash[:20]}"
                        / f"{profile['id']}.jsonl.gz"
                    )
                    if partition_file.exists():
                        partition = load_partition(partition_file)
                    else:
                        spooled = source_profiles(source, cache / f"sources-{source_hash[:20]}")
                        partition = partition_sources(read_features(spooled[(dataset, period)]))
                        save_partition(partition_file, partition)
                low = simplify_partition(
                    quantize_partition(partition, zoom),
                    zoom,
                    settings["tolerancePixels"],
                    settings["boundaryTolerancePixels"],
                )
                save_partition(lod_file, low)
            index[str(zoom)] = write_level(low, zoom, parts, None)["tiles"]
            index_hash = hashlib.sha256(
                json.dumps(index, sort_keys=True, separators=(",", ":")).encode()
            ).hexdigest()[:20]
            profile["tileIndex"] = f"{profile['id']}/index-{index_hash}.json"
            profile["maxZoom"] = max(profile.get("maxZoom", 0), zoom)
            atomic_json(directory / profile["tileIndex"], index)
            atomic_json(manifest_path, manifest)
        print(
            f"{profile['id']}: canonical parts ready through zoom {min(max_zoom, settings['maxZoom'])}",
            flush=True,
        )
    if not matched:
        raise ValueError("No matching source profiles")


def create_database(path: Path, max_zoom: int) -> sqlite3.Connection:
    connection = sqlite3.connect(path)
    connection.execute(
        "CREATE TABLE IF NOT EXISTS tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB, UNIQUE(zoom_level,tile_column,tile_row))"
    )
    connection.execute("CREATE TABLE IF NOT EXISTS metadata (name TEXT PRIMARY KEY, value TEXT)")
    for name, value in {
        "name": "language_areas",
        "format": "pbf",
        "minzoom": "0",
        "maxzoom": str(max_zoom),
        "bounds": "-180,-85.0511287798066,180,85.0511287798066",
        "json": json.dumps({"vector_layers": [{"id": "language_areas", "fields": {}}]}),
    }.items():
        connection.execute("INSERT OR REPLACE INTO metadata VALUES (?, ?)", (name, value))
    connection.commit()
    return connection


def export_catalog(source: Path, output: Path, geometry: dict[str, Any]) -> None:
    """Make a standalone, profile-filtered atlas without altering the control data."""
    manifest = json.loads((source / "manifest.json").read_text())
    profiles = {(p["datasetId"], p["viewId"]) for p in geometry["geometryProfiles"]}
    variants = [
        v
        for v in json.loads((source / "geometry-variants.json").read_text())
        if (v["datasetId"], v["temporalCoverage"]["viewId"]) in profiles
    ]
    ids = {v["id"] for v in variants}
    languages = json.loads((source / "languages.json").read_text())
    languages = [
        {**language, "geometryVariantIds": [v for v in language["geometryVariantIds"] if v in ids]}
        for language in languages
    ]
    index = json.loads(
        (source / manifest.get("geometryIndex", "geometry-variants.json")).read_text()
    )
    datasets = json.loads((source / "geography-datasets.json").read_text())
    atomic_json(output / "languages.json", languages)
    atomic_json(output / "geometry-variants.json", variants)
    atomic_json(output / "geometry-index.json", [v for v in index if v["id"] in ids])
    atomic_json(output / "geography-datasets.json", datasets)
    provenance = manifest.get("geometryProvenance")
    if provenance:
        for dataset, period in profiles:
            relative = Path(provenance) / dataset / f"{period}.json"
            target = output / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            if (source / relative).resolve() != target.resolve():
                shutil.copyfile(source / relative, target)
    notice = source / "DLAC-NOTICE.md"
    if notice.exists() and source.resolve() != output.resolve():
        shutil.copyfile(notice, output / notice.name)
    manifest.pop("branchCoverage", None)
    manifest.update(geometry)
    manifest.update(
        geometryVariantCount=len(variants),
        languoidWithGeometryCount=sum(bool(l["geometryVariantIds"]) for l in languages),
        geometryIndex="geometry-index.json",
    )
    atomic_json(output / "manifest.json", manifest)


def build_profile(
    dataset: str,
    period: str,
    feature_path: Path,
    output: Path,
    cache: Path,
    tile_join: str,
    settings: dict[str, Any],
    fingerprint: str,
    lod_fingerprint: str,
):
    # Keep native geometry ownership inside one profile, including failure paths.
    source_hash = settings["source"]
    max_zoom = settings["maxZoom"]
    tolerance_pixels = settings["tolerancePixels"]
    boundary_tolerance_pixels = settings["boundaryTolerancePixels"]
    directory = f"coverage-parts/v3-{fingerprint}/"
    label = f"{dataset}/{period}"

    def log(message, label=label):
        print(f"{label}: {message}", flush=True)

    partition_file = cache / f"v{PARTITION_VERSION}-{source_hash[:20]}" / f"{label}.jsonl.gz"
    if partition_file.exists():
        partition = load_partition(partition_file)
        log(f"loaded {len(partition.faces)} canonical faces")
    else:
        partition = partition_sources(read_features(feature_path), log=log)
        save_partition(partition_file, partition)
    parts = output / directory / label
    parts.mkdir(parents=True, exist_ok=True)
    database_path = cache / f"{fingerprint}/{label}.mbtiles"
    database_path.parent.mkdir(parents=True, exist_ok=True)
    with closing(create_database(database_path, max_zoom)) as database:
        stats_path = database_path.with_suffix(".json")
        stats = json.loads(stats_path.read_text()) if stats_path.exists() else {}
        area_index = None
        for zoom in range(max_zoom + 1):
            complete = stats.get(str(zoom))
            source_tiles = {
                f"{x}-{2**zoom - 1 - row}"
                for x, row in database.execute(
                    "SELECT tile_column, tile_row FROM tiles WHERE zoom_level=?", (zoom,)
                )
            }
            if (
                not complete
                or not all((parts / f"{zoom}-{name}.pbf").is_file() for name in complete["tiles"])
                or not set(complete["tiles"]).issubset(source_tiles)
                or len(source_tiles) != complete.get("sourceTiles", len(source_tiles))
            ):
                lod_file = cache / lod_fingerprint / f"{label}/lod-{zoom}.jsonl.gz"
                if lod_file.exists():
                    encoded = load_partition(lod_file)
                else:
                    area_index = area_index or SourceAreaIndex(partition)
                    encoded = simplify_partition(
                        quantize_partition(partition, zoom, log, area_index),
                        zoom,
                        tolerance_pixels,
                        boundary_tolerance_pixels,
                    )
                    save_partition(lod_file, encoded)
                log(
                    f"zoom {zoom}: {len(encoded.faces)} simplified faces, {int(sum(geos.get_num_coordinates(encoded.faces)))} positions"
                )
                stats[str(zoom)] = write_level(encoded, zoom, parts, database)
                stats[str(zoom)].update(encoded.stats)
                atomic_json(stats_path, stats)
            log(f"zoom {zoom}: {stats[str(zoom)]['positions']} parts positions")
    index = {str(z): stats[str(z)]["tiles"] for z in range(max_zoom + 1)}
    index_hash = hashlib.sha256(json.dumps(index, separators=(",", ":")).encode()).hexdigest()[:20]
    index_name = f"index-{index_hash}.json"
    atomic_json(parts / index_name, index)
    profile_archive = f"geometry/v2-{fingerprint}/{label}.pmtiles"
    target = output / profile_archive
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(".tmp.pmtiles")
    subprocess.run(
        [
            tile_join,
            "--force",
            "--no-tile-size-limit",
            "--quiet",
            f"--output={temporary}",
            str(database_path),
        ],
        check=True,
    )
    temporary.replace(target)
    archive_entry = {"datasetId": dataset, "viewId": period, "archive": profile_archive}
    profile = {
        "id": label,
        "datasetId": dataset,
        "viewId": period,
        "maxZoom": max_zoom,
        "tileIndex": f"{label}/{index_name}",
    }
    report = {
        "faces": len(partition.faces),
        "repairs": partition.repairs,
        "levels": stats,
    }
    return archive_entry, profile, report


def build(
    source: Path,
    output: Path,
    cache: Path,
    tile_join: str,
    *,
    datasets: list[str] | None = None,
    periods: list[str] | None = None,
    max_zoom: int = MAX_ZOOM,
    tolerance_pixels: float = 1,
    boundary_tolerance_pixels: float = 0.05,
) -> dict[str, Any]:
    if not 0 <= max_zoom <= MAX_ZOOM or any(
        not math.isfinite(t) or t < 0 for t in [tolerance_pixels, boundary_tolerance_pixels]
    ):
        raise ValueError("Invalid LOD settings")
    started = time.monotonic()
    with source.open("rb") as input_file:
        source_hash = hashlib.file_digest(input_file, "sha256").hexdigest()
    settings = {
        "version": ALGORITHM_VERSION,
        "source": source_hash,
        "geos": geos.geos_version_string,
        "extent": EXTENT,
        "sourceGrid": SOURCE_GRID,
        "labelPrecision": SOURCE_GRID,
        "labelRegionZoom": AREA_INDEX_ZOOM,
        "tolerancePixels": tolerance_pixels,
        "boundaryTolerancePixels": boundary_tolerance_pixels,
        "maxZoom": max_zoom,
    }
    fingerprint = hashlib.sha256(json.dumps(settings, sort_keys=True).encode()).hexdigest()[:20]
    lod_fingerprint = hashlib.sha256(
        json.dumps({**settings, "version": LOD_VERSION}, sort_keys=True).encode()
    ).hexdigest()[:20]
    directory = f"coverage-parts/v3-{fingerprint}/"
    profiles = []
    archives = []
    reports = {}
    for (dataset, period), feature_path in sorted(
        source_profiles(source, cache / f"sources-{source_hash[:20]}").items()
    ):
        if (datasets and dataset not in datasets) or (periods and period not in periods):
            continue
        archive_entry, profile, report = build_profile(
            dataset,
            period,
            feature_path,
            output,
            cache,
            tile_join,
            settings,
            fingerprint,
            lod_fingerprint,
        )
        archives.append(archive_entry)
        profiles.append(profile)
        reports[profile["id"]] = report
    if not profiles:
        raise ValueError("No matching source profiles")
    archive = output / "language-areas.pmtiles"
    temporary = archive.with_suffix(".tmp.pmtiles")
    subprocess.run(
        [
            tile_join,
            "--force",
            "--no-tile-size-limit",
            "--quiet",
            f"--output={temporary}",
            *[str(output / p["archive"]) for p in archives],
        ],
        check=True,
    )
    temporary.replace(archive)
    report_name = f"geometry/v2-{fingerprint}/report.json"
    atomic_json(
        output / report_name,
        {"settings": settings, "profiles": reports, "seconds": time.monotonic() - started},
    )
    return {
        "archive": archive.name,
        "geometryMaxZoom": max_zoom,
        "geometryProfiles": archives,
        "coverageParts": {"directory": directory, "maxZoom": max_zoom, "profiles": profiles},
        "geometryBuild": {
            "kind": "shared-coverage",
            "version": ALGORITHM_VERSION,
            "fingerprint": fingerprint,
            "report": report_name,
        },
    }


def main() -> None:
    from pipeline.atlas.build import (
        NORMALIZED_GEOMETRIES,
        PROCESSED_DIR,
        PUBLIC_DATA_DIR,
        find_tile_join,
    )

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=PROCESSED_DIR / "topology-preview")
    parser.add_argument("--dataset", action="append")
    parser.add_argument("--period", action="append")
    parser.add_argument("--tolerance-pixels", type=float, default=1)
    parser.add_argument("--boundary-tolerance-pixels", type=float, default=0.05)
    parser.add_argument("--restore-parts", action="store_true")
    parser.add_argument("--max-zoom", type=int, choices=range(MAX_ZOOM + 1), default=MAX_ZOOM)
    args = parser.parse_args()
    if args.restore_parts:
        restore_parts(
            NORMALIZED_GEOMETRIES,
            args.output,
            PROCESSED_DIR / "topology",
            datasets=args.dataset,
            periods=args.period,
            max_zoom=args.max_zoom,
        )
        return
    binary = find_tile_join()
    if not binary:
        parser.error("Run pipeline/atlas/bootstrap-tippecanoe.sh first")
    result = build(
        NORMALIZED_GEOMETRIES,
        args.output,
        PROCESSED_DIR / "topology",
        binary,
        datasets=args.dataset,
        periods=args.period,
        max_zoom=args.max_zoom,
        tolerance_pixels=args.tolerance_pixels,
        boundary_tolerance_pixels=args.boundary_tolerance_pixels,
    )
    atomic_json(args.output / "geometry-manifest.json", result)
    export_catalog(PUBLIC_DATA_DIR, args.output, result)


if __name__ == "__main__":
    main()
