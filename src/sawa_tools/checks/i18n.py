"""Checks that the bilingual message catalogs in site/src/i18n stay in sync."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import TYPE_CHECKING, NamedTuple

if TYPE_CHECKING:
    from collections.abc import Mapping

DEFAULT_DIR = Path("site/src/i18n")

# Matches the head of an ICU plural or selectordinal argument, e.g.
# "{count, plural," or "{n,selectordinal,", regardless of internal spacing.
ICU_PLURAL_HEAD = re.compile(r"\{\s*\w+\s*,\s*(plural|selectordinal)\s*,")

# ICU's six CLDR plural categories. Arabic distinguishes all six for cardinal
# plurals (zero/one/two/few/many/other), but its CLDR ordinal rules collapse
# to a single "other" category, so a selectordinal message only needs that one.
CLDR_PLURAL_CATEGORIES = ("zero", "one", "two", "few", "many", "other")
CLDR_ORDINAL_CATEGORIES = ("other",)


class DirCheckResult(NamedTuple):
    errors: list[str]
    files: list[str]


def add_parser(subparsers: argparse._SubParsersAction) -> None:
    parser = subparsers.add_parser(
        "i18n", help="Check that the i18n message catalogs are in sync"
    )
    parser.add_argument(
        "--dir",
        type=Path,
        default=DEFAULT_DIR,
        help="Directory of locale JSON files, relative to the cwd "
        "(default: %(default)s)",
    )
    parser.set_defaults(handler=run)


def run(args: argparse.Namespace) -> int:
    directory: Path = args.dir
    result = check_dir(directory)
    if result.errors:
        for error in result.errors:
            print(error, file=sys.stderr)
        return 1
    print(f"OK: {len(result.files)} i18n file(s) in sync ({', '.join(result.files)})")
    return 0


def check_dir(directory: Path) -> DirCheckResult:
    """Runs every i18n consistency check over the *.json files in `directory`.

    `errors` is a list of human-readable error lines, empty when everything is
    consistent. `files` is the sorted *.json file names found, so a caller
    doesn't need to glob the directory again.
    """
    paths = sorted(directory.glob("*.json"))
    files = [path.name for path in paths]

    if "en.json" not in files or len(files) < 2:
        return DirCheckResult(
            [
                f"{directory}: expected en.json and at least one other locale "
                f"file, found {files or 'none'}"
            ],
            files,
        )

    raw: dict[str, object] = {}
    errors: list[str] = []
    for path in paths:
        try:
            raw[path.name] = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            errors.append(f"{path.name}: invalid JSON: {exc}")

    for name, data in raw.items():
        errors.extend(check_shape(name, data))

    # Only well-shaped catalogs are safe to compare key sets or messages
    # against each other; a malformed file is already reported above.
    catalogs = {
        name: data
        for name, data in raw.items()
        if isinstance(data, dict)
        and all(isinstance(value, str) for value in data.values())
    }
    errors.extend(check_keys(catalogs))
    errors.extend(check_plurals(catalogs))
    return DirCheckResult(errors, files)


def check_shape(name: str, data: object) -> list[str]:
    """Rejects anything but a flat JSON object of string values."""
    if not isinstance(data, dict):
        return [f"{name}: must contain a JSON object, found {type(data).__name__}"]
    errors = []
    for key, value in data.items():
        if not isinstance(value, str):
            errors.append(f"{name}: key '{key}' is not a flat string value")
    return errors


def check_keys(catalogs: Mapping[str, Mapping[str, str]]) -> list[str]:
    """Reports, for each file, any key that another file has but it lacks."""
    all_keys: set[str] = set()
    for keys in catalogs.values():
        all_keys |= keys.keys()

    errors = []
    for name, data in catalogs.items():
        missing = sorted(all_keys - data.keys())
        for key in missing:
            present_in = sorted(
                other for other, other_data in catalogs.items() if key in other_data
            )
            errors.append(
                f"{name}: missing key '{key}' (present in {', '.join(present_in)})"
            )
    return errors


def check_plurals(catalogs: Mapping[str, Mapping[str, str]]) -> list[str]:
    """Checks an en.json ICU plural/selectordinal has its CLDR categories in ar.json.

    This is a substring match, not an ICU parser: it only looks for each
    category name followed by `{` anywhere in the message, so a category name
    that happens to appear as ordinary text would be a false positive.
    """
    en = catalogs.get("en.json")
    ar = catalogs.get("ar.json")
    if en is None or ar is None:
        return []

    errors = []
    for key, en_message in en.items():
        match = ICU_PLURAL_HEAD.search(en_message)
        if not match:
            continue
        kind = match.group(1)
        required = (
            CLDR_PLURAL_CATEGORIES if kind == "plural" else CLDR_ORDINAL_CATEGORIES
        )
        ar_message = ar.get(key)
        if ar_message is None:
            continue  # already reported by check_keys
        missing = [
            category
            for category in required
            if not re.search(rf"\b{category}\s*\{{", ar_message)
        ]
        if missing:
            errors.append(
                f"ar.json: key '{key}' has an ICU {kind} in en.json but is "
                f"missing CLDR categories: {', '.join(missing)}"
            )
    return errors
