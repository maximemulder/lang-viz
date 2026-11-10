#!/usr/bin/env python3
import io
import json
import subprocess
import tarfile
from pathlib import Path

import pytest

from pipeline.atlas import data_release as release

COMMIT = "a" * 40


def write(root, name, value):
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value))
    return path


@pytest.fixture
def data(tmp_path):
    root = tmp_path / "source"
    write(root, "languages.json", [{"id": "language"}])
    write(
        root,
        "geometry-index.json",
        [{"datasetId": "dataset", "temporalCoverage": {"viewId": "now"}}],
    )
    write(root, "geometry-variants.json", [{"detail": "kept for integration tests"}])
    write(root, "geometry-bounds.json", {})
    write(root, "geography-datasets.json", [])
    write(root, "provenance/dataset/now.json", {})
    write(root, "geometry/current.pmtiles", "profile archive")
    write(root, "geometry/current/report.json", {})
    write(root, "language-areas.pmtiles", "combined archive")
    write(root, "DLAC-NOTICE.md", "notice")
    write(root, "branches/current/signature/0-0-0.pbf", "branch")
    write(root, "parts/current/dataset/now/index.json", {"0": ["0-0"], "1": []})
    write(root, "parts/current/dataset/now/0-0-0.pbf", "part")
    write(
        root,
        "manifest.json",
        {
            "schemaVersion": 5,
            "languoidCount": 1,
            "geometryVariantCount": 1,
            "archive": "language-areas.pmtiles",
            "geometryIndex": "geometry-index.json",
            "geometryBounds": "geometry-bounds.json",
            "geometryProvenance": "provenance/",
            "geometryProfiles": [{"archive": "geometry/current.pmtiles"}],
            "geometryBuild": {"kind": "shared-coverage", "report": "geometry/current/report.json"},
            "branchCoverage": {
                "directory": "branches/current/",
                "maxZoom": 0,
                "signatures": ["signature"],
            },
            "coverageParts": {
                "directory": "parts/current/",
                "maxZoom": 1,
                "profiles": [
                    {
                        "id": "dataset/now",
                        "datasetId": "dataset",
                        "viewId": "now",
                        "tileIndex": "dataset/now/index.json",
                    }
                ],
            },
        },
    )
    return root


def package(data, output):
    return release.pack(data, output, "owner/repo", "data-test", COMMIT)


def test_audit_and_bundle_exclude_old_generations_without_removing_them(data, tmp_path):
    stale = [
        write(data, "geometry/old.pmtiles", "old archive"),
        write(data, "parts/current/dataset/now/index-old.json", {}),
        write(data, "parts/current/dataset/now/1-0-0.pbf", "unindexed tile"),
        write(data, "parts/old/dataset/now/0-0-0.pbf", "old generation"),
        write(data, "branches/old/signature/0-0-0.pbf", "old branch"),
        write(data, "manifest.parts.tmp", "interrupted write"),
    ]
    report = release.audit(data)
    assert report["excluded"]["files"] == len(stale)
    assert report["excluded"]["bytes"] == sum(path.stat().st_size for path in stale)
    reference = package(data, tmp_path / "bundle")
    pin = release.read_json(reference)
    assert pin["pipelineCommit"] == COMMIT
    with tarfile.open(reference.parent / pin["asset"]) as bundle:
        assert set(bundle.getnames()) == {
            path.relative_to(data).as_posix() for path in release.release_files(data)
        }
        assert "geometry-variants.json" in bundle.getnames()
    assert all(path.exists() for path in stale)


@pytest.mark.parametrize(
    "name",
    [
        "parts/current/dataset/now/index.json",
        "parts/current/dataset/now/0-0-0.pbf",
        "branches/current/signature/0-0-0.pbf",
        "geometry/current.pmtiles",
        "provenance/dataset/now.json",
    ],
)
def test_missing_active_assets_fail_packaging(data, tmp_path, name):
    (data / name).unlink()
    with pytest.raises(ValueError, match="Missing data file"):
        package(data, tmp_path / "bundle")
    assert not (tmp_path / "bundle").exists()


def test_prepared_palettes_follow_manifest_through_bundle_install(data, tmp_path):
    palette = "palettes/current.json"
    write(data, palette, {"colors": {"language": "#123456"}})
    write(data, "palettes/old.json", {"colors": {"language": "#abcdef"}})
    manifest = release.read_json(data / "manifest.json")
    manifest["preparedColors"] = {"profiles": [{"id": "dataset/now", "file": palette}]}
    write(data, "manifest.json", manifest)
    reference = package(data, tmp_path / "bundle")
    output = tmp_path / "installed"
    release.install(reference.parent / release.ASSET, reference, output)
    assert (output / palette).read_bytes() == (data / palette).read_bytes()
    assert not (output / "palettes/old.json").exists()
    (data / palette).unlink()
    with pytest.raises(ValueError, match="Missing data file: palettes/current.json"):
        release.release_files(data)


def test_missing_index_level_fails_instead_of_silently_reducing_coverage(data):
    write(data, "parts/current/dataset/now/index.json", {"0": ["0-0"]})
    with pytest.raises(ValueError, match="Incomplete coverage index"):
        release.release_files(data)


def test_missing_profile_fails_instead_of_silently_using_live_intersections(data):
    manifest = release.read_json(data / "manifest.json")
    manifest["coverageParts"]["profiles"] = []
    write(data, "manifest.json", manifest)
    with pytest.raises(ValueError, match="Missing prepared coverage profiles"):
        release.release_files(data)


def test_catalog_mismatch_fails(data):
    write(data, "languages.json", [])
    with pytest.raises(ValueError, match="Languoid catalog"):
        release.release_files(data)


def test_data_from_the_removed_pipeline_cannot_be_published(data):
    manifest = release.read_json(data / "manifest.json")
    del manifest["geometryBuild"]
    write(data, "manifest.json", manifest)
    with pytest.raises(ValueError, match="integrated shared-coverage pipeline"):
        release.release_files(data)


def test_bundle_is_reproducible_and_installs_all_active_assets(data, tmp_path):
    first = package(data, tmp_path / "first")
    for path in data.rglob("*"):
        if path.is_file():
            path.touch()
    second = package(data, tmp_path / "second")
    assert release.read_json(first) == release.read_json(second)
    destination = tmp_path / "restored"
    release.install(first.parent / release.ASSET, first, destination)
    for path in release.release_files(data):
        assert (destination / path.relative_to(data)).read_bytes() == path.read_bytes()
    with pytest.raises(ValueError, match="Destination must be empty"):
        release.install(first.parent / release.ASSET, first, destination)


def test_failed_checksum_never_installs_data(data, tmp_path):
    reference = package(data, tmp_path / "bundle")
    archive = reference.parent / release.ASSET
    with archive.open("ab") as stream:
        stream.write(b"corruption")
    with pytest.raises(ValueError, match="checksum"):
        release.install(archive, reference, tmp_path / "restored")
    assert not (tmp_path / "restored").exists()


@pytest.mark.parametrize("kind", ["traversal", "symlink", "extra"])
def test_invalid_bundles_are_rejected_before_publication(data, tmp_path, kind):
    reference = package(data, tmp_path / "bundle")
    archive = reference.parent / release.ASSET
    with tarfile.open(archive, "r:gz") as source:
        members = [(member, source.extractfile(member).read()) for member in source.getmembers()]
    with tarfile.open(archive, "w:gz") as bundle:
        for member, contents in members:
            bundle.addfile(member, io.BytesIO(contents))
        member = tarfile.TarInfo("../escape" if kind == "traversal" else "extra")
        if kind == "symlink":
            member.type = tarfile.SYMTYPE
            member.linkname = "/tmp/escape"
        bundle.addfile(member, io.BytesIO())
    pin = release.read_json(reference)
    pin["sha256"] = release.digest(archive)
    reference.write_text(json.dumps(pin))
    with pytest.raises(ValueError):
        release.install(archive, reference, tmp_path / "restored")
    assert not (tmp_path / "restored").exists()


def test_publish_updates_pin_only_after_release_is_public(data, tmp_path, monkeypatch):
    reference = package(data, tmp_path / "bundle")
    destination = write(tmp_path, "selected.json", {"old": True})
    commands = []

    def run(command, **kwargs):
        assert release.read_json(destination) == {"old": True}
        commands.append(command)

    monkeypatch.setattr(subprocess, "run", run)
    release.publish(reference, destination)
    assert commands[0][:4] == ["gh", "release", "create", "data-test"]
    assert "--draft" in commands[0]
    assert "--draft=false" in commands[1]
    assert release.read_json(destination) == release.read_json(reference)


def test_failed_upload_preserves_selected_release(data, tmp_path, monkeypatch):
    reference = package(data, tmp_path / "bundle")
    destination = write(tmp_path, "selected.json", {"old": True})

    def fail(command, **kwargs):
        raise subprocess.CalledProcessError(1, command)

    monkeypatch.setattr(subprocess, "run", fail)
    with pytest.raises(subprocess.CalledProcessError):
        release.publish(reference, destination)
    assert release.read_json(destination) == {"old": True}


def test_restore_downloads_the_pinned_release(data, tmp_path, monkeypatch):
    reference = package(data, tmp_path / "bundle")
    commands = []

    def download(command, **kwargs):
        commands.append(command)
        target = Path(command[command.index("--dir") + 1]) / release.ASSET
        target.write_bytes((reference.parent / release.ASSET).read_bytes())

    monkeypatch.setattr(subprocess, "run", download)
    release.restore(reference, tmp_path / "restored")
    assert commands[0][:4] == ["gh", "release", "download", "data-test"]
    assert commands[0][commands[0].index("--repo") + 1] == "owner/repo"
    assert (tmp_path / "restored/manifest.json").is_file()


def test_existing_outputs_can_explicitly_record_unknown_build_provenance(
    data, tmp_path, monkeypatch
):
    reference = release.pack(data, tmp_path / "bundle", "owner/repo", "data-test", "unknown")
    pin = release.read_json(reference)
    assert pin["pipelineCommit"] is None
    assert len(pin["packagedFromCommit"]) == 40
    commands = []

    def run(command, **kwargs):
        if "--notes-file" in command:
            notes = Path(command[command.index("--notes-file") + 1]).read_text()
            assert "exact pipeline build commit was not recorded" in notes
        commands.append(command)

    monkeypatch.setattr(subprocess, "run", run)
    release.publish(reference, tmp_path / "selected.json")
    assert commands[0][commands[0].index("--target") + 1] == pin["packagedFromCommit"]
