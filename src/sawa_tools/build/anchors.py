"""Makes every Arabic mark follow its letter and clear its ink, per master.

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
3. Clearance: where HarfBuzz puts a cmap mark over a letter's ink (the
   letter glyph and any dots or signs it is decomposed into), a contextual
   adjustment appended after every mark lookup moves the mark away until it
   clears that ink by the family's mark clearance. Before that, every
   mark-to-mark anchor moves out until the marks that stack on it clear its
   ink by the same clearance.

Which glyphs join and which marks move where is decided once for all masters, so
the masters keep one anchor and lookup structure; only the values differ.
"""

from __future__ import annotations

import statistics
import unicodedata
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Literal

from fontTools.otlLib.builder import buildValue
from fontTools.pens.boundsPen import BoundsPen
from fontTools.ttLib.tables import otTables as _otTables

from sawa_tools.build import ink
from sawa_tools.build.harfbuzz import Placed, Shaper
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
ClearanceKey = tuple[Side, tuple[str, ...], str, str]

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
_Y_PLACEMENT = 0x0002
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


@dataclass(frozen=True)
class Clearance:
    """Signed y shifts keyed (side, letter sequence, mark), and per side the
    marks the clearance lookup must see rather than skip: the side's cmap
    marks and the dots and signs letters are decomposed into on that side.
    A letter sequence is the letter glyph and those of its dots and signs on
    the mark's side, in logical order.
    """

    shifts: dict[ClearanceKey, float]
    members: dict[Side, set[str]]


def _stack_anchors(
    font: TTFont,
) -> tuple[dict[Side, dict[str, Point]], dict[Side, dict[str, Point]]]:
    """Per side, each mark's mark2 and mark1 anchor in the first reference
    mark-to-mark subtable that has one.
    """
    parents: dict[Side, dict[str, Point]] = {"top": {}, "bottom": {}}
    children: dict[Side, dict[str, Point]] = {"top": {}, "bottom": {}}
    for slot in slots(font):
        if slot.role in ("mark1", "mark2"):
            found = parents if slot.role == "mark2" else children
            for glyph, anchor in _existing(slot):
                found[slot.side].setdefault(glyph, _anchor_xy(anchor))
    return parents, children


def clearance_shifts(font: TTFont, letters: Letters, clearance_em: float) -> Clearance:
    """How far each cmap mark must move off each letter it overlaps, from
    HarfBuzz shaping each letter context with it, keyed with no child; and
    how far it must move, with the mark stacked on it, where that child mark
    would overlap the letter, keyed with the child.
    """
    shaper = Shaper.of(font)
    upem = table(font, "head").unitsPerEm
    clearance = clearance_em * upem
    step = upem / 250
    order = font.getGlyphOrder()
    classes = _glyph_classes(font)
    marks_by_side = side_marks(font)
    members: dict[Side, set[str]] = {
        side: set(marks.values()) for side, marks in marks_by_side.items()
    }
    shifts: dict[ClearanceKey, float] = {}
    placed: list[tuple[Side, tuple[str, ...], ink.Filled, Any, Any]] = []
    filled: dict[tuple[tuple[int, float, float], ...], ink.Filled] = {}
    for side, marks in marks_by_side.items():
        for text, index in letters.contexts:
            for cp in marks:
                letter, added = shaper.split(text, index, chr(cp))
                bases = [
                    g for g in letter if classes.get(order[g.gid]) != _MARK_GLYPH_CLASS
                ]
                if len(bases) != 1 or len(added) != 1:
                    continue
                base_box = shaper.box(bases)
                sequence = []
                for glyph in letter:
                    own = shaper.box([glyph])
                    if glyph is bases[0]:
                        sequence.append(order[glyph.gid])
                    elif own is not None and base_box is not None:
                        above = (own[1] + own[3]) > (base_box[1] + base_box[3])
                        if above == (side == "top"):
                            members[side].add(order[glyph.gid])
                            sequence.append(order[glyph.gid])
                letter_box, mark_box = shaper.box(letter), shaper.box(added)
                if letter_box is None or mark_box is None:
                    continue
                shape = tuple((g.gid, g.x, g.y) for g in letter)
                if shape not in filled:
                    filled[shape] = ink.Filled(shaper.edges(letter), upem / 1000)
                letter_ink = filled[shape]
                placed.append((side, tuple(sequence), letter_ink, letter_box, added[0]))
                if ink.box_gap(letter_box, mark_box) > 0:
                    continue
                letter_edges, mark_edges = letter_ink.edges, shaper.edges(added)
                if not letter_ink.overlaps(mark_edges, 0):
                    continue
                amount = ink.lift(letter_edges, mark_edges, side, clearance, step)
                key = (side, tuple(sequence), order[added[0].gid], "")
                shifts[key] = max(shifts.get(key, 0.0), amount)
    parents, children = _stack_anchors(font)
    for side, sequence, letter_ink, letter_box, mark in placed:
        name = order[mark.gid]
        parent = parents[side].get(name)
        if parent is None:
            continue
        single = shifts.get((side, sequence, name, ""), 0.0)
        rise = single if side == "top" else -single
        for child, child_anchor in children[side].items():
            if child == name or child not in members[side]:
                continue
            stacked = Placed(
                font.getGlyphID(child),
                mark.x + parent[0] - child_anchor[0],
                mark.y + rise + parent[1] - child_anchor[1],
                mark.cluster,
            )
            child_box = shaper.box([stacked])
            if child_box is None or ink.box_gap(letter_box, child_box) > 0:
                continue
            child_edges = shaper.edges([stacked])
            if not letter_ink.overlaps(child_edges, 0):
                continue
            lift = ink.lift(letter_ink.edges, child_edges, side, clearance, step)
            key = (side, sequence, name, child)
            shifts[key] = max(shifts.get(key, 0.0), single + lift)
    return Clearance(
        {key: amount if key[0] == "top" else -amount for key, amount in shifts.items()},
        members,
    )


def _filtering_set(font: TTFont, glyphs: Iterable[str]) -> int:
    gdef = font["GDEF"].table
    if getattr(gdef, "MarkGlyphSetsDef", None) is None:
        gdef.MarkGlyphSetsDef = ot.MarkGlyphSetsDef()
        gdef.MarkGlyphSetsDef.MarkSetTableFormat = 1
        gdef.MarkGlyphSetsDef.Coverage = []
    gdef.Version = max(gdef.Version, _GDEF_MARK_SETS_VERSION)
    coverage = ot.Coverage()
    coverage.glyphs = sorted(set(glyphs), key=font.getGlyphID)
    gdef.MarkGlyphSetsDef.Coverage.append(coverage)
    gdef.MarkGlyphSetsDef.MarkSetCount = len(gdef.MarkGlyphSetsDef.Coverage)
    return gdef.MarkGlyphSetsDef.MarkSetCount - 1


def _coverage(font: TTFont, glyphs: Iterable[str]) -> Any:
    coverage = ot.Coverage()
    coverage.glyphs = sorted(set(glyphs), key=font.getGlyphID)
    return coverage


# Keeps each contextual lookup's subtable offsets within 16 bits.
_SEQUENCES_PER_LOOKUP = 40


def _single_pos(font: TTFont, values: Mapping[str, float]) -> Any:
    """A lookup moving each glyph in `values` up by its value."""
    sub = ot.SinglePos()
    sub.Format = 2
    sub.Coverage = _coverage(font, values)
    sub.ValueFormat = _Y_PLACEMENT
    sub.Value = [
        buildValue({"YPlacement": round(values[glyph])})
        for glyph in sub.Coverage.glyphs
    ]
    sub.ValueCount = len(sub.Value)
    return _lookup(1, 0, [sub])


def _lookup(kind: int, flag: int, subtables: list[Any]) -> Any:
    lookup = ot.Lookup()
    lookup.LookupType, lookup.LookupFlag = kind, flag
    lookup.SubTable = subtables
    lookup.SubTableCount = len(subtables)
    return lookup


def _plain_last(item: tuple[str, Any]) -> tuple[bool, str]:
    return item[0] == "", item[0]


def _chain_rule(
    font: TTFont,
    sequence: tuple[str, ...],
    marks: Iterable[str],
    index: int,
    child: str | None = None,
) -> Any:
    """Matches `sequence`, then one of `marks`, then `child` if given, and
    moves the mark through lookup `index`.
    """
    sub = ot.ChainContextPos()
    sub.Format = 3
    sub.BacktrackGlyphCount = 0
    sub.BacktrackCoverage = []
    sub.LookAheadCoverage = [] if child is None else [_coverage(font, [child])]
    sub.LookAheadGlyphCount = len(sub.LookAheadCoverage)
    sub.InputCoverage = [_coverage(font, [g]) for g in sequence] + [
        _coverage(font, marks)
    ]
    sub.InputGlyphCount = len(sub.InputCoverage)
    record = ot.PosLookupRecord()
    record.SequenceIndex, record.LookupListIndex = len(sequence), index
    sub.PosLookupRecord = [record]
    sub.PosCount = 1
    return sub


def _restack(font: TTFont, sub: Any, parents: set[str]) -> Any:
    """A copy of mark-to-mark subtable `sub` keeping only `parents` as mark2."""
    copy = ot.MarkMarkPos()
    copy.Format = 1
    copy.Mark1Coverage = _coverage(font, sub.Mark1Coverage.glyphs)
    copy.Mark1Array = sub.Mark1Array
    copy.ClassCount = sub.ClassCount
    kept = [
        (g, r)
        for g, r in zip(
            sub.Mark2Coverage.glyphs, sub.Mark2Array.Mark2Record, strict=True
        )
        if g in parents
    ]
    copy.Mark2Coverage = _coverage(font, [g for g, _ in kept])
    copy.Mark2Array = ot.Mark2Array()
    copy.Mark2Array.Mark2Record = [r for _, r in kept]
    copy.Mark2Array.Mark2Count = len(kept)
    return copy


def add_clearance(
    font: TTFont,
    shifts: Mapping[ClearanceKey, float],
    members: Mapping[Side, set[str]],
) -> None:
    """Appends, per side, to every `mark` feature after every lookup there:
    contextual lookups that move each listed mark by its shift where it
    follows its letter sequence, then a copy of the side's mark-to-mark
    lookups that stacks marks again on the marks just moved.

    HarfBuzz fixes a stacked mark's offset from its parent's when the
    mark-to-mark lookup applies, so a moved mark would leave its stack
    behind. The copy sees only the side's cmap marks, so it cannot pull a
    moved mark back onto the dots or signs of its letter. The contextual
    lookups see only `members` of the side among marks, so a letter sequence
    matches whatever the other side carries.
    """
    gpos = table(font, "GPOS").table
    lookups = gpos.LookupList.Lookup
    added = []
    cmap_marks = side_marks(font)
    for side in ("top", "bottom"):
        by_sequence: dict[tuple[str, ...], dict[str, dict[str, float]]] = {}
        for (s, sequence, mark, child), shift in shifts.items():
            if s == side:
                by_child = by_sequence.setdefault(sequence, {})
                by_child.setdefault(child, {})[mark] = shift
        if not by_sequence:
            continue
        filtering = _filtering_set(font, members[side])
        sequences = sorted(by_sequence.items())
        for start in range(0, len(sequences), _SEQUENCES_PER_LOOKUP):
            rules = []
            for sequence, by_child in sequences[start : start + _SEQUENCES_PER_LOOKUP]:
                # A mark's rules with a child come first, being the more
                # specific; all of a sequence's rules share one contextual
                # lookup, so no mark matches twice.
                for child, values in sorted(by_child.items(), key=_plain_last):
                    lookups.append(_single_pos(font, values))
                    rules.append(
                        _chain_rule(
                            font, sequence, values, len(lookups) - 1, child or None
                        )
                    )
            chain = _lookup(8, _USE_MARK_FILTERING_SET, rules)
            chain.MarkFilteringSet = filtering
            lookups.append(chain)
            added.append(len(lookups) - 1)
        parents = set(cmap_marks[side].values())
        restack = _lookup(
            6,
            _USE_MARK_FILTERING_SET,
            [
                _restack(font, slot.subtable, parents)
                for slot in slots(font)
                if slot.side == side and slot.role == "mark1"
            ],
        )
        restack.MarkFilteringSet = _filtering_set(font, parents)
        lookups.append(restack)
        added.append(len(lookups) - 1)
    gpos.LookupList.LookupCount = len(lookups)
    for record in gpos.FeatureList.FeatureRecord:
        if record.FeatureTag == "mark":
            record.Feature.LookupListIndex += added
            record.Feature.LookupCount = len(record.Feature.LookupListIndex)


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
    found = {w: clearance_shifts(m, letters, clearance_em) for w, m in masters.items()}
    keys = sorted({key for c in found.values() for key in c.shifts})
    members: dict[Side, set[str]] = {
        side: set().union(*(c.members[side] for c in found.values()))
        for side in ("top", "bottom")
    }
    for location, master in masters.items():
        own = found[location].shifts
        # A mark moved for its child in another master still moves at least
        # as far as it does alone here.
        shifts = {key: own.get(key, own.get((*key[:3], ""), 0.0)) for key in keys}
        add_clearance(master, shifts, members)
