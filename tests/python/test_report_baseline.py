from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from sawa_tools.report.baseline import baseline_tag


def _git(repo: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=repo, check=True, capture_output=True)


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    _git(tmp_path, "init", "-q")
    for tag in ("v0.1", "v0.2"):
        _git(
            tmp_path,
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@example.invalid",
            "commit",
            "-q",
            "--allow-empty",
            "-m",
            tag,
        )
        _git(tmp_path, "tag", tag)
    return tmp_path


def test_a_tag_diffs_against_the_tag_before_it(repo: Path) -> None:
    assert baseline_tag("v0.2", cwd=repo) == "v0.1"
    assert baseline_tag("v0.1", cwd=repo) is None


def test_an_untagged_build_diffs_against_the_latest_tag(repo: Path) -> None:
    assert baseline_tag(None, cwd=repo) == "v0.2"
