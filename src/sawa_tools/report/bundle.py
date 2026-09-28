"""`sawa report build`: writes the report bundle described in SAWA_PLAN.md §8.1."""

from __future__ import annotations

import shutil
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path

from sawa_tools.report.catalogue import load_tests
from sawa_tools.report.layers import Stacks, write_test
from sawa_tools.report.sources import report_families


class BundleError(Exception):
    """Raised for a bundle that cannot be built as asked."""


@dataclass(frozen=True)
class BundleOptions:
    version: str
    out: Path
    fonts_dir: Path
    baseline: Path | None = None


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


def build_bundle(options: BundleOptions) -> None:
    start = time.monotonic()
    families = report_families(options.fonts_dir)
    tests = load_tests()
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
