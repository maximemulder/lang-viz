#!/usr/bin/env python3
"""Small archive primitives shared by independently validated data releases."""

from __future__ import annotations

import gzip
import hashlib
import tarfile
from pathlib import Path, PurePosixPath


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def local_path(root: Path, name: str) -> Path:
    path = PurePosixPath(name)
    if not name or path.is_absolute() or ".." in path.parts or "\\" in name:
        raise ValueError(f"Invalid data path: {name}")
    result = root.joinpath(*path.parts)
    if not result.resolve().is_relative_to(root.resolve()):
        raise ValueError(f"Data path escapes its directory: {name}")
    return result


def write_archive(root: Path, names: list[str], output: Path) -> None:
    with (
        output.open("wb") as stream,
        gzip.GzipFile(filename="", fileobj=stream, mode="wb", mtime=0) as compressed,
        tarfile.open(fileobj=compressed, mode="w|", dereference=True) as bundle,
    ):
        for name in sorted(names):
            path = local_path(root, name)
            info = tarfile.TarInfo(name)
            info.size = path.stat().st_size
            info.mode = 0o644
            with path.open("rb") as source:
                bundle.addfile(info, source)


def extract_archive(archive: Path, staging: Path, expected: dict[str, dict]) -> None:
    """Check names/types/sizes before extraction; callers validate contents before install."""
    with tarfile.open(archive, "r:gz") as bundle:
        members = bundle.getmembers()
        names = set()
        for member in members:
            local_path(staging, member.name)
            if (
                not member.isfile()
                or member.name in names
                or member.name not in expected
                or member.size != expected[member.name]["bytes"]
            ):
                raise ValueError(f"Invalid bundle member: {member.name}")
            names.add(member.name)
        if names != set(expected):
            raise ValueError("Bundle file set does not match its pin")
        bundle.extractall(staging, members=members, filter="data")
