#!/usr/bin/env python3
"""Synthetic delivery checks; no upstream data, repository history or network required."""

import io
import json
import shutil
import subprocess
import tarfile
from pathlib import Path

import pytest

from pipeline.release_utils import write_archive
from pipeline.tests import test_wals
from pipeline.wals import build, sources
from pipeline.wals import data_release as release

rows = test_wals.rows
COMMIT = "a" * 40


def prepare(root, rows, monkeypatch, *, tag="wals-fixture", commit=COMMIT):
    root.mkdir()
    raw = test_wals.fixture_directory(root / "raw", rows)
    pin = sources.read_pin()
    pin["snapshot"] = tag
    with tarfile.open(raw / "upstream.tar.gz", "w:gz") as archive:
        for entry in pin["files"]:
            archive.add(raw / entry["name"], arcname=f"{pin['archive']['prefix']}/{entry['name']}")
    pin["archive"].update(
        bytes=(raw / "upstream.tar.gz").stat().st_size,
        sha256=release.digest(raw / "upstream.tar.gz"),
    )
    for entry in pin["files"]:
        path = raw / entry["name"]
        entry.update(bytes=path.stat().st_size, sha256=release.digest(path))
    source_pin = root / "source-pin.json"
    release.write_json(source_pin, pin)
    monkeypatch.setattr(sources, "PIN", source_pin)
    data = root / "compiled"
    build.build(raw, data / "features.json")
    reference = release.pack(raw, data, root / "release", "owner/repo", tag, commit)
    return reference, raw, data


@pytest.fixture
def package(tmp_path, monkeypatch, rows):
    return prepare(tmp_path / "first", rows, monkeypatch)


def test_reproducible_archives_and_full_independent_source_recovery(package, tmp_path):
    reference, raw, data = package
    second = release.pack(raw, data, tmp_path / "second", "owner/repo", "wals-fixture", COMMIT)
    assert reference.read_bytes() == second.read_bytes()
    pin = release.read_pin(reference)
    for kind, asset in pin["assets"].items():
        assert (reference.parent / asset["name"]).read_bytes() == (
            second.parent / asset["name"]
        ).read_bytes()
        output = tmp_path / kind
        release.install(reference.parent / asset["name"], reference, output, kind)
        release.verify(output, pin, kind)
        release.install(reference.parent / asset["name"], reference, output, kind)
    assert set(release.inventory(tmp_path / "browser")) == release.BROWSER_FILES
    assert not (tmp_path / "browser/cldf").exists()
    source_pin = release.read_json(tmp_path / "sources/sources.json")
    sources.restore(
        tmp_path / "recovered", source_pin, archive=tmp_path / "sources/upstream.tar.gz"
    )
    assert build.compile_data(tmp_path / "recovered") == build.compile_data(raw)
    assert (tmp_path / "browser/features.json").read_bytes() == (
        data / "features.json"
    ).read_bytes()


def test_stale_build_or_missing_source_fails_before_release_output(package, tmp_path):
    _, raw, data = package
    (data / "features.json").write_text("{}")
    with pytest.raises(ValueError, match="differs"):
        release.pack(raw, data, tmp_path / "stale", "owner/repo", "fixture", COMMIT)
    assert not (tmp_path / "stale").exists()
    (raw / "upstream.tar.gz").unlink()
    with pytest.raises(ValueError, match="missing or checksum"):
        release.pack(raw, data, tmp_path / "missing", "owner/repo", "fixture", COMMIT)
    assert not (tmp_path / "missing").exists()


@pytest.mark.parametrize("kind", ["browser", "sources"])
def test_corrupt_or_missing_archive_preserves_existing_data(package, tmp_path, kind):
    reference, _, _ = package
    archive = reference.parent / release.ASSETS[kind]
    existing = tmp_path / "existing"
    existing.mkdir()
    (existing / "working").write_text("keep")
    archive.write_bytes(archive.read_bytes()[:-10])
    for destination in (existing, tmp_path / "absent"):
        with pytest.raises(ValueError, match="checksum/size"):
            release.install(archive, reference, destination, kind)
    archive.unlink()
    with pytest.raises(FileNotFoundError):
        release.install(archive, reference, tmp_path / "absent", kind)
    assert not (tmp_path / "absent").exists()
    assert (existing / "working").read_text() == "keep"


@pytest.mark.parametrize(
    "fault", ["traversal", "symlink", "hardlink", "duplicate", "extra", "missing", "content"]
)
def test_unsafe_or_incomplete_archives_fail_before_install(package, tmp_path, fault):
    reference, _, _ = package
    pin = release.read_pin(reference)
    archive = reference.parent / release.ASSETS["browser"]
    with tarfile.open(archive) as bundle:
        members = [(m, bundle.extractfile(m).read()) for m in bundle.getmembers()]
    with tarfile.open(archive, "w:gz") as bundle:
        for member, body in members:
            if fault == "missing" and member.name == "NOTICE.md":
                continue
            if fault == "content" and member.name == "NOTICE.md":
                body = b"x" * len(body)
            bundle.addfile(member, io.BytesIO(body))
        if fault in {"traversal", "symlink", "hardlink", "duplicate", "extra"}:
            member = tarfile.TarInfo(
                {"traversal": "../escape", "duplicate": "NOTICE.md"}.get(fault, "extra")
            )
            if fault in {"symlink", "hardlink"}:
                member.type = tarfile.SYMTYPE if fault == "symlink" else tarfile.LNKTYPE
                member.linkname = "/tmp/escape"
            bundle.addfile(member, io.BytesIO())
    pin["assets"]["browser"].update(bytes=archive.stat().st_size, sha256=release.digest(archive))
    release.write_json(reference, pin)
    with pytest.raises(ValueError):
        release.install(archive, reference, tmp_path / "invalid")
    assert not (tmp_path / "invalid").exists()


@pytest.mark.parametrize(
    "field",
    [
        "schemaVersion",
        "walsSchemaVersion",
        "adapterVersion",
        "pipelineCommit",
        "sourceCommit",
        "tag",
        "repository",
    ],
)
def test_incompatible_or_invalid_pins_fail_clearly(package, field):
    reference, _, _ = package
    pin = release.read_pin(reference)
    pin[field] = 999 if field.endswith("Version") else "bad/value/!"
    release.write_json(reference, pin)
    with pytest.raises(ValueError, match="Unsupported|Invalid"):
        release.read_pin(reference)


def test_duplicate_json_and_noncanonical_inventory_paths_are_rejected(package):
    reference, _, _ = package
    text = reference.read_text()
    reference.write_text(
        text.replace('"schemaVersion": 1', '"schemaVersion": 1, "schemaVersion": 1')
    )
    with pytest.raises(ValueError, match="Duplicate JSON"):
        release.read_pin(reference)
    pin = json.loads(text)
    for name in ("../escape", "/absolute", "cldf//ambiguous"):
        pin["assets"]["sources"]["files"][name] = {"bytes": 0, "sha256": "0" * 64}
        release.write_json(reference, pin)
        with pytest.raises(ValueError, match="path"):
            release.read_pin(reference)
        del pin["assets"]["sources"]["files"][name]


def test_modified_or_linked_existing_installation_is_preserved_without_download(
    package, tmp_path, monkeypatch
):
    reference, _, _ = package
    destination = tmp_path / "installed"
    release.install(reference.parent / release.ASSETS["browser"], reference, destination)
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: pytest.fail("must not download"))
    (destination / "NOTICE.md").write_text("local changes")
    with pytest.raises(ValueError, match="checksum/size/set"):
        release.restore(reference, destination)
    assert (destination / "NOTICE.md").read_text() == "local changes"
    linked = tmp_path / "linked"
    linked.symlink_to(destination, target_is_directory=True)
    with pytest.raises(ValueError, match="linked"):
        release.restore(reference, linked)


@pytest.mark.parametrize(
    "fault",
    [
        "manifest-schema",
        "adapter",
        "producer",
        "source-commit",
        "provenance",
        "counts",
        "notice",
        "license",
    ],
)
def test_matching_hashes_do_not_bypass_manifest_and_provenance_contract(package, tmp_path, fault):
    reference, _, _ = package
    pin = release.read_pin(reference)
    root = tmp_path / "candidate"
    archive = reference.parent / release.ASSETS["browser"]
    release.install(archive, reference, root)
    manifest = release.read_json(root / "manifest.json")
    data = release.read_json(root / "features.json")
    if fault == "manifest-schema":
        manifest["walsSchemaVersion"] = 999
    elif fault == "adapter":
        data["adapterVersion"] = 999
    elif fault == "producer":
        manifest["pipelineCommit"] = "b" * 40
    elif fault == "source-commit":
        data["provenance"]["commit"] = "b" * 40
    elif fault == "provenance":
        data["provenance"]["files"]["LICENSE"]["sha256"] = "0" * 64
        manifest["provenance"] = data["provenance"]
    elif fault == "counts":
        manifest["counts"]["observations"] += 1
    elif fault == "notice":
        (root / "NOTICE.md").write_text("changed")
    else:
        (root / "LICENSE").write_text("changed")
    release.write_json(root / "features.json", data)
    manifest["files"] = {k: v for k, v in release.inventory(root).items() if k != "manifest.json"}
    release.write_json(root / "manifest.json", manifest)
    write_archive(root, list(release.inventory(root)), archive)
    pin["assets"]["browser"].update(
        bytes=archive.stat().st_size, sha256=release.digest(archive), files=release.inventory(root)
    )
    release.write_json(reference, pin)
    with pytest.raises(ValueError, match="schema|inputs|counts|notice"):
        release.install(archive, reference, tmp_path / "invalid")
    assert not (tmp_path / "invalid").exists()


def test_restore_only_downloads_the_exact_selected_asset_and_never_compiles(
    package, tmp_path, monkeypatch
):
    reference, _, _ = package
    commands = []

    def download(command, **kwargs):
        commands.append(command)
        assert command[:4] == ["gh", "release", "download", "wals-fixture"]
        assert command[command.index("--repo") + 1] == "owner/repo"
        asset = command[command.index("--pattern") + 1]
        shutil.copyfile(reference.parent / asset, Path(command[-1]) / asset)

    monkeypatch.setattr(subprocess, "run", download)
    monkeypatch.setattr(
        build, "compile_data", lambda *a, **k: pytest.fail("restore must not compile")
    )
    release.restore(reference, tmp_path / "installed")
    release.restore(reference, tmp_path / "installed")
    assert len(commands) == 1
    assert commands[0][commands[0].index("--pattern") + 1] == "wals-browser.tar.gz"


def test_interrupted_download_and_atomic_install_failure_leave_no_partial_install(
    package, tmp_path, monkeypatch
):
    reference, _, _ = package

    def interrupted(command, **kwargs):
        (Path(command[-1]) / release.ASSETS["browser"]).write_bytes(b"partial")
        raise subprocess.CalledProcessError(1, command)

    monkeypatch.setattr(subprocess, "run", interrupted)
    with pytest.raises(subprocess.CalledProcessError):
        release.restore(reference, tmp_path / "installed")
    assert not (tmp_path / "installed").exists()
    monkeypatch.setattr(
        Path, "rename", lambda *a, **k: (_ for _ in ()).throw(OSError("replace failed"))
    )
    with pytest.raises(OSError, match="replace failed"):
        release.install(
            reference.parent / release.ASSETS["browser"], reference, tmp_path / "installed"
        )
    assert not (tmp_path / "installed").exists()
    assert not list(tmp_path.glob(".installed-*"))


@pytest.mark.parametrize("fail_at", [None, "create", "edit"])
def test_publication_selects_pin_only_after_both_assets_are_published(
    package, tmp_path, monkeypatch, fail_at
):
    reference, _, _ = package
    selected = tmp_path / "selected.json"
    selected.write_text('{"old":true}')
    commands = []

    def run(command, **kwargs):
        assert json.loads(selected.read_text()) == {"old": True}
        if command[1] == "api":
            return subprocess.CompletedProcess(command, 0, stdout="[]")
        commands.append(command)
        if command[2] == fail_at:
            raise subprocess.CalledProcessError(1, command)

    monkeypatch.setattr(subprocess, "run", run)
    if fail_at:
        with pytest.raises(subprocess.CalledProcessError):
            release.publish(reference, selected)
        assert selected.read_text() == '{"old":true}'
    else:
        release.publish(reference, selected)
        assert selected.read_bytes() == reference.read_bytes()
        assert all(str(reference.parent / a) in commands[0] for a in release.ASSETS.values())
        assert "--draft" in commands[0] and "--draft=false" in commands[1]
        assert all("--latest=false" in command for command in commands)


def test_publication_rejects_existing_tags_before_external_writes(package, tmp_path, monkeypatch):
    reference, _, _ = package

    def run(command, **kwargs):
        assert command[1] == "api"
        return subprocess.CompletedProcess(command, 0, stdout='[{"ref":"refs/tags/wals-fixture"}]')

    monkeypatch.setattr(subprocess, "run", run)
    with pytest.raises(ValueError, match="unused tag"):
        release.publish(reference, tmp_path / "selected.json")
    assert not (tmp_path / "selected.json").exists()


def test_rollback_to_retained_pin_uses_a_fresh_directory_and_preserves_newer_install(
    package, tmp_path, monkeypatch, rows
):
    old, _, _ = package
    rows["values"][0]["Comment"] = "Different evidence in a later fixture snapshot"
    newer, _, _ = prepare(
        tmp_path / "newer", rows, monkeypatch, tag="wals-fixture-v2", commit="b" * 40
    )
    installed = tmp_path / "current"
    release.install(newer.parent / release.ASSETS["browser"], newer, installed)
    newer_bytes = (installed / "features.json").read_bytes()
    with pytest.raises(ValueError, match="checksum/size/set"):
        release.install(old.parent / release.ASSETS["browser"], old, installed)
    assert (installed / "features.json").read_bytes() == newer_bytes
    rollback = tmp_path / "rollback"
    release.install(old.parent / release.ASSETS["browser"], old, rollback)
    release.verify(rollback, release.read_pin(old))
    assert (rollback / "features.json").read_bytes() != newer_bytes
