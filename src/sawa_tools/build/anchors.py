"""Makes every Arabic mark follow its letter, per master.

Runs on each static master before varLib.build, in three steps that key off
the font's own mark classes: the MarkBase subtables that position fatha
(above marks) and kasra (below marks), called reference subtables here.

1. Stray marks: a combining Arabic mark in the cmap that no reference
   subtable of its side positions joins that side everywhere fatha or kasra
   is: MarkBase, MarkLig, and mark-to-mark as both mark1 and mark2. Its
   anchor comes from its ink, at the median offset the subtable's existing
   marks keep from theirs.
2. Unanchored letters: a glyph HarfBuzz shapes an Arabic letter to that no
   reference subtable of a side has as a base joins it, with an anchor at
   the median offset existing Arabic bases keep from their ink.
3. Stacks: every mark-to-mark anchor moves out until the marks that stack
   on it clear its ink box by the family's mark clearance.

Which glyphs join is decided once for all masters, so the masters keep one
anchor and lookup structure; only the values differ. compact.py then moves
the anchors against the marks' and letters' ink.
"""

from __future__ import annotations

import statistics
import unicodedata
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Literal

from fontTools.pens.boundsPen import BoundsPen
from fontTools.ttLib.tables import otTables as _otTables

from sawa_tools.build.harfbuzz import Shaper
from sawa_tools.checks.marks import ARABIC_BLOCKS

if TYPE_CHECKING:
    from collections.abc import Callable, Iterable, Iterator, Mapping

    from fontTools.ttLib import TTFont

# otTables builds its classes when it is imported, out of a type checker's
# sight.
ot: Any = _otTables


def table(font: TTFont, tag: str) -> Any:
    """`font[tag]`, untyped, like merge.table; merge.py imports this module."""
    return font[tag]


Side = Literal["top", "bottom"]
SIDES: tuple[Side, Side] = ("top", "bottom")
Role = Literal["base", "lig", "mark1", "mark2"]
Bounds = tuple[float, float, float, float]
Point = tuple[float, float]

ALEF = 0x0627
REFERENCE_MARKS: dict[Side, int] = {"top": 0x064E, "bottom": 0x0650}

# Canonical combining classes of marks drawn below the letter: the generic
# below class, kasratan and kasra.
_BELOW_CLASSES = (220, 29, 32)
_LETTER_CATEGORIES = ("Lo", "Lm")

# The Arabic blocks without the presentation forms, which shaping never
# produces from the base letters.
LETTER_BLOCKS = ARABIC_BLOCKS[:3]

_MARK_GLYPH_CLASS = 3
_USE_MARK_FILTERING_SET = 0x0010
_MARK_ATTACHMENT_TYPE = 0xFF00
_GDEF_MARK_SETS_VERSION = 0x00010002


class AnchorError(Exception):
    """Raised when the masters cannot all be anchored the same way."""


def placement(cp: int) -> Side:
    return "bottom" if unicodedata.combining(chr(cp)) in _BELOW_CLASSES else "top"


def _in_arabic_blocks(cp: int) -> bool:
    return any(low <= cp <= high for low, high in ARABIC_BLOCKS)


def is_arabic_mark(cp: int) -> bool:
    return unicodedata.category(chr(cp)) == "Mn" and _in_arabic_blocks(cp)


@dataclass(frozen=True)
class Slot:
    """One side of one mark subtable a new mark or base can join."""

    lookup: Any
    subtable: Any
    role: Role
    side: Side
    mark_class: int


def _subtables(font: TTFont) -> Iterator[tuple[Any, int, Any]]:
    """Every GPOS subtable as (lookup, lookup type, subtable), unwrapped from
    any extension lookup.
    """
    if "GPOS" not in font:
        return
    lookups = table(font, "GPOS").table.LookupList
    for lookup in lookups.Lookup if lookups else []:
        for sub in lookup.SubTable:
            if lookup.LookupType == 9:
                yield lookup, sub.ExtensionLookupType, sub.ExtSubTable
            else:
                yield lookup, lookup.LookupType, sub


def mark_to_mark_subtables(font: TTFont) -> list[Any]:
    return [sub for _, kind, sub in _subtables(font) if kind == 6]


def letter_attached(font: TTFont) -> set[str]:
    """Glyphs positioned by a MarkBase subtable that has alef as a base."""
    alef = (font.getBestCmap() or {}).get(ALEF)
    return {
        glyph
        for _, kind, sub in _subtables(font)
        if kind == 4 and alef in sub.BaseCoverage.glyphs
        for glyph in sub.MarkCoverage.glyphs
    }


def _class_of(array: Any, coverage: Any, glyph: str) -> int:
    return array.MarkRecord[coverage.glyphs.index(glyph)].Class


def slots(font: TTFont) -> list[Slot]:
    """Every subtable side holding fatha or kasra, in lookup order."""
    cmap = font.getBestCmap() or {}
    found = []
    for lookup, kind, sub in _subtables(font):
        for side, cp in REFERENCE_MARKS.items():
            ref = cmap.get(cp)
            if ref is None:
                continue
            if kind in (4, 5) and ref in sub.MarkCoverage.glyphs:
                role: Role = "base" if kind == 4 else "lig"
                cls = _class_of(sub.MarkArray, sub.MarkCoverage, ref)
                found.append(Slot(lookup, sub, role, side, cls))
            if kind == 6 and ref in sub.Mark1Coverage.glyphs:
                cls = _class_of(sub.Mark1Array, sub.Mark1Coverage, ref)
                found.append(Slot(lookup, sub, "mark1", side, cls))
                found.append(Slot(lookup, sub, "mark2", side, cls))
    return found


def _class_marks(slot: Slot) -> set[str]:
    sub = slot.subtable
    return {
        glyph
        for glyph, record in zip(
            sub.MarkCoverage.glyphs, sub.MarkArray.MarkRecord, strict=True
        )
        if record.Class == slot.mark_class
    }


def stray_marks(font: TTFont) -> dict[str, Side]:
    """Cmap Arabic marks no reference subtable positions, on the side their
    combining class puts them. A mark the font already places on the other
    side stays there.
    """
    placed: dict[Side, set[str]] = {"top": set(), "bottom": set()}
    for slot in slots(font):
        if slot.role == "base":
            placed[slot.side] |= _class_marks(slot)
    anywhere = placed["top"] | placed["bottom"]
    return {
        glyph: placement(cp)
        for cp, glyph in sorted((font.getBestCmap() or {}).items())
        if is_arabic_mark(cp) and glyph not in anywhere
    }


@dataclass(frozen=True)
class Letters:
    """The contexts each cmap Arabic letter is shaped in, as (text, index of
    the letter), the base glyphs HarfBuzz shapes them to, and the dots and
    signs it decomposes them into.
    """

    contexts: list[tuple[str, int]]
    glyphs: set[str]
    marks: set[str]


def shaped_letters(font: TTFont, shaper: Shaper) -> Letters:
    """Each Arabic letter alone and in initial, medial and final position
    after beh and lam, deduplicated by the glyphs it shapes to.
    """
    cmap = font.getBestCmap() or {}
    joiners = [chr(cp) for cp in (0x0628, 0x0644) if cp in cmap]
    order = font.getGlyphOrder()
    classes = _glyph_classes(font)
    seen: set[tuple[int, ...]] = set()
    contexts, glyphs, marks = [], set(), set()
    for cp in sorted(cmap):
        if not (
            any(low <= cp <= high for low, high in LETTER_BLOCKS)
            and unicodedata.category(chr(cp)) in _LETTER_CATEGORIES
        ):
            continue
        letter = chr(cp)
        texts = [(letter, 0)]
        for j in joiners:
            texts += [(j + letter, 1), (letter + j, 0), (j + letter + j, 1)]
        for text, index in texts:
            cluster = tuple(g.gid for g in shaper.shape(text) if g.cluster == index)
            if cluster in seen:
                continue
            seen.add(cluster)
            contexts.append((text, index))
            for gid in cluster:
                is_mark = classes.get(order[gid]) == _MARK_GLYPH_CLASS
                (marks if is_mark else glyphs).add(order[gid])
    return Letters(contexts, glyphs, marks)


def _glyph_classes(font: TTFont) -> dict[str, int]:
    gdef = font["GDEF"].table if "GDEF" in font else None
    return gdef.GlyphClassDef.classDefs if gdef and gdef.GlyphClassDef else {}


def unanchored_bases(font: TTFont, letters: set[str]) -> dict[Side, list[str]]:
    """Letters (with ink) no reference MarkBase subtable of a side has."""
    bounds = glyph_bounds(font.getGlyphSet())
    candidates = {g for g in letters if bounds(g) is not None}
    covered: dict[Side, set[str]] = {"top": set(), "bottom": set()}
    for slot in slots(font):
        if slot.role == "base":
            covered[slot.side] |= set(slot.subtable.BaseCoverage.glyphs)
    return {
        side: sorted(candidates - covered[side], key=font.getGlyphID)
        for side in covered
    }


def glyph_bounds(glyphset: Mapping[str, Any]) -> Callable[[str], Bounds | None]:
    cache: dict[str, Bounds | None] = {}

    def bounds(glyph: str) -> Bounds | None:
        if glyph not in cache:
            pen = BoundsPen(glyphset)
            glyphset[glyph].draw(pen)
            cache[glyph] = pen.bounds
        return cache[glyph]

    return bounds


def _existing(slot: Slot) -> Iterator[tuple[str, Any]]:
    """The (glyph, anchor) pairs already on the slot's side of its subtable."""
    sub = slot.subtable
    if slot.role == "mark2":
        for glyph, record in zip(
            sub.Mark2Coverage.glyphs, sub.Mark2Array.Mark2Record, strict=True
        ):
            anchor = record.Mark2Anchor[slot.mark_class]
            if anchor is not None:
                yield glyph, anchor
        return
    coverage, array = (
        (sub.Mark1Coverage, sub.Mark1Array)
        if slot.role == "mark1"
        else (sub.MarkCoverage, sub.MarkArray)
    )
    for glyph, record in zip(coverage.glyphs, array.MarkRecord, strict=True):
        if record.Class == slot.mark_class:
            yield glyph, record.MarkAnchor


def _mark_point(slot: Slot, bounds: Bounds) -> Point:
    """The ink point a mark's anchor keeps its distance from: the edge
    facing the base for a mark, the edge facing away from it for mark2.
    """
    x_min, y_min, x_max, y_max = bounds
    low = (slot.side == "top") == (slot.role != "mark2")
    return (x_min + x_max) / 2, y_min if low else y_max


def _base_point(side: Side, bounds: Bounds) -> Point:
    x_min, y_min, x_max, y_max = bounds
    return (x_min + x_max) / 2, y_max if side == "top" else y_min


def _median_offset(
    pairs: Iterable[tuple[Point, Point]],
) -> Point | None:
    offsets = [(a[0] - r[0], a[1] - r[1]) for a, r in pairs]
    if not offsets:
        return None
    return (
        statistics.median(o[0] for o in offsets),
        statistics.median(o[1] for o in offsets),
    )


def _anchor_xy(anchor: Any) -> Point:
    return anchor.XCoordinate, anchor.YCoordinate


def make_anchor(x: float, y: float) -> Any:
    anchor = ot.Anchor()
    anchor.Format = 1
    anchor.XCoordinate, anchor.YCoordinate = round(x), round(y)
    return anchor


def plan_marks(
    font: TTFont,
    marks: Mapping[str, Side],
    bounds: Callable[[str], Bounds | None],
    roles: Iterable[Role] = ("base", "lig", "mark1", "mark2"),
) -> dict[tuple[int, str], Any]:
    """Each mark's anchor in each slot of its side with one of `roles`,
    keyed (slot, glyph), for the marks the slot does not hold yet.
    """
    result = {}
    roles = set(roles)
    for index, slot in enumerate(slots(font)):
        if slot.role not in roles:
            continue
        held = {glyph for glyph, _ in _existing(slot)}
        mine = [g for g, side in marks.items() if side == slot.side and g not in held]
        offset = _median_offset(
            (_anchor_xy(anchor), _mark_point(slot, box))
            for glyph, anchor in _existing(slot)
            if glyph not in marks and (box := bounds(glyph)) is not None
        )
        if offset is None:
            continue
        for glyph in mine:
            box = bounds(glyph)
            if box is not None:
                x, y = _mark_point(slot, box)
                result[index, glyph] = make_anchor(x + offset[0], y + offset[1])
    return result


def plan_bases(
    font: TTFont,
    bases: Mapping[Side, list[str]],
    letters: set[str],
    bounds: Callable[[str], Bounds | None],
) -> dict[tuple[int, str], Any]:
    """Each unanchored base's anchor in the largest reference subtable of
    each side, keyed (slot, glyph).
    """
    all_slots = slots(font)
    result = {}
    for side, glyphs in bases.items():
        side_slots = [
            (i, s)
            for i, s in enumerate(all_slots)
            if s.role == "base" and s.side == side
        ]
        if not glyphs or not side_slots:
            continue
        index, slot = max(
            side_slots, key=lambda item: len(item[1].subtable.BaseCoverage.glyphs)
        )
        sub = slot.subtable
        offset = _median_offset(
            (_anchor_xy(anchor), _base_point(side, box))
            for glyph, record in zip(
                sub.BaseCoverage.glyphs, sub.BaseArray.BaseRecord, strict=True
            )
            if glyph in letters
            and (anchor := record.BaseAnchor[slot.mark_class]) is not None
            and (box := bounds(glyph)) is not None
        )
        if offset is None:
            continue
        for glyph in glyphs:
            box = bounds(glyph)
            if box is not None:
                x, y = _base_point(side, box)
                result[index, glyph] = make_anchor(x + offset[0], y + offset[1])
    return result


def _insert(
    coverage: Any, records: list[Any], glyph: str, record: Any, font: TTFont
) -> None:
    if glyph in coverage.glyphs:
        return
    pairs = sorted(
        [*zip(coverage.glyphs, records, strict=True), (glyph, record)],
        key=lambda pair: font.getGlyphID(pair[0]),
    )
    coverage.glyphs = [g for g, _ in pairs]
    records[:] = [r for _, r in pairs]


def _register(font: TTFont, lookup: Any, glyph: str) -> None:
    gdef = font["GDEF"].table
    flag = lookup.LookupFlag
    if flag & _USE_MARK_FILTERING_SET:
        coverage = gdef.MarkGlyphSetsDef.Coverage[lookup.MarkFilteringSet]
        if glyph not in coverage.glyphs:
            coverage.glyphs = sorted([*coverage.glyphs, glyph], key=font.getGlyphID)
    if flag & _MARK_ATTACHMENT_TYPE:
        if getattr(gdef, "MarkAttachClassDef", None) is None:
            gdef.MarkAttachClassDef = ot.MarkAttachClassDef()
            gdef.MarkAttachClassDef.classDefs = {}
        classes = gdef.MarkAttachClassDef.classDefs
        wanted = flag >> 8
        if classes.setdefault(glyph, wanted) != wanted:
            raise AnchorError(
                f"{glyph} is in mark attachment class {classes[glyph]}, but a "
                f"lookup it joins filters on class {wanted}"
            )


def _class_def(font: TTFont) -> dict[str, int]:
    gdef = font["GDEF"].table
    if gdef.GlyphClassDef is None:
        gdef.GlyphClassDef = ot.GlyphClassDef()
        gdef.GlyphClassDef.classDefs = {}
    return gdef.GlyphClassDef.classDefs


def attach_marks(
    font: TTFont, marks: Mapping[str, Side], anchors: Mapping[tuple[int, str], Any]
) -> None:
    """Adds each mark to the slots `anchors` has an anchor for, as a GDEF mark."""
    classes = _class_def(font)
    for glyph in marks:
        classes[glyph] = _MARK_GLYPH_CLASS
    for index, slot in enumerate(slots(font)):
        sub = slot.subtable
        for glyph in marks:
            anchor = anchors.get((index, glyph))
            if anchor is None:
                continue
            if slot.role == "mark2":
                record = ot.Mark2Record()
                record.Mark2Anchor = [
                    anchor if c == slot.mark_class else None
                    for c in range(sub.ClassCount)
                ]
                _insert(
                    sub.Mark2Coverage, sub.Mark2Array.Mark2Record, glyph, record, font
                )
                sub.Mark2Array.Mark2Count = len(sub.Mark2Array.Mark2Record)
                _register(font, slot.lookup, glyph)
                continue
            coverage, array = (
                (sub.Mark1Coverage, sub.Mark1Array)
                if slot.role == "mark1"
                else (sub.MarkCoverage, sub.MarkArray)
            )
            record = ot.MarkRecord()
            record.Class, record.MarkAnchor = slot.mark_class, anchor
            _insert(coverage, array.MarkRecord, glyph, record, font)
            array.MarkCount = len(array.MarkRecord)
            _register(font, slot.lookup, glyph)


def attach_bases(font: TTFont, anchors: Mapping[tuple[int, str], Any]) -> None:
    all_slots = slots(font)
    for (index, glyph), anchor in anchors.items():
        slot = all_slots[index]
        sub = slot.subtable
        record = ot.BaseRecord()
        record.BaseAnchor = [
            anchor if c == slot.mark_class else None for c in range(sub.ClassCount)
        ]
        _insert(sub.BaseCoverage, sub.BaseArray.BaseRecord, glyph, record, font)
        sub.BaseArray.BaseCount = len(sub.BaseArray.BaseRecord)


def clear_stacks(font: TTFont, glyphs: set[str], clearance: float) -> None:
    """Sets the height of every anchor among `glyphs` in the reference
    mark-to-mark subtables from its mark's ink, so that any mark stacked on
    another clears it by `clearance`: a mark2 anchor sits `clearance` beyond
    its ink's far edge and a mark1 anchor on its ink's near edge.
    """
    bounds = glyph_bounds(font.getGlyphSet())
    for slot in slots(font):
        sub = slot.subtable
        top = slot.side == "top"
        if slot.role == "mark2":
            for glyph, record in zip(
                sub.Mark2Coverage.glyphs, sub.Mark2Array.Mark2Record, strict=True
            ):
                anchor = record.Mark2Anchor[slot.mark_class]
                box = bounds(glyph)
                if anchor is None or glyph not in glyphs or box is None:
                    continue
                y = box[3] + clearance if top else box[1] - clearance
                record.Mark2Anchor[slot.mark_class] = make_anchor(anchor.XCoordinate, y)
        elif slot.role == "mark1":
            for glyph, record in zip(
                sub.Mark1Coverage.glyphs, sub.Mark1Array.MarkRecord, strict=True
            ):
                box = bounds(glyph)
                if (
                    record.Class != slot.mark_class
                    or glyph not in glyphs
                    or box is None
                ):
                    continue
                y = box[1] if top else box[3]
                record.MarkAnchor = make_anchor(record.MarkAnchor.XCoordinate, y)


def mark_sides(font: TTFont) -> dict[int, Side]:
    """The side of each cmap Arabic mark: the side whose reference subtable
    positions it, else the side its combining class puts it.
    """
    placed: dict[Side, set[str]] = {"top": set(), "bottom": set()}
    for slot in slots(font):
        if slot.role == "base":
            placed[slot.side] |= _class_marks(slot)
    result: dict[int, Side] = {}
    for cp, glyph in (font.getBestCmap() or {}).items():
        if not is_arabic_mark(cp):
            continue
        sides: list[Side] = [s for s in SIDES if glyph in placed[s]]
        result[cp] = sides[0] if len(sides) == 1 else placement(cp)
    return result


def side_marks(font: TTFont) -> dict[Side, dict[int, str]]:
    """The cmap's Arabic marks by side, as {codepoint: glyph}."""
    cmap = font.getBestCmap() or {}
    result: dict[Side, dict[int, str]] = {"top": {}, "bottom": {}}
    for cp, side in sorted(mark_sides(font).items()):
        result[side][cp] = cmap[cp]
    return result


def _same_keys(
    planned: Mapping[float, Mapping[tuple[int, str], Any]], default: float, what: str
) -> None:
    wanted = set(planned[default])
    for location, found in planned.items():
        missing = sorted(glyph for _, glyph in wanted - set(found))
        if missing:
            raise AnchorError(
                f"the wght {location:g} master cannot anchor {what} "
                f"{', '.join(missing)} as the default master does"
            )


def anchor_masters(
    masters: Mapping[float, TTFont], default: float, clearance_em: float
) -> None:
    """Runs all three steps on every master, deciding membership on `default`.

    `clearance_em` is the gap, in em, a moved mark keeps from the ink it was
    moved off, whether a letter's or the mark it stacks on.
    """
    reference = masters[default]
    marks = stray_marks(reference)
    letters = shaped_letters(reference, Shaper.of(reference))
    bases = unanchored_bases(reference, letters.glyphs)
    bounds = {w: glyph_bounds(m.getGlyphSet()) for w, m in masters.items()}
    mark_plans = {w: plan_marks(m, marks, bounds[w]) for w, m in masters.items()}
    _same_keys(mark_plans, default, "marks")
    for location, master in masters.items():
        attach_marks(master, marks, mark_plans[location])
    sides = {
        glyph: side
        for side, found in side_marks(reference).items()
        for glyph in found.values()
    }
    stack_plans = {
        w: plan_marks(m, sides, bounds[w], ("mark1", "mark2"))
        for w, m in masters.items()
    }
    _same_keys(stack_plans, default, "marks in stacks")
    for location, master in masters.items():
        attach_marks(master, sides, stack_plans[location])
    base_plans = {
        w: plan_bases(m, bases, letters.glyphs, bounds[w]) for w, m in masters.items()
    }
    _same_keys(base_plans, default, "letters")
    stacking = (
        letters.marks
        | set(marks)
        | {glyph for side in side_marks(reference).values() for glyph in side.values()}
    )
    for location, master in masters.items():
        attach_bases(master, base_plans[location])
        clearance = clearance_em * table(master, "head").unitsPerEm
        clear_stacks(master, stacking, clearance)
