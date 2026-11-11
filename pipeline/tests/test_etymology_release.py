#!/usr/bin/env python3
"""Small release fixtures exercise packaging, install isolation, and failed delivery."""

import io
import json
import subprocess
import tarfile
from pathlib import Path

import pytest

from pipeline.etymology import build, sources
from pipeline.etymology import data_release as release
from pipeline.release_utils import write_archive
from pipeline.tests import test_etymology

lexical_inputs = test_etymology.inputs

COMMIT = "a" * 40


@pytest.fixture
def package(tmp_path, monkeypatch, lexical_inputs):
    inputs = lexical_inputs
    source = tmp_path / "raw"
    test_etymology.write_inputs(source, inputs)
    source_pin = sources.read_pin()
    source_pin["snapshot"] = "fixture"
    for entry, value in zip(source_pin["files"], inputs, strict=True):
        path = source / entry["name"]
        entry.update(
            bytes=path.stat().st_size,
            sha256=release.digest(path),
            exportedAt=value["MetaData"]["TimeStamp"],
            upstreamUrl=value["MetaData"].get("JsonUrl"),
        )
    # Both pinned exports require their declared URL to match.
    inputs[1]["MetaData"]["JsonUrl"] = "https://example.invalid/tree"
    test_etymology.write_inputs(source, inputs)
    source_pin["files"][1].update(
        bytes=(source / "language-tree.json").stat().st_size,
        sha256=release.digest(source / "language-tree.json"),
        upstreamUrl="https://example.invalid/tree",
    )
    source_reference = tmp_path / "sources.json"
    release.write_json(source_reference, source_pin)
    monkeypatch.setattr(sources, "PIN", source_reference)
    data = tmp_path / "compiled"
    build.publish(build.build(source), data / "word-trails.json")
    reference = release.pack(
        source, data, tmp_path / "release", "owner/repo", "lexical-fixture", COMMIT
    )
    return reference, source, data


def test_reproducible_archives_and_independent_source_recovery(package, tmp_path):
    reference, source, data = package
    second = release.pack(
        source, data, tmp_path / "second", "owner/repo", "lexical-fixture", COMMIT
    )
    assert reference.read_bytes() == second.read_bytes()
    pin = release.read_pin(reference)
    for kind, asset in pin["assets"].items():
        output = tmp_path / kind
        release.install(reference.parent / asset["name"], reference, output, kind)
        release.verify(output, pin, kind)
        release.install(reference.parent / asset["name"], reference, output, kind)
    assert (tmp_path / "browser/word-trails.json").read_bytes() == (
        data / "word-trails.json"
    ).read_bytes()
    assert not (tmp_path / "browser/lexical-database.json").exists()
    assert (tmp_path / "sources/lexical-database.json").read_bytes() == (
        source / "lexical-database.json"
    ).read_bytes()


def test_pack_rejects_stale_compilation_and_preserves_outputs(package, tmp_path):
    _, source, data = package
    (data / "word-trails.json").write_text("{}")
    with pytest.raises(ValueError, match="differs"):
        release.pack(source, data, tmp_path / "bad", "owner/repo", "lexical-fixture", COMMIT)
    assert not (tmp_path / "bad").exists()


@pytest.mark.parametrize("kind", ["browser", "sources"])
def test_corrupt_archive_never_replaces_existing_data(package, tmp_path, kind):
    reference, _, _ = package
    asset = release.read_pin(reference)["assets"][kind]
    archive = reference.parent / asset["name"]
    archive.write_bytes(archive.read_bytes()[:-10])
    existing = tmp_path / "existing"
    existing.mkdir()
    (existing / "working").write_bytes(b"keep")
    for destination in (tmp_path / "absent", existing):
        with pytest.raises(ValueError, match="checksum/size"):
            release.install(archive, reference, destination, kind)
    assert not (tmp_path / "absent").exists()
    assert (existing / "working").read_bytes() == b"keep"


@pytest.mark.parametrize(
    "fault", ["traversal", "symlink", "duplicate", "extra", "missing", "content"]
)
def test_invalid_archive_members_and_contents_fail_before_install(package, tmp_path, fault):
    reference, _, _ = package
    pin = release.read_pin(reference)
    archive = reference.parent / pin["assets"]["browser"]["name"]
    with tarfile.open(archive) as bundle:
        members = [(member, bundle.extractfile(member).read()) for member in bundle.getmembers()]
    with tarfile.open(archive, "w:gz") as bundle:
        for member, body in members:
            if fault == "missing" and member.name == "NOTICE.md":
                continue
            if fault == "content" and member.name == "NOTICE.md":
                body = b"x" * len(body)
            bundle.addfile(member, io.BytesIO(body))
        if fault in {"traversal", "symlink", "duplicate", "extra"}:
            member = tarfile.TarInfo(
                {"traversal": "../escape", "duplicate": "NOTICE.md"}.get(fault, "extra")
            )
            if fault == "symlink":
                member.type = tarfile.SYMTYPE
                member.linkname = "/tmp/escape"
            bundle.addfile(member, io.BytesIO())
    pin["assets"]["browser"].update(sha256=release.digest(archive), bytes=archive.stat().st_size)
    release.write_json(reference, pin)
    with pytest.raises(ValueError):
        release.install(archive, reference, tmp_path / "installed")
    assert not (tmp_path / "installed").exists()


@pytest.mark.parametrize("field", ["schemaVersion", "lexicalSchemaVersion", "adapterVersion"])
def test_incompatible_pins_fail_clearly(package, tmp_path, field):
    reference, _, _ = package
    pin = release.read_pin(reference)
    pin[field] = 999
    release.write_json(reference, pin)
    with pytest.raises(ValueError, match="Unsupported"):
        release.install(
            reference.parent / release.ASSETS["browser"], reference, tmp_path / "installed"
        )
    assert not (tmp_path / "installed").exists()


def test_modified_existing_install_is_preserved_and_not_downloaded(package, tmp_path, monkeypatch):
    reference, _, _ = package
    destination = tmp_path / "installed"
    release.install(reference.parent / release.ASSETS["browser"], reference, destination)
    (destination / "NOTICE.md").write_text("local changes")
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: pytest.fail("must not download"))
    with pytest.raises(ValueError, match="checksum/size/set"):
        release.restore(reference, destination)
    assert (destination / "NOTICE.md").read_text() == "local changes"


@pytest.mark.parametrize("fault", ["manifest-schema", "payload-schema", "provenance", "counts"])
def test_matching_hashes_do_not_bypass_manifest_contract(package, tmp_path, fault):
    reference, _, _ = package
    pin = release.read_pin(reference)
    staging = tmp_path / "candidate"
    archive = reference.parent / release.ASSETS["browser"]
    release.install(archive, reference, staging)
    manifest = release.read_json(staging / "manifest.json")
    data = release.read_json(staging / "word-trails.json")
    if fault == "manifest-schema":
        manifest["lexicalSchemaVersion"] = 999
    elif fault == "payload-schema":
        data["schemaVersion"] = 999
    elif fault == "provenance":
        data["provenance"]["inputs"][0]["sha256"] = "0" * 64
        manifest["provenance"] = data["provenance"]
    else:
        manifest["counts"]["words"] += 1
    release.write_json(staging / "word-trails.json", data)
    manifest["files"] = {
        k: v for k, v in release.inventory(staging).items() if k != "manifest.json"
    }
    release.write_json(staging / "manifest.json", manifest)
    write_archive(staging, list(release.inventory(staging)), archive)
    pin["assets"]["browser"].update(
        bytes=archive.stat().st_size,
        sha256=release.digest(archive),
        files=release.inventory(staging),
    )
    release.write_json(reference, pin)
    with pytest.raises(ValueError, match="schema|sources|counts"):
        release.install(archive, reference, tmp_path / "invalid")
    assert not (tmp_path / "invalid").exists()


def test_failed_download_never_installs_partial_data(package, tmp_path, monkeypatch):
    reference, _, _ = package

    def interrupted(command, **kwargs):
        (Path(command[-1]) / release.ASSETS["browser"]).write_bytes(b"partial")
        raise subprocess.CalledProcessError(1, command)

    monkeypatch.setattr(subprocess, "run", interrupted)
    with pytest.raises(subprocess.CalledProcessError):
        release.restore(reference, tmp_path / "installed")
    assert not (tmp_path / "installed").exists()


def test_restore_uses_exact_independent_pin(package, tmp_path, monkeypatch):
    reference, _, _ = package

    def download(command, **kwargs):
        assert command[:4] == ["gh", "release", "download", "lexical-fixture"]
        assert command[command.index("--repo") + 1] == "owner/repo"
        asset = command[command.index("--pattern") + 1]
        (Path(command[-1]) / asset).write_bytes((reference.parent / asset).read_bytes())

    monkeypatch.setattr(subprocess, "run", download)
    release.restore(reference, tmp_path / "installed")
    release.verify(tmp_path / "installed", release.read_pin(reference))


@pytest.mark.parametrize("fail", [False, True])
def test_publication_updates_selected_pin_only_after_both_assets_are_published(
    package, tmp_path, monkeypatch, fail
):
    reference, _, _ = package
    selected = tmp_path / "selected.json"
    selected.write_text('{"old":true}')
    commands = []

    def run(command, **kwargs):
        assert json.loads(selected.read_text()) == {"old": True}
        commands.append(command)
        if fail:
            raise subprocess.CalledProcessError(1, command)

    monkeypatch.setattr(subprocess, "run", run)
    if fail:
        with pytest.raises(subprocess.CalledProcessError):
            release.publish(reference, selected)
        assert json.loads(selected.read_text()) == {"old": True}
    else:
        release.publish(reference, selected)
        assert all(str(reference.parent / name) in commands[0] for name in release.ASSETS.values())
        assert "--draft" in commands[0] and "--draft=false" in commands[1]
        assert selected.read_bytes() == reference.read_bytes()
