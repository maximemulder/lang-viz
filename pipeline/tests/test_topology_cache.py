#!/usr/bin/env python3
"""Exercise stage reuse through real source/parts export and archive packaging."""

import json

import pytest
from shapely import box

from pipeline.atlas import topology_build as builder
from pipeline.atlas import topology_cache as geometry_cache
from pipeline.atlas.build import find_tile_join
from pipeline.tests.test_coverage_topology import feature


@pytest.fixture
def atlas(tmp_path):
    binary = find_tile_join()
    if not binary:
        pytest.skip("Build tile-join to exercise cache reuse")
    source = tmp_path / "areas.geojsonl"
    output, cache = tmp_path / "public", tmp_path / "cache"
    records = []
    for dataset in ("a", "b"):
        record = feature(f"{dataset}:parent", box(0.48, 0.48, 0.52, 0.52))
        record["properties"].update(dataset_id=dataset, temporal_view="contemporary")
        records.append(record)
    source.write_text("\n".join(json.dumps(r) for r in records) + "\n")

    def run(max_zoom=1, **options):
        result = builder.build(source, output, cache, binary, max_zoom=max_zoom, jobs=1, **options)
        builder.atomic_json(output / "manifest.json", result)
        return result

    return source, output, cache, records, run


def forbid_work(*args, **kwargs):
    raise AssertionError("Completed outputs must not load geometry or invoke packaging")


def test_unchanged_build_needs_no_geometry_loading_or_packaging(atlas, monkeypatch):
    _, output, _, _, run = atlas
    before = run()
    archive = output / before["archive"]
    stamp = archive.stat().st_mtime_ns
    monkeypatch.setattr(geometry_cache, "load_partition", forbid_work)
    monkeypatch.setattr(geometry_cache, "partition_sources", forbid_work)
    monkeypatch.setattr(builder.subprocess, "run", forbid_work)
    monkeypatch.setattr(builder, "ProcessPoolExecutor", forbid_work)
    assert run() == before
    assert archive.stat().st_mtime_ns == stamp
    report = json.loads((output / before["geometryBuild"]["report"]).read_text())
    assert report["execution"]["reusedProfiles"] == 2
    assert report["execution"]["workers"] == 0
    assert report["execution"]["mergeReused"]


def test_extending_and_reducing_zoom_reuses_lower_stages(atlas, monkeypatch):
    _, output, cache, _, run = atlas
    first = run()
    lows = {p: p.stat().st_mtime_ns for p in cache.glob("lod/**/*.jsonl.gz")}
    keys = [p["id"] for p in first["coverageParts"]["profiles"]]
    calls = []
    original = geometry_cache.quantize_partition

    def observe(partition, zoom, *args):
        calls.append(zoom)
        return original(partition, zoom, *args)

    monkeypatch.setattr(geometry_cache, "partition_sources", forbid_work)
    monkeypatch.setattr(geometry_cache, "quantize_partition", observe)
    extended = run(2)
    assert calls == [2, 2], "Only the newly requested level should be computed"
    assert all(p.stat().st_mtime_ns == stamp for p, stamp in lows.items())
    assert [p["id"] for p in extended["coverageParts"]["profiles"]] == keys
    # PMTiles v3 stores the highest native zoom at byte 101. A lower requested
    # ceiling must not accidentally package the database's higher cached levels.
    monkeypatch.setattr(geometry_cache, "quantize_partition", forbid_work)
    reduced = run(0)
    for archive in reduced["geometryProfiles"]:
        assert (output / archive["archive"]).read_bytes()[101] == 0
    assert run() == first


def test_changed_profile_preserves_unrelated_outputs(atlas, monkeypatch):
    source, output, _, records, run = atlas
    first = run()
    entry = first["geometryProfiles"][0]
    path = output / entry["archive"]
    stamp = path.stat().st_mtime_ns
    records[1]["geometry"] = feature("unused", box(0.49, 0.49, 0.53, 0.53))["geometry"]
    source.write_text("\n".join(json.dumps(r) for r in records) + "\n")
    calls = []
    original = geometry_cache.partition_sources

    def observe(features, **options):
        features = list(features)
        calls.extend({r["properties"]["dataset_id"] for r in features})
        return original(features, **options)

    monkeypatch.setattr(geometry_cache, "partition_sources", observe)
    changed = run()
    assert calls == ["b"]
    assert changed["geometryProfiles"][0] == entry
    assert path.stat().st_mtime_ns == stamp
    assert changed["geometryProfiles"][1] != first["geometryProfiles"][1]


def test_tolerance_change_reuses_canonical_geometry(atlas, monkeypatch):
    _, _, cache, _, run = atlas
    first = run()
    masters = {p: p.stat().st_mtime_ns for p in cache.glob("canonical/**/*.jsonl.gz")}
    monkeypatch.setattr(geometry_cache, "partition_sources", forbid_work)
    changed = run(tolerance_pixels=0.5)
    assert all(p.stat().st_mtime_ns == stamp for p, stamp in masters.items())
    assert len(list(cache.glob("canonical/**/*.jsonl.gz"))) == len(masters)
    assert changed["geometryProfiles"] != first["geometryProfiles"]


def test_missing_index_reuses_cached_exports(atlas, monkeypatch):
    _, output, _, _, run = atlas
    first = run()
    profile = first["coverageParts"]["profiles"][0]
    index = output / first["coverageParts"]["directory"] / profile["tileIndex"]
    expected = index.read_bytes()
    index.unlink()
    monkeypatch.setattr(geometry_cache, "load_partition", forbid_work)
    monkeypatch.setattr(geometry_cache, "partition_sources", forbid_work)
    monkeypatch.setattr(builder.subprocess, "run", forbid_work)
    assert run() == first
    assert index.read_bytes() == expected


def test_missing_parts_rebuild_from_the_shared_lod(atlas, monkeypatch):
    _, output, cache, _, run = atlas
    manifest = run()
    profile = manifest["coverageParts"]["profiles"][0]
    path = output / manifest["coverageParts"]["directory"] / profile["id"] / "0-0-0.pbf"
    expected = path.read_bytes()
    path.unlink()
    next(cache.glob("tiles/*/a/contemporary/parts/0-0-0.pbf")).unlink()
    monkeypatch.setattr(geometry_cache, "partition_sources", forbid_work)
    assert run() == manifest
    assert path.read_bytes() == expected


def test_restoration_uses_shared_lod_builder_and_retains_other_profiles(atlas, monkeypatch):
    source, output, cache, _, run = atlas
    manifest = run()
    profile = manifest["coverageParts"]["profiles"][0]
    public = output / manifest["coverageParts"]["directory"] / profile["id"]
    original_parts = {p.name: p.read_bytes() for p in public.glob("*.pbf")}
    for path in public.glob("*.pbf"):
        path.unlink()
    for path in cache.glob("tiles/*/a/contemporary/parts/*.pbf"):
        path.unlink()
    for path in cache.glob("lod/*/a/contemporary/*.jsonl.gz"):
        path.unlink()
    archive = output / manifest["archive"]
    stamp = archive.stat().st_mtime_ns
    calls = []
    original = geometry_cache.ProfileCache.get_or_build_lod

    def observe(store, zoom):
        calls.append(zoom)
        return original(store, zoom)

    monkeypatch.setattr(geometry_cache.ProfileCache, "get_or_build_lod", observe)
    monkeypatch.setattr(geometry_cache, "partition_sources", forbid_work)
    builder.restore_parts(source, output, cache, datasets=["a"])
    assert calls == [0, 1]
    assert {p.name: p.read_bytes() for p in public.glob("*.pbf")} == original_parts
    assert archive.stat().st_mtime_ns == stamp
    assert len(json.loads((output / "manifest.json").read_text())["coverageParts"]["profiles"]) == 2


def test_restoration_of_unchanged_profile_allows_other_source_changes(atlas):
    source, output, _, records, run = atlas
    manifest = run()
    profile = manifest["coverageParts"]["profiles"][0]
    path = output / manifest["coverageParts"]["directory"] / profile["id"] / "0-0-0.pbf"
    expected = path.read_bytes()
    path.unlink()
    records[1]["geometry"] = feature("unused", box(0.49, 0.49, 0.53, 0.53))["geometry"]
    source.write_text("\n".join(json.dumps(r) for r in records) + "\n")
    builder.restore_parts(source, output, atlas[2], datasets=["a"])
    assert path.read_bytes() == expected


def test_clearing_cache_rebuilds_outputs(atlas, monkeypatch):
    import shutil

    _, output, cache, _, run = atlas
    first = run()
    archive = output / first["archive"]
    expected = archive.read_bytes()
    profile = first["coverageParts"]["profiles"][0]
    part = output / first["coverageParts"]["directory"] / profile["id"] / "0-0-0.pbf"
    expected_part = part.read_bytes()
    shutil.rmtree(cache)
    # A cache reset must replace published geometry left by an older algorithm,
    # even though source/settings (and therefore output paths) are unchanged.
    archive.write_bytes(b"previous geometry")
    part.write_bytes(b"previous part")
    calls = []
    original = geometry_cache.partition_sources

    def observe(features, **options):
        calls.append(True)
        return original(features, **options)

    monkeypatch.setattr(geometry_cache, "partition_sources", observe)
    assert run() == first
    assert len(calls) == 2
    assert archive.read_bytes() == expected
    assert part.read_bytes() == expected_part
