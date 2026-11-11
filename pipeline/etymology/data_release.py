#!/usr/bin/env python3
"""Package and restore independently pinned lexical browser data and raw sources."""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import tarfile
import tempfile
from pathlib import Path

from pipeline.etymology import build, sources
from pipeline.release_utils import digest, extract_archive, local_path, write_archive

ROOT = sources.ROOT
PIN = ROOT / "etymology-release.json"
DATA = ROOT / "app/public/etymology"
NOTICE = ROOT / "app/public/licenses/DIACL-LEXICAL-NOTICE.md"
ASSETS = {"browser": "word-trails.tar.gz", "sources": "word-trails-sources.tar.gz"}


def read_json(path: Path) -> dict:
    # Reject duplicate JSON keys just as the source adapter does.
    return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=build.unique_object)


def write_json(path: Path, value: dict) -> None:
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )


def inventory(root: Path) -> dict:
    return {
        p.relative_to(root).as_posix(): {"bytes": p.stat().st_size, "sha256": digest(p)}
        for p in sorted(root.rglob("*"))
        if p.is_file()
    }


def read_pin(reference: Path) -> dict:
    pin = read_json(reference)
    if (
        pin.get("schemaVersion") != 1
        or pin.get("lexicalSchemaVersion") != 1
        or pin.get("adapterVersion") != 1
    ):
        raise ValueError("Unsupported lexical release/schema/adapter version")
    if not re.fullmatch(r"[\w.-]+/[\w.-]+", pin.get("repository", "")):
        raise ValueError("Invalid release repository")
    if not re.fullmatch(r"[\w.-]+", pin.get("tag", "")):
        raise ValueError("Invalid release tag")
    if not re.fullmatch(r"[a-f0-9]{40}", pin.get("pipelineCommit", "")):
        raise ValueError("A full producer commit is required")
    if not isinstance(pin.get("snapshot"), str):
        raise TypeError("A pinned lexical snapshot is required")
    if set(pin["assets"]) != set(ASSETS):
        raise ValueError("Lexical release must contain browser and source archives")
    for kind, name in ASSETS.items():
        asset = pin["assets"][kind]
        if asset["name"] != name or not re.fullmatch(r"[a-f0-9]{64}", asset["sha256"]):
            raise ValueError("Invalid lexical release asset")
        if type(asset["bytes"]) is not int or asset["bytes"] <= 0:
            raise ValueError("Invalid archive size")
        for path, entry in asset["files"].items():
            local_path(Path("/tmp/lexical-release-validation"), path)
            if (
                type(entry["bytes"]) is not int
                or entry["bytes"] < 0
                or not re.fullmatch(r"[a-f0-9]{64}", entry["sha256"])
            ):
                raise ValueError("Invalid file inventory")
    return pin


def verify(root: Path, pin: dict, kind: str = "browser") -> None:
    if inventory(root) != pin["assets"][kind]["files"]:
        raise ValueError(f"Lexical {kind} file checksum/size/set mismatch: {root}")
    source_pin = read_json(root / "sources.json")
    if source_pin["snapshot"] != pin["snapshot"]:
        raise ValueError("Source snapshot disagrees with lexical release")
    if kind == "sources":
        sources.verify(root, source_pin)
        return
    manifest = read_json(root / "manifest.json")
    data = read_json(root / "word-trails.json")
    if (
        manifest["schemaVersion"] != 1
        or manifest["lexicalSchemaVersion"] != pin["lexicalSchemaVersion"]
        or data["schemaVersion"] != pin["lexicalSchemaVersion"]
        or data["provenance"]["adapterVersion"] != pin["adapterVersion"]
        or manifest["provenance"] != data["provenance"]
        or data["provenance"]["snapshot"] != pin["snapshot"]
    ):
        raise ValueError("Lexical manifest schema/provenance mismatch")
    expected_inputs = {p["name"]: p["sha256"] for p in source_pin["files"]}
    if {p["name"]: p["sha256"] for p in data["provenance"]["inputs"]} != expected_inputs:
        raise ValueError("Compiled lexical sources disagree with source pin")
    if manifest["files"] != {k: v for k, v in inventory(root).items() if k != "manifest.json"}:
        raise ValueError("Lexical manifest contents mismatch")
    if manifest["counts"] != counts(data):
        raise ValueError("Lexical manifest counts mismatch")
    # The release pin authenticates exact compiled bytes. The browser/CI additionally
    # validates all runtime field types and joins before indexing these bytes.


def counts(data: dict) -> dict:
    return {
        name: len(data[key])
        for name, key in (
            ("words", "lexemes"),
            ("relationships", "edges"),
            ("languages", "languages"),
            ("concepts", "concepts"),
            ("collections", "lists"),
            ("sources", "sources"),
        )
    }


def pack(
    source_dir: Path, data_dir: Path, output: Path, repository: str, tag: str, commit: str
) -> Path:
    if not re.fullmatch(r"[a-f0-9]{40}", commit):
        raise ValueError("--pipeline-commit must be the full producer commit")
    if output.exists():
        raise ValueError(f"Choose a new release directory: {output}")
    source_pin = sources.read_pin()
    # Reproduction is a packaging operation, never a deployment or npm hook.
    compiled = build.build(source_dir)
    contents = (
        json.dumps(
            compiled, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
        )
        + "\n"
    ).encode()
    if (data_dir / "word-trails.json").read_bytes() != contents:
        raise ValueError("Installed lexical bundle differs from the pinned source build")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=output.parent) as temporary:
        staging = Path(temporary)
        release = staging / "release"
        release.mkdir()
        browser = staging / "browser"
        raw = staging / "sources"
        browser.mkdir()
        raw.mkdir()
        (browser / "word-trails.json").write_bytes(contents)
        for root in (browser, raw):
            shutil.copyfile(NOTICE, root / "NOTICE.md")
            shutil.copyfile(sources.PIN, root / "sources.json")
        for entry in source_pin["files"]:
            shutil.copyfile(source_dir / entry["name"], raw / entry["name"])
        manifest = {
            "schemaVersion": 1,
            "lexicalSchemaVersion": build.SCHEMA_VERSION,
            "provenance": compiled["provenance"],
            "counts": counts(compiled),
            "files": inventory(browser),
        }
        write_json(browser / "manifest.json", manifest)
        pin = {
            "schemaVersion": 1,
            "lexicalSchemaVersion": build.SCHEMA_VERSION,
            "adapterVersion": build.ADAPTER_VERSION,
            "snapshot": source_pin["snapshot"],
            "repository": repository,
            "tag": tag,
            "pipelineCommit": commit,
            "assets": {},
        }
        for kind, root in (("browser", browser), ("sources", raw)):
            name = ASSETS[kind]
            write_archive(root, list(inventory(root)), release / name)
            pin["assets"][kind] = {
                "name": name,
                "bytes": (release / name).stat().st_size,
                "sha256": digest(release / name),
                "files": inventory(root),
            }
        reference = release / PIN.name
        write_json(reference, pin)
        read_pin(reference)
        verify(browser, pin)
        verify(raw, pin, "sources")
        release.rename(output)
    return output / PIN.name


def install(archive: Path, reference: Path, destination: Path, kind: str = "browser") -> None:
    pin = read_pin(reference)
    asset = pin["assets"][kind]
    if archive.stat().st_size != asset["bytes"] or digest(archive) != asset["sha256"]:
        raise ValueError("Lexical archive checksum/size mismatch")
    if destination.exists():
        # Idempotent only for the exact pin; preserve modified/older installations.
        verify(destination, pin, kind)
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(
        prefix=f".{destination.name}-", dir=destination.parent
    ) as temporary:
        staging = Path(temporary) / "data"
        staging.mkdir()
        extract_archive(archive, staging, asset["files"])
        verify(staging, pin, kind)
        staging.rename(destination)


def restore(reference: Path, destination: Path, kind: str = "browser") -> None:
    pin = read_pin(reference)
    if destination.exists():
        verify(destination, pin, kind)
        return
    asset = pin["assets"][kind]["name"]
    with tempfile.TemporaryDirectory() as temporary:
        subprocess.run(
            [
                "gh",
                "release",
                "download",
                pin["tag"],
                "--repo",
                pin["repository"],
                "--pattern",
                asset,
                "--dir",
                temporary,
            ],
            check=True,
        )
        install(Path(temporary) / asset, reference, destination, kind)


def publish(reference: Path, destination: Path) -> None:
    pin = read_pin(reference)
    # Verify both archives completely before any external write.
    with tempfile.TemporaryDirectory() as temporary:
        for kind, asset in pin["assets"].items():
            install(reference.parent / asset["name"], reference, Path(temporary) / kind, kind)
        notes = Path(temporary) / "notes.md"
        notes.write_text(
            f"Independent lexical data: {pin['snapshot']}.\n\nProducer: `{pin['pipelineCommit']}`.\n\n"
            + NOTICE.read_text(encoding="utf-8")
            + "\n\n"
            + "\n".join(f"{v['name']}: SHA-256 `{v['sha256']}`" for v in pin["assets"].values()),
            encoding="utf-8",
        )
        subprocess.run(
            [
                "gh",
                "release",
                "create",
                pin["tag"],
                *[str(reference.parent / a["name"]) for a in pin["assets"].values()],
                str(reference),
                "--repo",
                pin["repository"],
                "--target",
                pin["pipelineCommit"],
                "--title",
                f"Word Trails data: {pin['tag']}",
                "--notes-file",
                str(notes),
                "--draft",
                "--latest=false",
            ],
            check=True,
        )
    subprocess.run(
        [
            "gh",
            "release",
            "edit",
            pin["tag"],
            "--repo",
            pin["repository"],
            "--draft=false",
            "--latest=false",
        ],
        check=True,
    )
    if reference.resolve() != destination.resolve():
        with tempfile.NamedTemporaryFile(dir=destination.parent, delete=False) as stream:
            temporary_pin = Path(stream.name)
        try:
            shutil.copyfile(reference, temporary_pin)
            temporary_pin.replace(destination)
        finally:
            temporary_pin.unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    package = commands.add_parser("pack")
    package.add_argument("--source-dir", type=Path, default=sources.source_directory())
    package.add_argument("--data", type=Path, default=DATA)
    package.add_argument("--output", type=Path, required=True)
    package.add_argument("--repository", default="maximemulder/lang-viz")
    package.add_argument("--tag", required=True)
    package.add_argument("--pipeline-commit", required=True)
    for name in ("restore", "install", "verify"):
        command = commands.add_parser(name)
        command.add_argument("--pin", type=Path, default=PIN)
        command.add_argument("--kind", choices=ASSETS, default="browser")
        command.add_argument(
            "--output", type=Path, help="Defaults to browser or raw source directory"
        )
        if name == "install":
            command.add_argument("archive", type=Path)
    publication = commands.add_parser("publish")
    publication.add_argument("reference", type=Path)
    publication.add_argument("--pin", type=Path, default=PIN)
    args = parser.parse_args()
    try:
        if args.command == "pack":
            print(
                pack(
                    args.source_dir,
                    args.data,
                    args.output,
                    args.repository,
                    args.tag,
                    args.pipeline_commit,
                )
            )
        elif args.command == "publish":
            publish(args.reference, args.pin)
        else:
            destination = args.output or (
                DATA if args.kind == "browser" else sources.source_directory()
            )
            if args.command == "restore":
                restore(args.pin, destination, args.kind)
            elif args.command == "install":
                install(args.archive, args.pin, destination, args.kind)
            else:
                verify(destination, read_pin(args.pin), args.kind)
            print(f"Verified lexical {args.kind}: {destination}")
    except (
        OSError,
        ValueError,
        KeyError,
        TypeError,
        EOFError,
        tarfile.TarError,
        subprocess.CalledProcessError,
    ) as error:
        parser.exit(1, f"Lexical release {args.command} failed: {error}\n")


if __name__ == "__main__":
    main()
