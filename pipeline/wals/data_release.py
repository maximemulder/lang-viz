#!/usr/bin/env python3
"""Pack, publish and restore independent WALS browser and recoverable source releases."""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import tarfile
import tempfile
from pathlib import Path

from pipeline.release_utils import digest, extract_archive, local_path, write_archive
from pipeline.wals import build, sources

ROOT = sources.ROOT
PIN = ROOT / "wals-release.json"
DATA = ROOT / "app/public/wals"
NOTICE = Path(__file__).with_name("NOTICE.md")
ASSETS = {"browser": "wals-browser.tar.gz", "sources": "wals-sources.tar.gz"}
BROWSER_FILES = {
    "features.json",
    "manifest.json",
    "sources.json",
    "NOTICE.md",
    "LICENSE",
    "ERRATA.md",
}


def unique_object(pairs: list[tuple]) -> dict:
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=unique_object)


def write_json(path: Path, value: dict) -> None:
    path.write_text(
        json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8"
    )


def inventory(root: Path) -> dict:
    if root.is_symlink() or not root.is_dir():
        raise ValueError(f"Missing or linked WALS directory: {root}")
    result = {}
    for path in sorted(root.rglob("*")):
        if path.is_symlink() or not (path.is_dir() or path.is_file()):
            raise ValueError(f"Invalid WALS installation member: {path}")
        if path.is_file():
            result[path.relative_to(root).as_posix()] = {
                "bytes": path.stat().st_size,
                "sha256": digest(path),
            }
    return result


def read_pin(reference: Path) -> dict:
    pin = read_json(reference)
    if any(
        type(pin.get(field)) is not int or pin[field] != 1
        for field in ("schemaVersion", "walsSchemaVersion", "adapterVersion")
    ):
        raise ValueError("Unsupported WALS release/schema/adapter version")
    for field, pattern in (
        ("repository", r"[\w.-]+/[\w.-]+"),
        ("tag", r"[\w.-]+"),
        ("pipelineCommit", r"[a-f0-9]{40}"),
        ("sourceCommit", r"[a-f0-9]{40}"),
    ):
        if not isinstance(pin.get(field), str) or not re.fullmatch(pattern, pin[field]):
            raise ValueError(f"Invalid WALS release {field}")
    if not isinstance(pin.get("snapshot"), str) or not pin["snapshot"].strip():
        raise ValueError("A pinned WALS snapshot is required")
    if set(pin["assets"]) != set(ASSETS):
        raise ValueError("WALS release requires browser and source assets")
    for kind, name in ASSETS.items():
        asset = pin["assets"][kind]
        if asset["name"] != name or not re.fullmatch(r"[a-f0-9]{64}", asset["sha256"]):
            raise ValueError("Invalid WALS release asset")
        if type(asset["bytes"]) is not int or asset["bytes"] <= 0:
            raise ValueError("Invalid WALS archive size")
        files = asset["files"]
        if not isinstance(files, dict) or not files:
            raise ValueError("Missing WALS file inventory")
        if kind == "browser" and set(files) != BROWSER_FILES:
            raise ValueError("Invalid WALS browser file set")
        if kind == "sources" and not {
            "upstream.tar.gz",
            "sources.json",
            "NOTICE.md",
            "LICENSE",
            "ERRATA.md",
        } <= set(files):
            raise ValueError("Incomplete WALS source file set")
        validation_root = Path("/tmp/wals-release-path-validation")
        for name, entry in files.items():
            if local_path(validation_root, name).relative_to(validation_root).as_posix() != name:
                raise ValueError(f"Noncanonical WALS path: {name}")
            if (
                type(entry["bytes"]) is not int
                or entry["bytes"] < 0
                or not re.fullmatch(r"[a-f0-9]{64}", entry["sha256"])
            ):
                raise ValueError("Invalid WALS file inventory")
    return pin


def counts(data: dict) -> dict:
    return {
        name: len(data[name])
        for name in ("records", "features", "categories", "observations", "references", "examples")
    }


def verify(root: Path, pin: dict, kind: str = "browser") -> None:
    files = inventory(root)
    if files != pin["assets"][kind]["files"]:
        raise ValueError(f"WALS {kind} file checksum/size/set mismatch: {root}")
    source_pin = read_json(root / "sources.json")
    if (
        source_pin["schemaVersion"] != 1
        or source_pin["snapshot"] != pin["snapshot"]
        or source_pin["commit"] != pin["sourceCommit"]
    ):
        raise ValueError("WALS source snapshot/commit mismatch")
    inputs = {
        entry["name"]: {key: entry[key] for key in ("bytes", "sha256")}
        for entry in source_pin["files"]
    }
    if len(inputs) != len(source_pin["files"]):
        raise ValueError("Duplicate WALS source input")
    if kind == "sources":
        if set(files) != set(inputs) | {"upstream.tar.gz", "sources.json", "NOTICE.md"}:
            raise ValueError("WALS source archive file set disagrees with source pin")
        sources.verify(root, source_pin)
        return
    manifest = read_json(root / "manifest.json")
    data = read_json(root / "features.json")
    if (
        manifest["schemaVersion"] != 1
        or manifest["walsSchemaVersion"] != pin["walsSchemaVersion"]
        or manifest["adapterVersion"] != pin["adapterVersion"]
        or manifest["pipelineCommit"] != pin["pipelineCommit"]
        or data["schemaVersion"] != pin["walsSchemaVersion"]
        or data["adapterVersion"] != pin["adapterVersion"]
        or manifest["provenance"] != data["provenance"]
        or data["provenance"]["snapshot"] != pin["snapshot"]
        or data["provenance"]["commit"] != pin["sourceCommit"]
    ):
        raise ValueError("WALS manifest schema/producer/provenance mismatch")
    if data["provenance"]["files"] != inputs:
        raise ValueError("Compiled WALS inputs disagree with source pin")
    for name in ("LICENSE", "ERRATA.md"):
        if files[name] != inputs[name]:
            raise ValueError(f"WALS source notice mismatch: {name}")
    if (root / "NOTICE.md").read_text() != data["sourceNotices"]["notice"] or (
        root / "ERRATA.md"
    ).read_text() != data["sourceNotices"]["errata"]:
        raise ValueError("WALS compiled source notices mismatch")
    if manifest["files"] != {
        name: entry for name, entry in files.items() if name != "manifest.json"
    }:
        raise ValueError("WALS manifest inventory mismatch")
    if manifest["counts"] != counts(data) or manifest["diagnostics"] != data["diagnostics"]:
        raise ValueError("WALS manifest counts/diagnostics mismatch")
    # Exact byte authenticity is enforced here; browser/CI additionally validate all fields/joins.


def pack(
    source_dir: Path, data_dir: Path, output: Path, repository: str, tag: str, commit: str
) -> Path:
    if not re.fullmatch(r"[a-f0-9]{40}", commit):
        raise ValueError("--pipeline-commit must identify the full adapter producer commit")
    if output.exists():
        raise ValueError(f"Choose a new release directory: {output}")
    source_pin = sources.read_pin()
    # Recompile only for explicit packaging; never during installation or deployment.
    compiled = build.compile_data(source_dir)
    contents = (
        json.dumps(
            compiled, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
        )
        + "\n"
    ).encode()
    if (data_dir / "features.json").read_bytes() != contents:
        raise ValueError("Installed WALS bundle differs from pinned source build")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=output.parent) as temporary:
        staging = Path(temporary)
        release, browser, raw = (staging / name for name in ("release", "browser", "sources"))
        for path in (release, browser, raw):
            path.mkdir()
        (browser / "features.json").write_bytes(contents)
        for root in (browser, raw):
            shutil.copyfile(NOTICE, root / "NOTICE.md")
            shutil.copyfile(sources.PIN, root / "sources.json")
        for name in ("LICENSE", "ERRATA.md"):
            shutil.copyfile(source_dir / name, browser / name)
        for name in [entry["name"] for entry in source_pin["files"]] + ["upstream.tar.gz"]:
            destination = local_path(raw, name)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(local_path(source_dir, name), destination)
        write_json(
            browser / "manifest.json",
            {
                "schemaVersion": 1,
                "walsSchemaVersion": build.SCHEMA_VERSION,
                "adapterVersion": build.ADAPTER_VERSION,
                "pipelineCommit": commit,
                "provenance": compiled["provenance"],
                "counts": counts(compiled),
                "diagnostics": compiled["diagnostics"],
                "files": inventory(browser),
            },
        )
        pin = {
            "schemaVersion": 1,
            "walsSchemaVersion": build.SCHEMA_VERSION,
            "adapterVersion": build.ADAPTER_VERSION,
            "snapshot": source_pin["snapshot"],
            "sourceCommit": source_pin["commit"],
            "repository": repository,
            "tag": tag,
            "pipelineCommit": commit,
            "assets": {},
        }
        for kind, root in (("browser", browser), ("sources", raw)):
            archive = release / ASSETS[kind]
            files = inventory(root)
            write_archive(root, list(files), archive)
            pin["assets"][kind] = {
                "name": archive.name,
                "bytes": archive.stat().st_size,
                "sha256": digest(archive),
                "files": files,
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
    if (
        archive.is_symlink()
        or archive.stat().st_size != asset["bytes"]
        or digest(archive) != asset["sha256"]
    ):
        raise ValueError("WALS archive checksum/size mismatch")
    if destination.exists() or destination.is_symlink():
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
    if destination.exists() or destination.is_symlink():
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
    # Validate both complete assets before any external write. Never overwrite a release/tag.
    with tempfile.TemporaryDirectory() as temporary:
        for kind, asset in pin["assets"].items():
            install(reference.parent / asset["name"], reference, Path(temporary) / kind, kind)
        refs = subprocess.run(
            ["gh", "api", f"repos/{pin['repository']}/git/matching-refs/tags/{pin['tag']}"],
            check=True,
            capture_output=True,
            text=True,
        )
        if any(ref["ref"] == f"refs/tags/{pin['tag']}" for ref in json.loads(refs.stdout)):
            raise ValueError("WALS publication requires an unused tag")
        notes = Path(temporary) / "notes.md"
        notes.write_text(
            f"Independent WALS data: {pin['snapshot']}.\n\nAdapter producer: `{pin['pipelineCommit']}`.\n\n"
            f"Upstream source: `{pin['sourceCommit']}`.\n\n"
            + (Path(temporary) / "browser/NOTICE.md").read_text()
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
                f"WALS data: {pin['tag']}",
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
    # Only a successfully published release may become the selected pin.
    if reference.resolve() != destination.resolve():
        destination.parent.mkdir(parents=True, exist_ok=True)
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
        command.add_argument("--output", type=Path)
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
            print(f"Verified WALS {args.kind}: {destination}")
    except (
        OSError,
        ValueError,
        KeyError,
        TypeError,
        EOFError,
        tarfile.TarError,
        subprocess.CalledProcessError,
    ) as error:
        parser.exit(1, f"WALS release {args.command} failed: {error}\n")


if __name__ == "__main__":
    main()
