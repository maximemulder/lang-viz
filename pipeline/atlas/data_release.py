#!/usr/bin/env python3
"""Audit, package, publish, and restore prebuilt browser data (standard library only)."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import re
import shutil
import subprocess
import tarfile
import tempfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "app/public/data"
PIN = ROOT / "data-release.json"
ASSET = "atlas-data.tar.gz"


def read_json(path: Path):
    return json.loads(path.read_text())


def local_path(root: Path, name: str) -> Path:
    path = PurePosixPath(name)
    if not name or path.is_absolute() or ".." in path.parts or "\\" in name:
        raise ValueError(f"Invalid data path: {name}")
    result = root.joinpath(*path.parts)
    if not result.resolve().is_relative_to(root.resolve()):
        raise ValueError(f"Data path escapes its directory: {name}")
    return result


def release_files(root: Path) -> list[Path]:
    """Follow the active manifest and indexes, rather than globbing old generations."""
    files: set[Path] = set()

    def add(name: str) -> Path:
        path = local_path(root, name)
        if not path.is_file():
            raise ValueError(f"Missing data file: {name}")
        files.add(path)
        return path

    manifest = read_json(add("manifest.json"))
    if manifest.get("geometryBuild", {}).get("kind") != "shared-coverage":
        raise ValueError("Rebuild atlas data with the integrated shared-coverage pipeline")
    languages = read_json(add("languages.json"))
    variants = read_json(add(manifest.get("geometryIndex", "geometry-variants.json")))
    add("geography-datasets.json")
    if manifest["schemaVersion"] != 5:
        raise ValueError("Unsupported atlas schema")
    if len(languages) != manifest["languoidCount"]:
        raise ValueError("Languoid catalog does not match the manifest")
    if len(variants) != manifest["geometryVariantCount"]:
        raise ValueError("Geometry catalog does not match the manifest")
    # Keep the combined archive and detailed catalog for offline tools and integration tests.
    add(manifest["archive"])
    if (root / "geometry-variants.json").exists():
        add("geometry-variants.json")
    if manifest.get("geometryBounds"):
        add(manifest["geometryBounds"])
    if manifest.get("geometryBuild", {}).get("report"):
        add(manifest["geometryBuild"]["report"])
    for notice in root.glob("*.md"):
        add(notice.name)
    for profile in manifest.get("geometryProfiles", []):
        add(profile["archive"])
    profiles = {(v["datasetId"], v["temporalCoverage"]["viewId"]) for v in variants}
    if manifest.get("geometryProvenance"):
        for dataset, view in profiles:
            add(f"{manifest['geometryProvenance']}{dataset}/{view}.json")

    branches = manifest.get("branchCoverage")
    if not branches:
        raise ValueError("Run npm run precompute:branches before packaging data")
    for signature in branches["signatures"]:
        for z in range(branches["maxZoom"] + 1):
            for x in range(2**z):
                for y in range(2**z):
                    add(f"{branches['directory']}{signature}/{z}-{x}-{y}.pbf")

    parts = manifest.get("coverageParts")
    if not parts:
        raise ValueError("Run npm run precompute:parts before packaging data")
    prepared = {(p["datasetId"], p["viewId"]) for p in parts["profiles"]}
    if profiles - prepared:
        raise ValueError(f"Missing prepared coverage profiles: {sorted(profiles - prepared)}")
    for profile in parts["profiles"]:
        index = profile.get("tiles")
        if profile.get("tileIndex"):
            index = read_json(add(f"{parts['directory']}{profile['tileIndex']}"))
        if index is None:
            raise ValueError(f"Coverage profile has no tile index: {profile['id']}")
        for z in range(profile.get("maxZoom", parts["maxZoom"]) + 1):
            if str(z) not in index:
                raise ValueError(f"Incomplete coverage index: {profile['id']}, zoom {z}")
            for xy in index[str(z)]:
                if not re.fullmatch(r"\d+-\d+", xy):
                    raise ValueError(f"Invalid tile coordinate: {xy}")
                add(f"{parts['directory']}{profile['id']}/{z}-{xy}.pbf")
    return sorted(files, key=lambda path: path.relative_to(root).as_posix())


def audit(root: Path) -> dict:
    selected = set(release_files(root))
    all_files = {path for path in root.rglob("*") if path.is_file()}
    result = {}
    for label, paths in (("selected", selected), ("excluded", all_files - selected)):
        groups: dict[str, dict[str, int]] = {}
        for path in paths:
            key = path.relative_to(root).parts[0]
            group = groups.setdefault(key, {"files": 0, "bytes": 0})
            group["files"] += 1
            group["bytes"] += path.stat().st_size
        result[label] = {
            "files": len(paths),
            "bytes": sum(group["bytes"] for group in groups.values()),
            "groups": groups,
        }
    return result


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def pack(root: Path, output: Path, repository: str, tag: str, commit: str) -> Path:
    # Require an explicit producer commit: existing outputs may predate the current checkout.
    if commit != "unknown" and not re.fullmatch(r"[a-f0-9]{40}", commit):
        raise ValueError("--pipeline-commit must be a full commit or explicitly 'unknown'")
    files = release_files(root)
    print(f"Packing {len(files):,} active data files", flush=True)
    output.mkdir(parents=True, exist_ok=True)
    archive = output / ASSET
    temporary = output / f"{ASSET}.tmp"
    with (
        temporary.open("wb") as stream,
        gzip.GzipFile(filename="", fileobj=stream, mode="wb", mtime=0) as compressed,
        tarfile.open(fileobj=compressed, mode="w|", dereference=True) as bundle,
    ):
        for path in files:
            info = tarfile.TarInfo(path.relative_to(root).as_posix())
            info.size = path.stat().st_size
            info.mode = 0o644
            with path.open("rb") as source:
                bundle.addfile(info, source)
    if temporary.stat().st_size >= 2 * 1024**3:
        raise ValueError("Bundle exceeds GitHub's 2 GiB release asset limit")
    temporary.replace(archive)
    reference = output / PIN.name
    pin = {
        "repository": repository,
        "tag": tag,
        "asset": ASSET,
        "sha256": digest(archive),
        "pipelineCommit": None if commit == "unknown" else commit,
    }
    if commit == "unknown":
        pin["packagedFromCommit"] = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
        ).strip()
    reference.write_text(json.dumps(pin, indent=2) + "\n")
    return reference


def install(archive: Path, reference: Path, destination: Path) -> None:
    pin = read_json(reference)
    if digest(archive) != pin["sha256"]:
        raise ValueError("Data bundle checksum does not match data-release.json")
    if destination.exists() and any(destination.iterdir()):
        raise ValueError(f"Destination must be empty: {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=destination.parent) as temporary:
        staging = Path(temporary) / "data"
        staging.mkdir()
        with tarfile.open(archive, "r:gz") as bundle:
            members = bundle.getmembers()
            print(f"Installing {len(members):,} data files", flush=True)
            names = set()
            for member in members:
                local_path(staging, member.name)
                if not member.isfile() or member.name in names:
                    raise ValueError(f"Invalid bundle member: {member.name}")
                names.add(member.name)
            bundle.extractall(staging, members=members, filter="data")
        print("Verifying extracted data against its manifest", flush=True)
        expected = {path.relative_to(staging).as_posix() for path in release_files(staging)}
        if names != expected:
            raise ValueError("Data bundle contains files outside its active manifest")
        if destination.exists():
            destination.rmdir()
        staging.rename(destination)
    print(f"Restored verified data to {destination}", flush=True)


def restore(reference: Path, destination: Path) -> None:
    pin = read_json(reference)
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
                pin["asset"],
                "--dir",
                temporary,
            ],
            check=True,
        )
        install(local_path(Path(temporary), pin["asset"]), reference, destination)


def publish(reference: Path, destination: Path) -> None:
    pin = read_json(reference)
    archive = local_path(reference.parent, pin["asset"])
    if digest(archive) != pin["sha256"]:
        raise ValueError("Data bundle checksum does not match data-release.json")
    with tempfile.TemporaryDirectory() as temporary:
        notes = Path(temporary) / "notes.md"
        provenance = (
            f"Pipeline commit: `{pin['pipelineCommit']}`"
            if pin["pipelineCommit"]
            else "Existing prepared data; the exact pipeline build commit was not recorded.\n\n"
            f"Packaging checkout: `{pin['packagedFromCommit']}`"
        )
        notes.write_text(
            f"Prebuilt atlas browser data.\n\n{provenance}\n\nBundle SHA-256: `{pin['sha256']}`\n"
        )
        subprocess.run(
            [
                "gh",
                "release",
                "create",
                pin["tag"],
                str(archive),
                str(reference),
                "--repo",
                pin["repository"],
                "--target",
                pin["pipelineCommit"] or pin["packagedFromCommit"],
                "--title",
                f"Atlas data: {pin['tag']}",
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
        shutil.copyfile(reference, destination)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    inspection = commands.add_parser("audit", help="Report active and excluded data sizes")
    inspection.add_argument("--data", type=Path, default=DATA)
    package = commands.add_parser("pack", help="Package the current prepared data")
    package.add_argument("--data", type=Path, default=DATA)
    package.add_argument("--output", type=Path, required=True)
    package.add_argument("--repository", default="maximemulder/lang-viz")
    package.add_argument("--tag", required=True)
    package.add_argument("--pipeline-commit", required=True)
    publication = commands.add_parser("publish", help="Publish a bundle, then update the pin")
    publication.add_argument("reference", type=Path)
    publication.add_argument("--pin", type=Path, default=PIN)
    restoration = commands.add_parser("restore", help="Download and verify the pinned release")
    restoration.add_argument("--pin", type=Path, default=PIN)
    restoration.add_argument("--output", type=Path, default=DATA)
    extraction = commands.add_parser("install", help="Verify and install a local bundle")
    extraction.add_argument("archive", type=Path)
    extraction.add_argument("--pin", type=Path, required=True)
    extraction.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.command == "audit":
        print(json.dumps(audit(args.data), indent=2, sort_keys=True))
    elif args.command == "pack":
        print(pack(args.data, args.output, args.repository, args.tag, args.pipeline_commit))
    elif args.command == "publish":
        publish(args.reference, args.pin)
    elif args.command == "restore":
        if not args.pin.is_file():
            parser.error("No data-release.json; publish and pin a data release before deploying")
        restore(args.pin, args.output)
    else:
        install(args.archive, args.pin, args.output)


if __name__ == "__main__":
    main()
