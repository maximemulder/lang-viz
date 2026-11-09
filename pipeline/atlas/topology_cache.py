#!/usr/bin/env python3
"""Stage identities and lazy geometry shared by generation and restoration."""

from __future__ import annotations

import gzip
import hashlib
import json
import math
import os
import shutil
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from functools import cached_property
from pathlib import Path
from typing import Any

import shapely as geos

from pipeline.atlas.topology import (
    Partition,
    SourceAreaIndex,
    partition_sources,
    quantize_partition,
    simplify_partition,
)


def fingerprint(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()[:20]


def digest_file(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, separators=(",", ":")) + "\n")
    temporary.replace(path)


def materialize(source: Path, target: Path) -> None:
    """Install immutable artifacts atomically, linking when on the same filesystem."""
    if source == target:
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(target.name + ".tmp")
    temporary.unlink(missing_ok=True)
    try:
        os.link(source, temporary)
    except OSError:
        shutil.copy2(source, temporary)
    temporary.replace(target)


def save_partition(path: Path, partition: Partition) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    with gzip.open(temporary, "wt") as output:
        output.write(
            json.dumps(
                {
                    "faces": len(partition.faces),
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


@dataclass(frozen=True)
class GeometrySettings:
    tolerance_pixels: float = 1
    boundary_tolerance_pixels: float = 0.05

    def __post_init__(self):
        if any(
            not math.isfinite(t) or t < 0
            for t in (
                self.tolerance_pixels,
                self.boundary_tolerance_pixels,
            )
        ):
            raise ValueError("Invalid LOD settings")

    def record(self) -> dict[str, Any]:
        return {
            "tolerancePixels": float(self.tolerance_pixels),
            "boundaryTolerancePixels": float(self.boundary_tolerance_pixels),
        }


@dataclass(frozen=True)
class ProfileSource:
    dataset: str
    period: str
    path: Path
    digest: str

    @property
    def label(self) -> str:
        return f"{self.dataset}/{self.period}"


@dataclass
class ProfileCache:
    root: Path
    source: ProfileSource
    settings: GeometrySettings
    log: Callable[[str], None] = field(default=lambda _: None, repr=False)
    _partition: Partition | None = field(default=None, init=False, repr=False)
    _area_index: SourceAreaIndex | None = field(default=None, init=False, repr=False)
    canonical_seconds: float = field(default=0, init=False)

    @property
    def canonical_loaded(self) -> bool:
        return self._partition is not None

    @property
    def canonical_key(self) -> str:
        return self.source.digest[:20]

    @cached_property
    def lod_key(self) -> str:
        return fingerprint({"source": self.source.digest, **self.settings.record()})

    def archive_key(self, max_zoom: int) -> str:
        return fingerprint({"lod": self.lod_key, "maxZoom": max_zoom})

    @cached_property
    def canonical_file(self) -> Path:
        return self.root / "canonical" / self.canonical_key / f"{self.source.label}.jsonl.gz"

    @cached_property
    def summary_file(self) -> Path:
        return self.canonical_file.with_suffix(".summary.json")

    def lod_file(self, zoom: int) -> Path:
        return self.root / "lod" / self.lod_key / self.source.label / f"{zoom}.jsonl.gz"

    @cached_property
    def tile_directory(self) -> Path:
        return self.root / "tiles" / self.lod_key / self.source.label

    @cached_property
    def parts(self) -> Path:
        return self.tile_directory / "parts"

    @cached_property
    def database(self) -> Path:
        return self.tile_directory / "source.mbtiles"

    @cached_property
    def levels_file(self) -> Path:
        return self.tile_directory / "levels.json"

    def archive(self, max_zoom: int) -> Path:
        return self.root / "archives" / self.archive_key(max_zoom) / f"{self.source.label}.pmtiles"

    def get_canonical(self) -> Partition:
        if self._partition is None:
            started = time.monotonic()
            if self.canonical_file.exists():
                self._partition = load_partition(self.canonical_file)
            else:
                with self.source.path.open() as source:
                    self._partition = partition_sources(
                        (json.loads(line) for line in source), log=self.log
                    )
                save_partition(self.canonical_file, self._partition)
            atomic_json(
                self.summary_file,
                {"faces": len(self._partition.faces), "repairs": self._partition.repairs},
            )
            self.canonical_seconds += time.monotonic() - started
        return self._partition

    def summary(self) -> dict[str, Any]:
        if not self.summary_file.exists():
            self.get_canonical()
        return json.loads(self.summary_file.read_text())

    def get_or_build_lod(self, zoom: int) -> tuple[Partition, bool]:
        path = self.lod_file(zoom)
        if path.exists():
            return load_partition(path), True
        canonical = self.get_canonical()
        self._area_index = self._area_index or SourceAreaIndex(canonical)
        low = simplify_partition(
            quantize_partition(canonical, zoom, self.log, self._area_index),
            zoom,
            self.settings.tolerance_pixels,
            self.settings.boundary_tolerance_pixels,
        )
        save_partition(path, low)
        return low, False
