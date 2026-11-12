#!/usr/bin/env python3
"""Explicit, atomic restoration of pinned WALS and historical comparison inputs."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request
from pathlib import Path

from pipeline.release_utils import digest, local_path

ROOT = Path(__file__).resolve().parents[2]


def read_pin(comparison: bool = False) -> dict:
    return json.loads(
        Path(__file__).with_name("comparison.json" if comparison else "sources.json").read_text()
    )


def source_directory(comparison: bool = False) -> Path:
    return ROOT / "data/wals" / read_pin(comparison)["snapshot"]


def verify_file(path: Path, entry: dict) -> None:
    if (
        not path.is_file()
        or path.is_symlink()
        or path.stat().st_size != entry["bytes"]
        or digest(path) != entry["sha256"]
    ):
        raise ValueError(f"Pinned source missing or checksum/size mismatch: {path}")


def verify(directory: Path, pin: dict) -> None:
    for entry in pin["files"]:
        verify_file(local_path(directory, entry["name"]), entry)
    if "archive" in pin:
        verify_file(directory / "upstream.tar.gz", pin["archive"])


def download(url: str, destination: Path, expected_bytes: int) -> None:
    with urllib.request.urlopen(url, timeout=120) as response, destination.open("wb") as out:
        # An unexpectedly large response must not fill the disk before verification.
        remaining = expected_bytes + 1
        while remaining:
            chunk = response.read(min(1024 * 1024, remaining))
            if not chunk:
                break
            out.write(chunk)
            remaining -= len(chunk)


def restore(
    output: Path, pin: dict, *, archive: Path | None = None, from_git: Path | None = None
) -> None:
    if output.exists():
        verify(output, pin)  # Preserve modified installations; never overwrite them.
        return
    if archive and "archive" not in pin:
        raise ValueError("An archive is only supported for upstream WALS inputs")
    if from_git and "archive" in pin:
        raise ValueError("Use --archive for upstream WALS; --from-git is for the comparison")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=f".{output.name}-", dir=output.parent) as tmp:
        staging = Path(tmp) / "sources"
        staging.mkdir()
        if "archive" in pin:
            spec = pin["archive"]
            packed = staging / "upstream.tar.gz"
            if archive:
                verify_file(archive, spec)
                shutil.copyfile(archive, packed)
            else:
                download(spec["url"], packed, spec["bytes"])
            verify_file(packed, spec)
            with tarfile.open(packed) as bundle:
                names = [m.name for m in bundle.getmembers()]
                if len(names) != len(set(names)):
                    raise ValueError("Duplicate members in WALS source archive")
                for entry in pin["files"]:
                    destination = local_path(staging, entry["name"])
                    member = bundle.getmember(f"{spec['prefix']}/{entry['name']}")
                    if not member.isfile() or member.size != entry["bytes"]:
                        raise ValueError(f"Invalid source archive member: {member.name}")
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    with bundle.extractfile(member) as src, destination.open("wb") as dst:
                        shutil.copyfileobj(src, dst)
        else:
            for entry in pin["files"]:
                destination = local_path(staging, entry["name"])
                destination.parent.mkdir(parents=True, exist_ok=True)
                if from_git:
                    with destination.open("wb") as out:
                        subprocess.run(
                            [
                                "git",
                                "-C",
                                str(from_git),
                                "show",
                                f"{pin['commit']}:{entry['path']}",
                            ],
                            stdout=out,
                            check=True,
                        )
                else:
                    download(entry["url"], destination, entry["bytes"])
        verify(staging, pin)
        staging.rename(output)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "command", choices=("restore", "verify", "restore-comparison", "verify-comparison")
    )
    parser.add_argument("--output", type=Path)
    offline = parser.add_mutually_exclusive_group()
    offline.add_argument("--archive", type=Path, help="Offline immutable upstream tar.gz")
    offline.add_argument("--from-git", type=Path, help="Offline historical comparison clone")
    args = parser.parse_args()
    comparison = args.command.endswith("-comparison")
    pin = read_pin(comparison)
    output = args.output or source_directory(comparison)
    try:
        if args.command.startswith("restore"):
            restore(output, pin, archive=args.archive, from_git=args.from_git)
        else:
            verify(output, pin)
    except (OSError, ValueError, KeyError, tarfile.TarError, subprocess.CalledProcessError) as e:
        parser.exit(1, f"WALS source {args.command} failed: {e}\n")
    print(f"Verified {pin['snapshot']}: {output}")


if __name__ == "__main__":
    main()
