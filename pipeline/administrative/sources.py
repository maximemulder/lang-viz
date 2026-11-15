#!/usr/bin/env python3
"""Restore and verify pinned administrative source files outside Git."""

from __future__ import annotations

import argparse
import base64
import json
import os
import subprocess
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path

from pipeline.administrative.build import CATALOG, PIN, SOURCE, check_file


def read_pin() -> dict:
    return json.loads(PIN.read_text(encoding="utf-8"))


def joined_from_github(spec: dict, pin: dict) -> bytes:
    path = urllib.parse.quote(spec["path"], safe="/")
    url = (
        f"https://api.github.com/repos/{spec['repository']}/contents/{path}"
        f"?ref={pin['sourceBranchCommit']}"
    )
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "lang-viz-administrative-source",
    }
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    with urllib.request.urlopen(
        urllib.request.Request(url, headers=headers), timeout=120
    ) as response:
        payload = json.load(response)
    if payload.get("sha") != spec["blobSha"] or payload.get("encoding") != "base64":
        raise ValueError("Unexpected GitHub blob response for the pinned joined CSV")
    data = base64.b64decode("".join(payload["content"].split()), validate=True)
    if len(data) != spec["bytes"]:
        raise ValueError("Unexpected joined CSV byte count from GitHub")
    return data


def joined_from_local_git(repo: Path, spec: dict, pin: dict) -> bytes:
    result = subprocess.run(
        ["git", "-C", str(repo), "show", f"{pin['sourceBranchCommit']}:{spec['path']}"],
        capture_output=True,
        check=True,
    )
    if len(result.stdout) != spec["bytes"]:
        raise ValueError("Unexpected joined CSV byte count from local Git")
    return result.stdout


def restore_joined(output: Path, pin: dict, *, from_git: Path | None = None) -> None:
    spec = pin["joinedCsv"]
    if output.exists() or output.is_symlink():
        check_file(output, spec)
        return
    data = (
        joined_from_local_git(from_git, spec, pin)
        if from_git is not None
        else joined_from_github(spec, pin)
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=output.parent, prefix=".joined-", delete=False) as handle:
        staged = Path(handle.name)
        try:
            handle.write(data)
            handle.flush()
            check_file(staged, spec)
            staged.replace(output)
        finally:
            staged.unlink(missing_ok=True)


def restore_catalog(output: Path, pin: dict) -> None:
    spec = pin["glottolog"]
    if output.exists() or output.is_symlink():
        check_file(output, spec)
        return
    output.parent.mkdir(parents=True, exist_ok=True)
    url = f"{spec['repository'].replace('github.com', 'raw.githubusercontent.com')}/{spec['commit']}/{spec['path']}"
    with tempfile.NamedTemporaryFile(
        dir=output.parent, prefix=".languages-", delete=False
    ) as handle:
        staged = Path(handle.name)
        try:
            with urllib.request.urlopen(url, timeout=120) as response:
                remaining = spec["bytes"] + 1
                while remaining:
                    chunk = response.read(min(1024 * 1024, remaining))
                    if not chunk:
                        break
                    handle.write(chunk)
                    remaining -= len(chunk)
            handle.flush()
            check_file(staged, spec)
            staged.replace(output)
        finally:
            staged.unlink(missing_ok=True)


def verify(source: Path, catalog: Path, pin: dict) -> None:
    check_file(source, pin["joinedCsv"])
    check_file(catalog, pin["glottolog"])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("restore", "verify"))
    parser.add_argument("--source", type=Path, default=SOURCE)
    parser.add_argument("--catalog", type=Path, default=CATALOG)
    parser.add_argument("--from-git", type=Path, help="Read the joined CSV from a local checkout")
    args = parser.parse_args()
    pin = read_pin()
    try:
        if args.command == "restore":
            restore_joined(args.source, pin, from_git=args.from_git)
            restore_catalog(args.catalog, pin)
        verify(args.source, args.catalog, pin)
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"Administrative source {args.command} failed: {error}\n")
    print(f"Verified pinned administrative sources: {args.source}, {args.catalog}")


if __name__ == "__main__":
    main()
