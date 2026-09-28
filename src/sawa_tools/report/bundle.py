"""`sawa report build`: writes the report bundle described in SAWA_PLAN.md §8.1."""

from __future__ import annotations

import json
import shutil
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from sawa_tools.checks.marks import DEFAULT_GROUPS, load_groups
from sawa_tools.report.catalogue import load_tests
from sawa_tools.report.coverage import build_coverage
from sawa_tools.report.layers import Stacks, write_test
from sawa_tools.report.metrics import build_metrics
from sawa_tools.report.shaping import run_shaping
from sawa_tools.report.sources import report_families

DEFAULT_SNAPSHOTS = Path("tests/shaping")


class BundleError(Exception):
    """Raised for a bundle that cannot be built as asked."""


@dataclass(frozen=True)
class BundleOptions:
    version: str
    out: Path
    fonts_dir: Path
    baseline: Path | None = None
    snapshots: Path = DEFAULT_SNAPSHOTS
    groups: Path = DEFAULT_GROUPS


def default_version() -> str:
    try:
        result = subprocess.run(
            ["git", "describe", "--tags", "--always"],
            capture_output=True,
            text=True,
            check=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return "main"
    return result.stdout.strip() or "main"


def _prepare_out(out: Path, baseline: Path | None) -> None:
    if baseline is not None and out.resolve() == baseline.resolve():
        raise BundleError("--out and --baseline must be different directories")
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)


def write_json(path: Path, data: Any) -> None:
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def build_bundle(options: BundleOptions) -> None:
    start = time.monotonic()
    families = report_families(options.fonts_dir)
    tests = load_tests()
    groups, errors = load_groups(options.groups)
    if errors:
        raise BundleError("; ".join(errors))
    _prepare_out(options.out, options.baseline)

    stacks = Stacks(families)
    changed = 0
    for test in tests:
        data = write_test(test, stacks, options.out, options.baseline)
        changed += any(data["diffRegions"].values())
    print(
        f"tests: {len(tests)} written, {changed} with diff regions "
        f"({time.monotonic() - start:.1f}s)"
    )

    shaping = run_shaping(families, tests, options.snapshots)
    write_json(options.out / "shaping.json", shaping)
    counts = shaping["summary"]
    print(
        f"shaping: {counts['pass']} pass, {counts['fail']} fail, "
        f"{counts['missing']} without a snapshot"
    )
    write_json(
        options.out / "metrics.json",
        build_metrics({family.id: family.ttf for family in families}),
    )
    write_json(options.out / "coverage.json", build_coverage(families, groups))
