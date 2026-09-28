import argparse
from collections.abc import Sequence

GROUPS = {
    "build": "Build the font family",
    "report": "Produce the build report bundle",
    "check": "Repository checks run in CI",
    "rtd": "Read the Docs report-only build steps",
}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="sawa", description="Sawa font tooling")
    groups = parser.add_subparsers(dest="group", metavar="<group>", required=True)
    for name, help_text in GROUPS.items():
        group = groups.add_parser(name, help=help_text, description=help_text)
        group.add_subparsers(dest="command", metavar="<command>", required=True)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.handler(args)
