#!/usr/bin/env python3
"""Materialize shared-coverage LODs as ordinary MVT/PMTiles browser assets.

Run independently with --output to evaluate new geometry without publishing it
to the app. Both the offline cache and output paths are resumable build products.
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
import multiprocessing
import os
import shutil
import sqlite3
import subprocess
import time
from collections import defaultdict
from collections.abc import Iterable
from concurrent.futures import ProcessPoolExecutor, as_completed
from contextlib import ExitStack, closing
from functools import partial
from pathlib import Path
from typing import Any

import mapbox_vector_tile
import numpy as np
import shapely as geos
from mapbox_vector_tile.encoder import on_invalid_geometry_raise

from pipeline.atlas.topology import (
    EXTENT,
    MAX_ZOOM,
    Partition,
    polygons,
    split_point_contacts,
)
from pipeline.atlas.topology_cache import (
    GeometrySettings,
    ProfileCache,
    ProfileSource,
    atomic_json,
    digest_file,
    fingerprint,
    materialize,
)


def source_profiles(source: Path, cache: Path) -> dict[tuple[str, str], ProfileSource]:
    """Spool once; never retain every dataset's coordinates in Python objects."""
    index = cache / "profiles.json"
    if index.exists():
        records = json.loads(index.read_text())
        if any(not (cache / p["path"]).is_file() for p in records):
            index.unlink()
            return source_profiles(source, cache)
        return {
            (p["dataset"], p["period"]): ProfileSource(
                p["dataset"], p["period"], cache / p["path"], p["sha256"]
            )
            for p in records
        }
    cache.mkdir(parents=True, exist_ok=True)
    profiles: dict[tuple[str, str], Path] = {}
    with ExitStack() as stack, source.open() as lines:
        handles = {}
        for line in lines:
            if not line.strip():
                continue
            props = json.loads(line)["properties"]
            key = (props["dataset_id"], props["temporal_view"])
            if key not in handles:
                path = cache / f"{len(profiles)}.geojsonl"
                profiles[key] = path
                handles[key] = stack.enter_context(path.open("w"))
            handles[key].write(line)
    records = [
        {"dataset": d, "period": p, "path": path.name, "sha256": digest_file(path)}
        for (d, p), path in profiles.items()
    ]
    atomic_json(index, records)
    return {
        (p["dataset"], p["period"]): ProfileSource(
            p["dataset"], p["period"], cache / p["path"], p["sha256"]
        )
        for p in records
    }


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
    parts.mkdir(parents=True, exist_ok=True)
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
    """Restore parts through the same profile cache and LOD builder as generation."""
    manifest_path = output / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    descriptor = manifest.get("geometryBuild", {})
    if descriptor.get("kind") != "shared-coverage":
        raise ValueError("This manifest was not built with shared coverage")
    report_path = output / descriptor["report"]
    report = json.loads(report_path.read_text())
    settings = GeometrySettings(
        report["settings"]["tolerancePixels"], report["settings"]["boundaryTolerancePixels"]
    )
    source_hash = digest_file(source)
    sources = source_profiles(source, cache / f"sources-{source_hash[:20]}")
    config = manifest["coverageParts"]
    matched = 0
    for profile in config["profiles"]:
        dataset, period = profile["datasetId"], profile["viewId"]
        if (datasets and dataset not in datasets) or (periods and period not in periods):
            continue
        label = f"{dataset}/{period}"
        current = sources.get((dataset, period))
        previous = report["profiles"][label]
        if current is None or previous["source"] != current.digest:
            raise ValueError("Source changed; rebuild the atlas first")
        matched += 1
        store = ProfileCache(cache, current, settings)
        levels = read_json(store.levels_file) or {}
        directory = output / config["directory"]
        parts = directory / profile["id"]
        index = read_json(directory / profile["tileIndex"]) or {}
        limit = min(max_zoom, profile.get("maxZoom", config["maxZoom"]))
        for zoom in range(limit + 1):
            level = levels.get(str(zoom), previous["levels"].get(str(zoom)))
            if (
                level
                and parts_complete(parts, zoom, level)
                and index.get(str(zoom)) == level["tiles"]
            ):
                continue
            if not parts_complete(store.parts, zoom, level):
                low, _ = store.get_or_build_lod(zoom)
                stats = write_level(low, zoom, store.parts, None)
                if level:
                    stats.update(
                        {k: level[k] for k in ("sourceTiles", "sourcePositions") if k in level}
                    )
                level = {**stats, **low.stats}
            levels[str(zoom)] = level
            atomic_json(store.levels_file, levels)
            for name in level["tiles"]:
                target = parts / f"{zoom}-{name}.pbf"
                if not target.is_file():
                    materialize(store.parts / target.name, target)
            index[str(zoom)] = level["tiles"]
            name = f"index-{fingerprint(index)}.json"
            atomic_json(parts / name, index)
            profile["tileIndex"] = f"{profile['id']}/{name}"
            previous["levels"][str(zoom)] = level
            atomic_json(report_path, report)
            atomic_json(manifest_path, manifest)
        print(f"{label}: canonical parts ready through zoom {limit}", flush=True)
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
    previous = read_json(output / "manifest.json") or {}
    manifest.pop("branchCoverage", None)
    if (
        geometry.get("geometryBuild", {}).get("fingerprint")
        and previous.get("geometryBuild", {}).get("fingerprint")
        == geometry.get("geometryBuild", {}).get("fingerprint")
        and "branchCoverage" in previous
    ):
        manifest["branchCoverage"] = previous["branchCoverage"]
    manifest.update(geometry)
    manifest.update(
        geometryVariantCount=len(variants),
        languoidWithGeometryCount=sum(bool(l["geometryVariantIds"]) for l in languages),
        geometryIndex="geometry-index.json",
    )
    atomic_json(output / "manifest.json", manifest)


PARTS_DIRECTORY = "coverage-parts/"


def read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def parts_complete(directory: Path, zoom: int, level: dict[str, Any] | None) -> bool:
    return level is not None and all(
        (directory / f"{zoom}-{name}.pbf").is_file() for name in level["tiles"]
    )


def profile_paths(store: ProfileCache, output: Path, max_zoom: int):
    archive = f"geometry/{store.archive_key(max_zoom)}/{store.source.label}.pmtiles"
    profile_id = f"{store.lod_key}/{store.source.label}"
    return archive, profile_id, output / PARTS_DIRECTORY / profile_id


def completed_profile(store: ProfileCache, output: Path, max_zoom: int):
    archive, _, parts = profile_paths(store, output, max_zoom)
    completed = read_json(store.archive(max_zoom).with_suffix(".json"))
    if not completed or not (output / archive).is_file():
        return None
    index = read_json(output / PARTS_DIRECTORY / completed["profile"]["tileIndex"])
    levels = completed["report"]["levels"]
    if index != {str(z): levels[str(z)]["tiles"] for z in range(max_zoom + 1)} or not all(
        parts_complete(parts, z, levels.get(str(z))) for z in range(max_zoom + 1)
    ):
        return None
    report = completed["report"]
    report["timings"] = {
        "processId": os.getpid(),
        "reused": True,
        "canonicalLoaded": False,
        "canonicalSeconds": 0,
        "levelsSeconds": 0,
        "packagingSeconds": 0,
        "totalSeconds": 0,
        "levels": {
            str(z): {
                "reused": True,
                "seconds": 0,
                "lodSeconds": 0,
                "exportSeconds": 0,
                "lodCacheHit": None,
            }
            for z in range(max_zoom + 1)
        },
    }
    return completed["entry"], completed["profile"], report


def publish_index(parts: Path, profile_id: str, levels: dict[str, Any], max_zoom: int):
    index = {str(z): levels[str(z)]["tiles"] for z in range(max_zoom + 1)}
    name = f"index-{fingerprint(index)}.json"
    path = parts / name
    if read_json(path) != index:
        atomic_json(path, index)
    return f"{profile_id}/{name}"


def build_profile(
    source: ProfileSource,
    output: Path,
    cache: Path,
    tile_join: str,
    settings: GeometrySettings,
    max_zoom: int,
    tile_threads: int = 1,
):
    started = time.monotonic()
    label = source.label
    log = partial(print, flush=True)
    store = ProfileCache(cache, source, settings, lambda message: log(f"{label}: {message}"))
    complete = completed_profile(store, output, max_zoom)
    if complete:
        return complete
    archive_name, profile_id, parts = profile_paths(store, output, max_zoom)
    levels = read_json(store.levels_file) or {}
    cached_archive = store.archive(max_zoom)
    archive_ready = cached_archive.is_file()
    level_timings = {}
    levels_started = time.monotonic()
    with ExitStack() as stack:
        database = None
        for zoom in range(max_zoom + 1):
            begin = time.monotonic()
            level = levels.get(str(zoom))
            need_parts = not parts_complete(store.parts, zoom, level)
            need_source = False
            if not archive_ready:
                if database is None:
                    store.database.parent.mkdir(parents=True, exist_ok=True)
                    database = stack.enter_context(
                        closing(create_database(store.database, max_zoom))
                    )
                count = database.execute(
                    "SELECT COUNT(*) FROM tiles WHERE zoom_level=?", (zoom,)
                ).fetchone()[0]
                need_source = level is None or count != level.get("sourceTiles", -1)
            lod_seconds = export_seconds = 0.0
            cache_hit = None
            if need_parts or need_source:
                lod_started = time.monotonic()
                low, cache_hit = store.get_or_build_lod(zoom)
                lod_seconds = time.monotonic() - lod_started
                export_started = time.monotonic()
                stats = write_level(low, zoom, store.parts, database)
                # Parts-only restoration must retain source-cache completion counts.
                if database is None and level:
                    stats.update(
                        {k: level[k] for k in ("sourceTiles", "sourcePositions") if k in level}
                    )
                level = levels[str(zoom)] = {**stats, **low.stats}
                atomic_json(store.levels_file, levels)
                export_seconds = time.monotonic() - export_started
            for name in level["tiles"]:
                target = parts / f"{zoom}-{name}.pbf"
                if need_parts or not target.is_file():
                    materialize(store.parts / target.name, target)
            level_timings[str(zoom)] = {
                "seconds": time.monotonic() - begin,
                "reused": not (need_parts or need_source),
                "lodCacheHit": cache_hit,
                "lodSeconds": lod_seconds,
                "exportSeconds": export_seconds,
            }
    levels_seconds = time.monotonic() - levels_started
    package_started = time.monotonic()
    if not archive_ready:
        cached_archive.parent.mkdir(parents=True, exist_ok=True)
        temporary = cached_archive.with_suffix(".tmp.pmtiles")
        environment = os.environ.copy()
        environment.setdefault("TIPPECANOE_MAX_THREADS", str(tile_threads))
        subprocess.run(
            [
                tile_join,
                "--force",
                "--no-tile-size-limit",
                "--quiet",
                f"--maximum-zoom={max_zoom}",
                f"--output={temporary}",
                str(store.database),
            ],
            check=True,
            env=environment,
        )
        temporary.replace(cached_archive)
    materialize(cached_archive, output / archive_name)
    tile_index = publish_index(parts, profile_id, levels, max_zoom)
    entry = {"datasetId": source.dataset, "viewId": source.period, "archive": archive_name}
    profile = {
        "id": profile_id,
        "datasetId": source.dataset,
        "viewId": source.period,
        "maxZoom": max_zoom,
        "tileIndex": tile_index,
    }
    report = {
        **store.summary(),
        "source": source.digest,
        "levels": {str(z): levels[str(z)] for z in range(max_zoom + 1)},
        "timings": {
            "processId": os.getpid(),
            "reused": False,
            "canonicalLoaded": store.canonical_loaded,
            "canonicalSeconds": store.canonical_seconds,
            "levelsSeconds": levels_seconds,
            "packagingSeconds": time.monotonic() - package_started,
            "packagingReused": archive_ready,
            "totalSeconds": time.monotonic() - started,
            "levels": level_timings,
        },
    }
    atomic_json(
        cached_archive.with_suffix(".json"),
        {
            "entry": entry,
            "profile": profile,
            "report": report,
        },
    )
    return entry, profile, report


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
    jobs: int | None = None,
) -> dict[str, Any]:
    if jobs is not None and jobs < 1:
        raise ValueError("jobs must be a positive integer")
    if not 0 <= max_zoom <= MAX_ZOOM:
        raise ValueError("Invalid LOD settings")
    started = time.monotonic()
    config = GeometrySettings(tolerance_pixels, boundary_tolerance_pixels)
    source_hash = digest_file(source)
    settings = {
        **config.record(),
        "source": source_hash,
        "maxZoom": max_zoom,
    }
    tasks = [
        profile
        for (dataset, period), profile in source_profiles(
            source, cache / f"sources-{source_hash[:20]}"
        ).items()
        if (not datasets or dataset in datasets) and (not periods or period in periods)
    ]
    if not tasks:
        raise ValueError("No matching source profiles")
    tasks.sort(key=lambda profile: (-profile.path.stat().st_size, profile.label))
    results = []
    pending = []
    for profile in tasks:
        complete = completed_profile(ProfileCache(cache, profile, config), output, max_zoom)
        if complete:
            results.append(complete)
        else:
            pending.append(profile)
    reused_profiles = len(results)
    cpus = getattr(os, "process_cpu_count", os.cpu_count)() or 1
    workers = min(jobs if jobs is not None else min(2, cpus), len(pending))
    worker = partial(
        build_profile,
        output=output,
        cache=cache,
        tile_join=tile_join,
        settings=config,
        max_zoom=max_zoom,
        tile_threads=max(1, cpus // max(1, workers)),
    )
    prepare_seconds = time.monotonic() - started
    profiles_started = time.monotonic()
    print(
        f"{reused_profiles} complete profiles reused; building {len(pending)} with {workers} worker(s)",
        flush=True,
    )
    if workers <= 1:
        results.extend(worker(profile) for profile in pending)
    else:
        with ProcessPoolExecutor(
            max_workers=workers,
            mp_context=multiprocessing.get_context("spawn"),
            max_tasks_per_child=1,
        ) as executor:
            futures = [executor.submit(worker, profile) for profile in pending]
            try:
                results.extend(future.result() for future in as_completed(futures))
            except BaseException:
                for future in futures:
                    future.cancel()
                raise
    profiles_seconds = time.monotonic() - profiles_started
    results.sort(key=lambda result: (result[0]["datasetId"], result[0]["viewId"]))
    archives = [entry for entry, _, _ in results]
    profiles = [profile for _, profile, _ in results]
    reports = {f"{entry['datasetId']}/{entry['viewId']}": report for entry, _, report in results}
    archive_keys = [
        ProfileCache(cache, p, config).archive_key(max_zoom)
        for p in sorted(tasks, key=lambda p: p.label)
    ]
    build_key = fingerprint(archive_keys)
    merge_started = time.monotonic()
    archive = output / "language-areas.pmtiles"
    marker = cache / "combined.json"
    merged_reused = archive.is_file() and read_json(marker) == build_key
    if not merged_reused:
        cached = cache / "bundles" / f"{build_key}.pmtiles"
        if not cached.is_file():
            cached.parent.mkdir(parents=True, exist_ok=True)
            temporary = cached.with_suffix(".tmp.pmtiles")
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
            temporary.replace(cached)
        materialize(cached, archive)
        atomic_json(marker, build_key)
    report_name = f"geometry/build-{build_key}/report.json"
    atomic_json(
        output / report_name,
        {
            "settings": settings,
            "profiles": reports,
            "seconds": time.monotonic() - started,
            "execution": {
                "workers": workers,
                "reusedProfiles": reused_profiles,
                "prepareSeconds": prepare_seconds,
                "profilesSeconds": profiles_seconds,
                "mergeSeconds": time.monotonic() - merge_started,
                "mergeReused": merged_reused,
            },
        },
    )
    return {
        "archive": archive.name,
        "geometryMaxZoom": max_zoom,
        "geometryProfiles": archives,
        "coverageParts": {"directory": PARTS_DIRECTORY, "maxZoom": max_zoom, "profiles": profiles},
        "geometryBuild": {
            "kind": "shared-coverage",
            "fingerprint": build_key,
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
    parser.add_argument(
        "--jobs", type=int, help="Concurrent profiles (default: up to 2; 1 is serial)"
    )
    args = parser.parse_args()
    if args.jobs is not None and args.jobs < 1:
        parser.error("--jobs must be a positive integer")
    if args.restore_parts and args.jobs is not None:
        parser.error("--jobs applies to generation; parts restoration publishes levels serially")
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
        jobs=args.jobs,
    )
    atomic_json(args.output / "geometry-manifest.json", result)
    export_catalog(PUBLIC_DATA_DIR, args.output, result)


if __name__ == "__main__":
    main()
