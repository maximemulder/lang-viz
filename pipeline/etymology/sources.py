#!/usr/bin/env python3
"""Restore the reviewed lexical snapshot without merging its Git history.

Uses immutable commit URLs by default; --from-git reads an existing local clone.
Neither mode consults the mutable upstream export endpoints.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PIN = Path(__file__).with_name("sources.json")


def read_pin() -> dict:
    return json.loads(PIN.read_text(encoding="utf-8"))


def source_directory() -> Path:
    return ROOT / "data/etymology" / read_pin()["snapshot"]


def verify(directory: Path, pin: dict) -> None:
    for entry in pin["files"]:
        path = directory / entry["name"]
        if not path.is_file():
            raise ValueError(f"Missing pinned source: {path}")
        with path.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        if path.stat().st_size != entry["bytes"] or digest != entry["sha256"]:
            raise ValueError(f"Pinned source checksum/size mismatch: {path}")


def restore(output: Path, pin: dict, from_git: Path | None = None) -> None:
    if output.exists():
        # Do not overwrite a user's modified inputs or a working installation.
        verify(output, pin)
        return
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=f".{output.name}-", dir=output.parent) as temporary:
        staging = Path(temporary) / "sources"
        staging.mkdir()
        for entry in pin["files"]:
            with (staging / entry["name"]).open("wb") as destination:
                if from_git is not None:
                    subprocess.run(
                        ["git", "-C", str(from_git), "show", f"{pin['commit']}:{entry['path']}"],
                        stdout=destination,
                        check=True,
                    )
                else:
                    with urllib.request.urlopen(entry["url"], timeout=120) as response:
                        shutil.copyfileobj(response, destination)
        verify(staging, pin)
        staging.rename(output)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("restore", "verify"))
    parser.add_argument("--output", type=Path, default=source_directory())
    parser.add_argument("--from-git", type=Path, help="Local clone containing the pinned commit")
    args = parser.parse_args()
    try:
        if args.command == "restore":
            restore(args.output, read_pin(), args.from_git)
        else:
            verify(args.output, read_pin())
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"Lexical source {args.command} failed: {error}\n")
    print(f"Verified {read_pin()['snapshot']} sources: {args.output}")


if __name__ == "__main__":
    main()
