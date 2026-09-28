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


def run_build(args: argparse.Namespace) -> int:
    from sawa_tools.build.families import FamilyError
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
    except (BundleError, CatalogueError, FamilyError, SourcesError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(f"wrote {options.out}")
    return 0
