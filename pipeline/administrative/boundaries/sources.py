"""Restore and verify the pinned Natural Earth country archive."""

from __future__ import annotations

import argparse
import hashlib
import json
import tempfile
import urllib.request
from pathlib import Path

from pipeline.administrative.boundaries.build import ARCHIVE, PIN


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
        data = response.read(spec["bytes"] + 1)
    check_bytes(data, spec)
    return data


def restore(archive: Path, pin: dict) -> None:
    spec = pin["naturalEarth"]
    if archive.exists() or archive.is_symlink():
        check_file(archive, spec)
        return
    data = fetch_archive(spec)
    check_bytes(data, spec)
    archive.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        dir=archive.parent, prefix=".boundary-", delete=False
    ) as handle:
        staged = Path(handle.name)
        try:
            handle.write(data)
            handle.flush()
            staged.replace(archive)
        finally:
            staged.unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("restore", "verify"))
    args = parser.parse_args()
    pin = read_pin()
    try:
        if args.command == "restore":
            restore(ARCHIVE, pin)
        check_file(ARCHIVE, pin["naturalEarth"])
    except (OSError, ValueError, KeyError) as error:
        parser.exit(1, f"Boundary source {args.command} failed: {error}\n")
    print(f"Verified pinned Natural Earth {pin['naturalEarth']['version']} archive")


if __name__ == "__main__":
    main()
