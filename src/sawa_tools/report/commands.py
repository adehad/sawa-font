"""`sawa report` subcommands.

The report modules import fontTools, uharfbuzz and numpy, which only the
`build` and `report` dependency groups install, so handlers import them
lazily and `sawa --help` works without either group.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from sawa_tools.build.families import DEFAULT_FONTS_DIR


def add_parsers(subparsers: argparse._SubParsersAction) -> None:
    build = subparsers.add_parser(
        "build", help="Write the report bundle (SVG layers, diffs, JSON)"
    )
    build.add_argument(
        "--version",
        help="Bundle version (default: `git describe --tags --always`, or 'main')",
    )
    build.add_argument(
        "--out", type=Path, help="Output directory (default: report/<version>)"
    )
    build.add_argument(
        "--baseline",
        type=Path,
        help="A previous bundle directory to diff against (default: the "
        "upstream layers)",
    )
    build.add_argument(
        "--fonts-dir",
        type=Path,
        default=DEFAULT_FONTS_DIR,
        help="Directory holding the built Sawa TTFs (default: %(default)s)",
    )
    build.set_defaults(handler=run_build)

    shaping = subparsers.add_parser(
        "shaping", help="Compare HarfBuzz shaping against tests/shaping snapshots"
    )
    shaping.add_argument(
        "--update",
        action="store_true",
        help="Rewrite the snapshots from the current fonts instead of comparing",
    )
    shaping.add_argument(
        "--fonts-dir",
        type=Path,
        default=DEFAULT_FONTS_DIR,
        help="Directory holding the built Sawa TTFs (default: %(default)s)",
    )
    shaping.add_argument(
        "--snapshots",
        type=Path,
        default=Path("tests/shaping"),
        help="Snapshot directory (default: %(default)s)",
    )
    shaping.set_defaults(handler=run_shaping_command)


def run_shaping_command(args: argparse.Namespace) -> int:
    from sawa_tools.build.families import FamilyError
    from sawa_tools.report.catalogue import CatalogueError, load_tests
    from sawa_tools.report.shaping import run_shaping, write_snapshots
    from sawa_tools.report.sources import SourcesError, report_families

    try:
        families = report_families(args.fonts_dir)
        tests = load_tests()
    except (CatalogueError, FamilyError, SourcesError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    if args.update:
        for path in write_snapshots(families, tests, args.snapshots):
            print(f"wrote {path}")
        return 0
    result = run_shaping(families, tests, args.snapshots)
    for family, family_tests in result["families"].items():
        for test_id, weights in family_tests.items():
            for weight, outcome in weights.items():
                if outcome["status"] != "pass":
                    detail = outcome.get("firstDiff", "")
                    print(
                        f"{family} {test_id} {weight}: {outcome['status']} {detail}",
                        file=sys.stderr,
                    )
    counts = result["summary"]
    print(
        f"shaping: {counts['pass']} pass, {counts['fail']} fail, "
        f"{counts['missing']} without a snapshot"
    )
    return 0 if counts["fail"] == counts["missing"] == 0 else 1


def run_build(args: argparse.Namespace) -> int:
    from sawa_tools.build.families import FamilyError
    from sawa_tools.checks.marks import MarksError
    from sawa_tools.report.bundle import (
        BundleError,
        BundleOptions,
        build_bundle,
        default_version,
    )
    from sawa_tools.report.catalogue import CatalogueError
    from sawa_tools.report.sources import SourcesError

    version = args.version or default_version()
    if args.baseline is not None and not (args.baseline / "tests").is_dir():
        print(f"error: {args.baseline} is not a report bundle", file=sys.stderr)
        return 1
    options = BundleOptions(
        version=version,
        out=args.out or Path("report") / version,
        fonts_dir=args.fonts_dir,
        baseline=args.baseline,
    )
    try:
        build_bundle(options)
    except (BundleError, CatalogueError, FamilyError, MarksError, SourcesError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(f"wrote {options.out}")
    return 0
