#!/usr/bin/env python3
import os
import subprocess
from pathlib import Path


def test_fetch_adds_new_sparse_paths_at_the_same_revision(tmp_path):
    origin = tmp_path / "origin"
    origin.mkdir()

    def git(*args, cwd=origin):
        return subprocess.check_output(["git", *args], cwd=cwd, text=True).strip()

    git("init", "--quiet")
    (origin / "cldf").mkdir()
    (origin / "cldf/languages.csv").write_text("ID,Name\n")
    (origin / "cldf/names.csv").write_text("Language_ID,Name\n")
    git("add", "cldf")
    git(
        "-c",
        "user.name=Atlas test",
        "-c",
        "user.email=atlas@example.invalid",
        "commit",
        "--quiet",
        "-m",
        "fixture",
    )
    revision = git("rev-parse", "HEAD")
    checkout = tmp_path / "workspace/datasets/example"
    git("clone", "--quiet", "--no-checkout", str(origin), str(checkout))
    git("sparse-checkout", "set", "--no-cone", "cldf/languages.csv", cwd=checkout)
    git("checkout", "--quiet", revision, cwd=checkout)
    assert not (checkout / "cldf/names.csv").exists()

    script = tmp_path / "pipeline/atlas/fetch-sources.sh"
    script.parent.mkdir(parents=True)
    script.write_text((Path(__file__).parents[1] / "atlas/fetch-sources.sh").read_text())
    script.with_name("sources.lock.tsv").write_text(
        f"datasets/example\t{revision}\t{origin}\tcldf/languages.csv,cldf/names.csv\n"
    )
    dlac = script.parent.parent / "dlac/fetch.sh"
    dlac.parent.mkdir()
    dlac.write_text('test "$ATLAS_FETCH_ROOT" = "$EXPECTED_FETCH_ROOT"\necho "DLAC fetched"\n')
    result = subprocess.run(
        ["bash", str(script)],
        env={
            **os.environ,
            "ATLAS_FETCH_ROOT": str(tmp_path / "workspace"),
            "EXPECTED_FETCH_ROOT": str(tmp_path / "workspace"),
        },
        capture_output=True,
        text=True,
        check=True,
    )
    assert "Fetching datasets/example" in result.stdout
    assert "DLAC fetched" in result.stdout
    assert (checkout / "cldf/names.csv").is_file()
    assert git("rev-parse", "HEAD", cwd=checkout) == revision
