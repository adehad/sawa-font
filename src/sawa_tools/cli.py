import argparse
from collections.abc import Sequence

from sawa_tools import rtd
from sawa_tools.build import fonts
from sawa_tools.checks import fonts as fonts_check
from sawa_tools.checks import i18n, leading, marks
from sawa_tools.report import commands as report_commands

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
        commands = group.add_subparsers(
            dest="command", metavar="<command>", required=True
        )
        if name == "build":
            fonts.add_parser(commands)
        if name == "report":
            report_commands.add_parsers(commands)
        if name == "check":
            fonts_check.add_parser(commands)
            i18n.add_parser(commands)
            leading.add_parser(commands)
            marks.add_parser(commands)
        if name == "rtd":
            rtd.add_parsers(commands)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.handler(args)
