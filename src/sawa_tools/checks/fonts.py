"""Checks each built Sawa family in fonts/ against data/sawa.json.

Per family: the wght axis matches the config, the instancer works at the
axis minimum, default and maximum, HarfBuzz shapes Latin, Arabic and mixed
lines without .notdef at those weights, the line box matches the config,
no family name carries a reserved upstream name, a monospace family's
advances are all zero or its cell width, and every mark in
data/mark-groups.json the font maps is attached and clear of its letter at
those weights (see attachment.py).
"""

from __future__ import annotations

import argparse
import importlib
import io
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

from sawa_tools.build.families import (
    DEFAULT_FAMILIES,
    DEFAULT_FONTS_DIR,
    Family,
    FamilyError,
    load_config,
)
from sawa_tools.checks.attachment import DEFAULT_MAX_GAP_EM
from sawa_tools.checks.marks import (
    DEFAULT_GROUPS,
    MarksError,
    _parse_codepoints,
    load_groups,
)

if TYPE_CHECKING:
    from collections.abc import Iterable

DEFAULT_STRESS = Path("tests/strings/stress.json")
DEFAULT_MIXED = Path("tests/strings/mixed.json")
DEFAULT_TANZIL = Path("data/tanzil")

LATIN_LINE = "The quick brown fox jumps over the lazy dog. 0123456789 (ÅÉÎ) fi fl"

DOTTED_CIRCLE = 0x25CC
_TRADEMARK_ID = 7

_TANZIL_FILES = ("uthmani-fatiha.txt", "simple-clean-fatiha.txt")
_TANZIL_COPYRIGHT = "# PLEASE DO NOT REMOVE OR CHANGE THIS COPYRIGHT BLOCK"


class FontsCheckError(Exception):
    """Raised for a failure that should stop the check with a clear message."""


@dataclass(frozen=True)
class Line:
    label: str
    text: str


def add_parser(subparsers: argparse._SubParsersAction) -> None:
    parser = subparsers.add_parser(
        "fonts", help="Check the built Sawa families against data/sawa.json"
    )
    parser.add_argument(
        "--families",
        type=Path,
        default=DEFAULT_FAMILIES,
        help="Path to the Sawa family config (default: %(default)s)",
    )
    parser.add_argument(
        "--fonts-dir",
        type=Path,
        default=DEFAULT_FONTS_DIR,
        help="Directory holding the built TTFs (default: %(default)s)",
    )
    parser.add_argument(
        "--groups",
        type=Path,
        default=DEFAULT_GROUPS,
        help="Mark groups whose marks must be attached and clear of their "
        "letter (default: %(default)s)",
    )
    parser.add_argument(
        "--max-mark-gap",
        type=float,
        default=DEFAULT_MAX_GAP_EM,
        help="Largest gap, in em, allowed between a mark's ink and its "
        "letter's (default: %(default)s)",
    )
    parser.set_defaults(handler=run)


def run(args: argparse.Namespace) -> int:
    try:
        config = load_config(args.families)
        lines = sample_lines(DEFAULT_STRESS, DEFAULT_MIXED, DEFAULT_TANZIL)
        marks = mark_codepoints(args.groups)
        failed = False
        for family in config.families:
            errors = check_family(
                family,
                args.fonts_dir / family.ttf_name,
                config.reserved_names,
                lines,
                marks=marks,
                max_mark_gap=args.max_mark_gap,
            )
            for error in errors:
                print(f"{family.id}: {error}", file=sys.stderr)
            if not errors:
                print(f"OK: {family.id}")
            failed = failed or bool(errors)
    except (FamilyError, FontsCheckError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 1 if failed else 0


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise FontsCheckError(f"cannot read {path}: {exc}") from exc


def tanzil_verses(text: str) -> list[str]:
    """The verse lines of a Tanzil excerpt, without its copyright block."""
    verses = text.split(_TANZIL_COPYRIGHT, 1)[0]
    return [line for line in verses.splitlines() if line.strip()]


def sample_lines(stress: Path, mixed: Path, tanzil_dir: Path) -> list[Line]:
    lines = [Line("latin", LATIN_LINE)]
    lines += [
        Line(f"stress/{test['id']}", test["text"])
        for test in _read_json(stress)["tests"]
    ]
    for name in _TANZIL_FILES:
        try:
            text = (tanzil_dir / name).read_text(encoding="utf-8")
        except OSError as exc:
            raise FontsCheckError(f"cannot read {tanzil_dir / name}: {exc}") from exc
        lines += [
            Line(f"tanzil/{name}:{i}", verse)
            for i, verse in enumerate(tanzil_verses(text), start=1)
        ]
    lines += [
        Line(f"mixed/{sentence['id']}", sentence["text"])
        for sentence in _read_json(mixed)["sentences"]
    ]
    return lines


def mark_codepoints(groups: Path) -> set[int]:
    try:
        parsed, errors = load_groups(groups)
    except MarksError as exc:
        raise FontsCheckError(str(exc)) from exc
    if errors:
        raise FontsCheckError("; ".join(errors))
    return set().union(*parsed.values()) if parsed else set()


def gap_codepoints(specs: Iterable[str]) -> set[int]:
    try:
        return {cp for spec in specs for cp in _parse_codepoints(spec)}
    except MarksError as exc:
        raise FontsCheckError(f"coverageGaps: {exc}") from exc


def without(text: str, codepoints: set[int]) -> str:
    return "".join(ch for ch in text if ord(ch) not in codepoints)


def advance_errors(font: Any, cell_width: int, where: str) -> list[str]:
    bad = sorted(
        {
            width
            for width, _ in font["hmtx"].metrics.values()
            if width not in (0, cell_width)
        }
    )
    if not bad:
        return []
    return [f"{where}: advances {bad} are neither 0 nor the cell width {cell_width}"]


def line_box_errors(font: Any, family: Family) -> list[str]:
    os2, hhea = font["OS/2"], font["hhea"]
    want = family.metrics
    found = {
        "hhea": (hhea.ascent, hhea.descent, hhea.lineGap),
        "typo": (os2.sTypoAscender, os2.sTypoDescender, os2.sTypoLineGap),
        "win": (os2.usWinAscent, os2.usWinDescent),
    }
    expected = {
        "hhea": (want.ascender, want.descender, want.line_gap),
        "typo": (want.ascender, want.descender, want.line_gap),
        "win": (want.win_ascent, want.win_descent),
    }
    return [
        f"{key} metrics {found[key]} differ from the config's {expected[key]}"
        for key in expected
        if found[key] != expected[key]
    ]


def name_errors(font: Any, cell_width: int | None) -> list[str]:
    from sawa_tools.build.naming import OFL_DESCRIPTION, OFL_URL

    name = font["name"]
    errors = []
    if any(record.nameID == _TRADEMARK_ID for record in name.names):
        errors.append("name ID 7 (trademark) is present")
    for name_id, want in ((13, OFL_DESCRIPTION), (14, OFL_URL)):
        if name.getDebugName(name_id) != want:
            errors.append(f"name ID {name_id} is not the OFL {want!r}")
    if cell_width is not None and not font["post"].isFixedPitch:
        errors.append("post.isFixedPitch is not set on a monospace family")
    return errors


def shaping_errors(
    data: bytes, weights: Iterable[float], lines: list[Line], cmap: dict[int, str]
) -> list[str]:
    # uharfbuzz is a compiled extension without type stubs.
    hb: Any = importlib.import_module("uharfbuzz")

    face = hb.Face(data)
    errors = []
    for weight in weights:
        font = hb.Font(face)
        font.set_variations({"wght": weight})
        dotted_circle = font.get_nominal_glyph(DOTTED_CIRCLE)
        for line in lines:
            buf = hb.Buffer()
            buf.add_str(line.text)
            buf.guess_segment_properties()
            hb.shape(font, buf)
            if any(info.codepoint == 0 for info in buf.glyph_infos):
                missing = sorted({ord(ch) for ch in line.text} - set(cmap))
                names = ", ".join(f"U+{cp:04X}" for cp in missing) or "none"
                errors.append(
                    f"wght {weight:g}: .notdef shaping {line.label} "
                    f"(not in cmap: {names})"
                )
            if (
                dotted_circle is not None
                and chr(DOTTED_CIRCLE) not in line.text
                and any(info.codepoint == dotted_circle for info in buf.glyph_infos)
            ):
                errors.append(
                    f"wght {weight:g}: HarfBuzz inserted a dotted circle in "
                    f"{line.label}"
                )
    return errors


def check_family(
    family: Family,
    ttf: Path,
    reserved: list[str],
    lines: list[Line],
    *,
    marks: Iterable[int] = (),
    max_mark_gap: float = DEFAULT_MAX_GAP_EM,
) -> list[str]:
    try:
        from fontTools.ttLib import TTFont
        from fontTools.varLib import instancer
    except ImportError as exc:
        raise FontsCheckError(
            "fontTools and uharfbuzz are required; install the 'build' "
            "dependency group (uv run --group build sawa check fonts)"
        ) from exc

    from sawa_tools.build.merge import axis_range
    from sawa_tools.build.naming import family_name_records, reserved_name_hits

    if not ttf.exists():
        return [f"{ttf} not found; run `sawa build fonts` first"]
    try:
        font = TTFont(ttf)
        data = ttf.read_bytes()
        axis = axis_range(font, "wght")
    except Exception as exc:
        return [f"cannot open {ttf} as a wght variable font: {exc}"]

    errors = []
    if axis != family.wght:
        errors.append(f"fvar wght {axis} differs from the config's {family.wght}")
    weights = sorted({family.wght.minimum, family.wght.default, family.wght.maximum})

    for weight in weights:
        try:
            static = instancer.instantiateVariableFont(
                TTFont(ttf), {"wght": weight}, inplace=False
            )
            static.save(io.BytesIO())
        except Exception as exc:
            errors.append(f"instancer fails at wght {weight:g}: {exc}")
            continue
        if family.cell_width is not None:
            errors += advance_errors(static, family.cell_width, f"wght {weight:g}")
    if family.cell_width is not None:
        errors += advance_errors(font, family.cell_width, "default")

    cmap = font.getBestCmap() or {}
    gaps = gap_codepoints(family.coverage_gaps)
    present = sorted(cp for cp in gaps if cp in cmap)
    if present:
        errors.append(
            "coverageGaps lists codepoints the font has: "
            + ", ".join(f"U+{cp:04X}" for cp in present)
        )
    shaped = [Line(line.label, without(line.text, gaps)) for line in lines]
    errors += shaping_errors(data, weights, shaped, cmap)

    from sawa_tools.checks.attachment import (
        attachment_errors,
        checked_marks,
        mark_stacks,
        placement_errors,
        stack_errors,
    )

    errors += attachment_errors(font, marks)
    errors += placement_errors(
        data, checked_marks(cmap, marks), weights, max_gap_em=max_mark_gap
    )
    errors += stack_errors(data, mark_stacks(font, marks), weights)
    errors += line_box_errors(font, family)
    errors += name_errors(font, family.cell_width)
    errors += [
        f"reserved name in {hit}"
        for hit in reserved_name_hits(family_name_records(font), reserved)
    ]
    return errors
