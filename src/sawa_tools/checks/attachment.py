"""Checks that every Arabic mark follows its letter and stays clear of it.

Over the mark-groups.json codepoints a family maps: each combining mark must
be a GDEF mark positioned by a MarkBase subtable that has alef as a base;
and, shaped by HarfBuzz after each of BASES at each checked weight, its ink
must neither overlap the letter's ink (the letter glyph and any dots or
signs it is decomposed into) nor sit further from it than a limit, measured
between the two inks' bounding boxes.
And every pair of such marks some mark-to-mark subtable stacks, shaped the
same way, must keep the letter's ink and both marks' inks apart.

The font toolchain is imported inside the checks, so that importing this
module needs no `build` dependency group.
"""

from __future__ import annotations

import unicodedata
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Iterable

    from fontTools.ttLib import TTFont

DEFAULT_MAX_GAP_EM = 0.25

# (label, text, index of the base letter in the text).
BASES = (
    ("beh", "\u0628", 0),
    ("alef", "\u0627", 0),
    ("lam", "\u0644", 0),
    ("kaf", "\u0643", 0),
    ("yeh-final", "\u0628\u064a", 1),
    ("noon-final", "\u0628\u0646", 1),
)

_MARK_GLYPH_CLASS = 3


def checked_marks(cmap: dict[int, str], codepoints: Iterable[int]) -> list[int]:
    """The codepoints the font maps that are combining marks."""
    return sorted(
        cp
        for cp in set(codepoints)
        if cp in cmap and unicodedata.category(chr(cp)) == "Mn"
    )


def _codepoints(cps: Iterable[int]) -> str:
    return ", ".join(f"U+{cp:04X}" for cp in cps)


def attachment_errors(font: TTFont, codepoints: Iterable[int]) -> list[str]:
    from sawa_tools.build.anchors import letter_attached

    cmap = font.getBestCmap() or {}
    gdef = font["GDEF"].table if "GDEF" in font else None
    classes = gdef.GlyphClassDef.classDefs if gdef and gdef.GlyphClassDef else {}
    attached = letter_attached(font)
    marks = checked_marks(cmap, codepoints)
    not_marks = [cp for cp in marks if classes.get(cmap[cp]) != _MARK_GLYPH_CLASS]
    loose = [cp for cp in marks if cmap[cp] not in attached]
    errors = []
    if not_marks:
        errors.append(f"not GDEF marks: {_codepoints(not_marks)}")
    if loose:
        errors.append(
            "attached to no letter by any mark-positioning lookup: "
            + _codepoints(loose)
        )
    return errors


def spacing_errors(font: TTFont, codepoints: Iterable[int]) -> list[str]:
    """Where a mark meant to be a spacing glyph is a GDEF mark, has no
    advance or is still attached to letters.
    """
    from sawa_tools.build.anchors import letter_attached

    cmap = font.getBestCmap() or {}
    gdef = font["GDEF"].table if "GDEF" in font else None
    classes = gdef.GlyphClassDef.classDefs if gdef and gdef.GlyphClassDef else {}
    attached = letter_attached(font)
    bad = [
        cp
        for cp in sorted(cp for cp in codepoints if cp in cmap)
        if classes.get(cmap[cp]) == _MARK_GLYPH_CLASS
        or font["hmtx"][cmap[cp]][0] == 0
        or cmap[cp] in attached
    ]
    return [f"not spacing glyphs: {_codepoints(bad)}"] if bad else []


def placement_errors(
    data: bytes,
    marks: Iterable[int],
    weights: Iterable[float],
    max_gap_em: float = DEFAULT_MAX_GAP_EM,
) -> list[str]:
    """Shapes each mark on each of BASES and reports overlap or distance."""
    from sawa_tools.build import ink
    from sawa_tools.build.harfbuzz import Shaper

    errors = []
    marks = list(marks)
    for weight in weights:
        shaper = Shaper(data, {"wght": weight})
        max_gap = max_gap_em * shaper.upem
        step = shaper.upem / 500
        for label, text, index in BASES:
            for cp in marks:
                letter, added = shaper.split(text, index, chr(cp))
                letter_box, mark_box = shaper.box(letter), shaper.box(added)
                where = f"wght {weight:g}: U+{cp:04X} on {label}"
                if letter_box is None or mark_box is None:
                    # The letter and mark composed into one glyph.
                    continue
                if ink.box_gap(letter_box, mark_box) == 0 and ink.overlap(
                    shaper.edges(letter), shaper.edges(added), step, step / 2
                ):
                    errors.append(f"{where}: mark ink overlaps the letter's")
                    continue
                gap = ink.box_gap(letter_box, mark_box)
                if gap > max_gap:
                    errors.append(
                        f"{where}: mark is {gap:.0f} units from the letter "
                        f"(limit {max_gap:.0f})"
                    )
    return errors


def mark_stacks(font: TTFont, codepoints: Iterable[int]) -> list[tuple[int, int]]:
    """Every (first, second) pair of checked marks some mark-to-mark subtable
    stacks: the first as mark2, the second attached to it as mark1.
    """
    from sawa_tools.build.anchors import mark_to_mark_subtables

    cmap = font.getBestCmap() or {}
    by_glyph: dict[str, list[int]] = {}
    for cp in checked_marks(cmap, codepoints):
        by_glyph.setdefault(cmap[cp], []).append(cp)
    pairs = set()
    for sub in mark_to_mark_subtables(font):
        seconds = [cp for g in sub.Mark1Coverage.glyphs for cp in by_glyph.get(g, [])]
        firsts = [cp for g in sub.Mark2Coverage.glyphs for cp in by_glyph.get(g, [])]
        pairs |= {(a, b) for a in firsts for b in seconds if a != b}
    return sorted(pairs)


def stack_errors(
    data: bytes,
    stacks: Iterable[tuple[int, int]],
    weights: Iterable[float],
) -> list[str]:
    """Shapes each stack on each of BASES and reports any two of the letter,
    the first mark and the second mark whose inks overlap.
    """
    from sawa_tools.build import ink
    from sawa_tools.build.harfbuzz import Shaper

    errors = []
    stacks = list(stacks)
    for weight in weights:
        shaper = Shaper(data, {"wght": weight})
        step = shaper.upem / 500
        for label, text, index in BASES:
            with_first: dict[int, tuple[list, list]] = {}
            for first, second in stacks:
                if first not in with_first:
                    with_first[first] = shaper.split(text, index, chr(first))
                first_glyphs = with_first[first][1]
                if len(first_glyphs) != 1:
                    continue
                letter, added = shaper.split(text, index, chr(first) + chr(second))
                gid = first_glyphs[0].gid
                # Two marks that ligate, or that shaping substitutes, are no
                # stack.
                if len(added) != 2 or [g.gid for g in added].count(gid) != 1:
                    continue
                first_now = [g for g in added if g.gid == gid]
                rest = [g for g in added if g.gid != gid]
                parts = {"letter": letter, "first": first_now, "second": rest}
                where = f"wght {weight:g}: U+{first:04X} U+{second:04X} on {label}"
                for a, b in (
                    ("second", "first"),
                    ("second", "letter"),
                    ("first", "letter"),
                ):
                    box_a, box_b = shaper.box(parts[a]), shaper.box(parts[b])
                    if (
                        box_a is not None
                        and box_b is not None
                        and ink.box_gap(box_a, box_b) == 0
                        and ink.overlap(
                            shaper.edges(parts[a]),
                            shaper.edges(parts[b]),
                            step,
                            step / 2,
                        )
                    ):
                        errors.append(f"{where}: {a} mark ink overlaps the {b}'s")
    return errors
