#!/usr/bin/env python3
"""Restore pinned boundary inputs into ignored local data."""

from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import tarfile
import tempfile
import urllib.request
from pathlib import Path

from pipeline.administrative.boundaries.build import ISO_ARCHIVE, PIN, TOPOLOGY


def read_pin() -> dict:
    return json.loads(PIN.read_text(encoding="utf-8"))


def check_bytes(data: bytes, spec: dict) -> None:
    if len(data) != spec["bytes"] or hashlib.sha256(data).hexdigest() != spec["sha256"]:
        raise ValueError("Boundary source does not match its pinned size and SHA-256")


def check_file(path: Path, spec: dict) -> None:
    if not path.is_file() or path.is_symlink():
        raise ValueError(f"Missing or unsafe boundary source: {path}")
    check_bytes(path.read_bytes(), spec)


def fetch_archive(spec: dict) -> bytes:
    request = urllib.request.Request(
        spec["archiveUrl"], headers={"User-Agent": "lang-viz-administrative-boundaries"}
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        data = response.read(3_000_001)
    if len(data) > 3_000_000:
        raise ValueError("Boundary source archive exceeds expected size limit")
    digest = base64.b64encode(hashlib.sha512(data).digest()).decode("ascii")
    if digest != spec["archiveIntegritySha512"]:
        raise ValueError("Boundary source archive has unexpected npm integrity")
    return data


def write_verified(output: Path, data: bytes, spec: dict) -> None:
    check_bytes(data, spec)
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        dir=output.parent, prefix=".boundary-", delete=False
    ) as handle:
        staged = Path(handle.name)
        try:
            handle.write(data)
            handle.flush()
            check_file(staged, spec)
            staged.replace(output)
        finally:
            staged.unlink(missing_ok=True)


def restore(topology: Path, iso_archive: Path, pin: dict) -> None:
    atlas_spec, iso_spec = pin["worldAtlas"], pin["iso3166"]
    if topology.exists() or topology.is_symlink():
        check_file(topology, atlas_spec)
    else:
        archive = fetch_archive(atlas_spec)
        with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as tar:
            member = tar.extractfile(atlas_spec["path"])
            if member is None:
                raise ValueError("Pinned world-atlas archive lacks countries-50m.json")
            data = member.read(atlas_spec["bytes"] + 1)
        write_verified(topology, data, atlas_spec)
    if iso_archive.exists() or iso_archive.is_symlink():
        check_file(iso_archive, iso_spec)
    else:
        write_verified(iso_archive, fetch_archive(iso_spec), iso_spec)


def verify(topology: Path, iso_archive: Path, pin: dict) -> None:
    check_file(topology, pin["worldAtlas"])
    check_file(iso_archive, pin["iso3166"])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("restore", "verify"))
    parser.add_argument("--topology", type=Path, default=TOPOLOGY)
    parser.add_argument("--iso-archive", type=Path, default=ISO_ARCHIVE)
    args = parser.parse_args()
    pin = read_pin()
    try:
        if args.command == "restore":
            restore(args.topology, args.iso_archive, pin)
        verify(args.topology, args.iso_archive, pin)
    except (OSError, ValueError, KeyError, tarfile.TarError) as error:
        parser.exit(1, f"Boundary source {args.command} failed: {error}\n")
    print(f"Verified pinned boundary sources ({pin['viewId']})")


if __name__ == "__main__":
    main()
