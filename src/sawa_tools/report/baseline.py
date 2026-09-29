"""`sawa report baseline`: fetches the bundle a CI build diffs against.

On a tag that is the previous tag's release asset; elsewhere, the latest
tag's. Downloads go through the GitHub CLI (`gh release download`, which
reads GH_TOKEN), so the command only reads from the repository.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path

ASSET = "sawa-report-{version}.zip"


def _git(*args: str, cwd: Path | None = None) -> str | None:
    try:
        result = subprocess.run(
            ["git", *args], capture_output=True, text=True, check=True, cwd=cwd
        )
    except (OSError, subprocess.CalledProcessError):
        return None
    return result.stdout.strip() or None


def baseline_tag(current_tag: str | None, cwd: Path | None = None) -> str | None:
    """The tag before `current_tag`, or the latest tag reachable from HEAD."""
    if current_tag:
        return _git("describe", "--tags", "--abbrev=0", f"{current_tag}^", cwd=cwd)
    return _git("describe", "--tags", "--abbrev=0", "HEAD", cwd=cwd)


def download_bundle(tag: str, out: Path) -> bool:
    """Extracts `tag`'s report asset into `out`; False when it has none."""
    with tempfile.TemporaryDirectory() as tmp:
        try:
            subprocess.run(
                [
                    "gh",
                    "release",
                    "download",
                    tag,
                    "--pattern",
                    ASSET.format(version=tag),
                    "--dir",
                    tmp,
                ],
                capture_output=True,
                text=True,
                check=True,
            )
        except (OSError, subprocess.CalledProcessError) as exc:
            detail = getattr(exc, "stderr", "") or exc
            print(f"no report asset for {tag}: {str(detail).strip()}")
            return False
        archive = Path(tmp) / ASSET.format(version=tag)
        if out.exists():
            shutil.rmtree(out)
        with zipfile.ZipFile(archive) as zf:
            zf.extractall(out)
    return (out / "tests").is_dir()


def fetch_baseline(current_tag: str | None, out: Path) -> Path | None:
    tag = baseline_tag(current_tag)
    if tag is None:
        print("no earlier tag; the report diffs against upstream")
        return None
    if not download_bundle(tag, out):
        return None
    print(f"baseline: {tag} in {out}")
    github_output = os.environ.get("GITHUB_OUTPUT")
    if github_output:
        with Path(github_output).open("a", encoding="utf-8") as fh:
            fh.write(f"dir={out.as_posix()}\n")
    return out
