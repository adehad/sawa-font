"""manifest.json: what a bundle was built from and what it contains."""

from __future__ import annotations

import hashlib
import json
import platform
import subprocess
from datetime import UTC, datetime
from importlib.metadata import PackageNotFoundError, version
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from pathlib import Path

    from sawa_tools.report.catalogue import ReportTest
    from sawa_tools.report.sources import ReportFamily

_PACKAGES = ("fonttools", "uharfbuzz", "numpy", "glyphsets", "fontbakery")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def git_sha() -> str | None:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"], capture_output=True, text=True, check=True
        )
    except (OSError, subprocess.CalledProcessError):
        return None
    return result.stdout.strip() or None


def tool_versions() -> dict[str, str | None]:
    import importlib

    tools: dict[str, str | None] = {"python": platform.python_version()}
    for package in _PACKAGES:
        try:
            tools[package] = version(package)
        except PackageNotFoundError:
            tools[package] = None
    hb: Any = importlib.import_module("uharfbuzz")
    tools["harfbuzz"] = hb.version_string()
    return tools


def baseline_info(baseline: Path | None) -> dict[str, Any]:
    if baseline is None:
        return {"kind": "upstream", "version": None}
    manifest = baseline / "manifest.json"
    previous = None
    if manifest.exists():
        previous = json.loads(manifest.read_text(encoding="utf-8")).get("version")
    return {"kind": "previous", "version": previous or baseline.name}


def build_manifest(
    *,
    version_name: str,
    families: list[ReportFamily],
    tests: list[ReportTest],
    baseline: Path | None,
    shaping: dict[str, int],
    fontbakery: dict[str, Any],
    date: datetime | None = None,
) -> dict[str, Any]:
    stamp = (date or datetime.now(UTC)).astimezone(UTC)
    return {
        "version": version_name,
        "gitSha": git_sha(),
        "date": stamp.isoformat(timespec="seconds").replace("+00:00", "Z"),
        "tools": tool_versions(),
        "fonts": [
            {
                "family": family.id,
                "name": family.family.name,
                "file": family.ttf.name,
                "sha256": sha256_file(family.ttf),
                "upstream": {
                    "id": family.upstream_id,
                    "fonts": [
                        {"name": name, "file": path.name, "sha256": sha256_file(path)}
                        for name, path in zip(
                            family.upstream_names, family.upstream, strict=True
                        )
                    ],
                },
            }
            for family in families
        ],
        "tests": [test.id for test in tests],
        "diffBaseline": baseline_info(baseline),
        "shaping": shaping,
        "fontbakery": fontbakery,
    }
