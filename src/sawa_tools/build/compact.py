"""Moves Arabic marks as close to their letters as their ink allows, per master.

Runs on the anchored static masters (anchors.py) before varLib.build. Marks
are never scaled or redrawn: only anchors move, plus a few contextual
adjustments where one anchor cannot suit every context. Every move keeps
`gap` between the moved mark's ink and the ink it moves towards, measured on
the master's own outlines.

1. Own classes: each mark in `own_class` gets a mark class of its own in
   every Arabic mark subtable, so that every letter and mark carries a
   separate anchor for it.
2. Added stacks: each (mark, on) pair gets a mark-to-mark anchor on `on`,
   so that the mark stacks on it instead of landing on the same spot.
3. Stacks: every mark-to-mark anchor moves until the marks that can stack on
   it sit `gap` from its ink.
4. Letters: a top anchor above `top.ceiling` moves down, and a bottom anchor
   whose marks reach below `bottom.floor` moves up, until the marks that
   can land on the letter sit `gap` from its ink; any anchor whose marks
   are closer than `gap` moves away. Moves are bounded by `max_move`.
5. Neighbours: where a lowered stack now comes within the clearance of a
   neighbouring cluster, its letter anchor gives back up to what step 4
   took.
6. Contexts: every contact left in the everyday view of the corpus (only
   everyday tashkeel, corpus.py) gets a contextual adjustment, appended
   after every mark lookup, that moves the mark and the marks stacked on
   it clear, sideways or vertically, whichever is shorter.

Dots and signs that letters decompose into are marks the harakat stack on,
so step 3 keeps the same gap from a dot as step 4 keeps from a letter.

Which glyphs join which subtable is decided alike for all masters, and
every master gets the contexts any master needs, so that varLib sees one
structure; anchor values and context offsets are each master's own. The
steps run one process per master.
"""

from __future__ import annotations

import copy
import hashlib
import io
import math
import re
import time
import unicodedata
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass, field, replace
from itertools import pairwise
from typing import TYPE_CHECKING, Any, Literal

from fontTools.otlLib.builder import buildValue
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables import otTables as _otTables

from sawa_tools.build.anchors import (
    ARABIC_BLOCKS,
    make_anchor,
    shaped_letters,
    table,
)
from sawa_tools.build.clearance import INF, Ink, approach, boxes_apart, moved
from sawa_tools.build.harfbuzz import Shaper
from sawa_tools.build.lines import InkTable, Placed, hb_font, mark_glyphs, shape
from sawa_tools.corpus import everyday

if TYPE_CHECKING:
    from collections.abc import Collection, Iterable, Iterator, Mapping, Sequence

    import numpy as np
    from numpy.typing import NDArray

    from sawa_tools.build.masters import MastersCache

ot: Any = _otTables

Side = Literal["top", "bottom"]

_MARK_BASE, _MARK_LIG, _MARK_MARK, _EXTENSION = 4, 5, 6, 9
_CHAIN_CONTEXT, _SINGLE = 8, 1
_X_PLACEMENT, _Y_PLACEMENT = 0x0001, 0x0002
_USE_MARK_FILTERING_SET = 0x0010

# Keeps each contextual lookup's subtable offsets within 16 bits.
_RULES_PER_LOOKUP = 40


class CompactError(Exception):
    """Raised when the masters cannot all be compacted the same way."""


@dataclass(frozen=True)
class Limits:
    ceiling: float
    max_move: float
    max_shift: float = 0.0


@dataclass(frozen=True)
class Params:
    """Step parameters, in em except where noted."""

    gap: float
    clearance: float
    sample_step: float
    own_class: tuple[int, ...]
    top: Limits
    bottom: Limits
    stack_max_move: float
    stack_max_shift: float
    add_stacks: tuple[tuple[int, int], ...]
    exempt: str | None
    max_shift: float
    # (codepoints, shift) for marks that may move further sideways.
    mark_shifts: tuple[tuple[tuple[int, ...], float], ...]
    max_lift: float
    vertical_cost: float
    quantum: float
    passes: int
    patience: int


def parse_params(raw: Mapping[str, Any], clearance: float) -> Params:
    """Parameters from a family's merged `compaction` config."""
    from sawa_tools.checks.marks import _parse_codepoints

    def cps(specs: Iterable[str]) -> tuple[int, ...]:
        return tuple(cp for spec in specs for cp in _parse_codepoints(spec))

    if float(raw["gap"]) <= clearance:
        raise ValueError(f"gap {raw['gap']} is not above the clearance {clearance}")

    residual = raw["contexts"]
    return Params(
        gap=float(raw["gap"]),
        clearance=clearance,
        sample_step=float(raw["sampleStep"]),
        own_class=cps(raw["ownClass"]),
        top=Limits(
            float(raw["top"]["ceiling"]),
            float(raw["top"]["maxMove"]),
            float(raw["top"].get("maxShift", 0)),
        ),
        bottom=Limits(
            float(raw["bottom"]["floor"]),
            float(raw["bottom"]["maxMove"]),
            float(raw["bottom"].get("maxShift", 0)),
        ),
        stack_max_move=float(raw["stacks"]["maxMove"]),
        stack_max_shift=float(raw["stacks"].get("maxShift", 0)),
        add_stacks=tuple(
            (cps([s["mark"]])[0], cps([s["on"]])[0]) for s in raw.get("addStacks", [])
        ),
        exempt=raw.get("exempt"),
        max_shift=float(residual["maxShift"]),
        mark_shifts=tuple(
            (cps(entry["codepoints"]), float(entry["maxShift"]))
            for entry in residual.get("markShifts", [])
        ),
        max_lift=float(residual["maxLift"]),
        vertical_cost=float(residual["verticalCost"]),
        quantum=float(residual["quantum"]),
        passes=int(residual["passes"]),
        patience=int(residual["patience"]),
    )


def merged(defaults: Mapping[str, Any], override: Mapping[str, Any]) -> dict[str, Any]:
    """`defaults` updated by `override`, nested objects merged key by key."""
    result = copy.deepcopy(dict(defaults))
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = merged(result[key], value)
        else:
            result[key] = copy.deepcopy(value)
    return result


def subtables(font: TTFont) -> Iterator[tuple[int, Any, int, Any]]:
    """(lookup index, lookup, type, subtable) for every GPOS subtable."""
    for index, lookup in enumerate(table(font, "GPOS").table.LookupList.Lookup):
        for sub in lookup.SubTable:
            if lookup.LookupType == _EXTENSION:
                yield index, lookup, sub.ExtensionLookupType, sub.ExtSubTable
            else:
                yield index, lookup, lookup.LookupType, sub


def _mark_records(kind: int, sub: Any) -> tuple[list[str], list[Any]]:
    if kind == _MARK_MARK:
        return sub.Mark1Coverage.glyphs, sub.Mark1Array.MarkRecord
    return sub.MarkCoverage.glyphs, sub.MarkArray.MarkRecord


def _anchor_lists(kind: int, sub: Any) -> list[list[Any]]:
    """Every per-class anchor list of a mark subtable's bases, ligature
    components or mark2 glyphs.
    """
    if kind == _MARK_BASE:
        return [r.BaseAnchor for r in sub.BaseArray.BaseRecord]
    if kind == _MARK_LIG:
        return [
            c.LigatureAnchor
            for attach in sub.LigatureArray.LigatureAttach
            for c in attach.ComponentRecord
        ]
    return [r.Mark2Anchor for r in sub.Mark2Array.Mark2Record]


def _anchored(kind: int, sub: Any) -> Iterator[tuple[str, int, list[Any]]]:
    """(glyph, component, anchor list) for each base, component or mark2."""
    if kind == _MARK_BASE:
        for glyph, record in zip(
            sub.BaseCoverage.glyphs, sub.BaseArray.BaseRecord, strict=True
        ):
            yield glyph, 0, record.BaseAnchor
    elif kind == _MARK_LIG:
        for glyph, attach in zip(
            sub.LigatureCoverage.glyphs, sub.LigatureArray.LigatureAttach, strict=True
        ):
            for component, record in enumerate(attach.ComponentRecord):
                yield glyph, component, record.LigatureAnchor
    else:
        for glyph, record in zip(
            sub.Mark2Coverage.glyphs, sub.Mark2Array.Mark2Record, strict=True
        ):
            yield glyph, 0, record.Mark2Anchor


@dataclass(frozen=True)
class Plan:
    """What steps 1 to 6 decide once for the family, from the default master."""

    arabic_marks: frozenset[str]
    letter_parts: frozenset[str]
    own_class: frozenset[str]
    # (base, mark) and (mark2, mark1) pairs HarfBuzz can produce.
    on_base: frozenset[tuple[str, str]]
    on_mark: frozenset[tuple[str, str]]
    add_stacks: tuple[tuple[str, str], ...]


def _cmap_glyphs(font: TTFont, codepoints: Iterable[int]) -> list[str]:
    cmap = font.getBestCmap() or {}
    return [cmap[cp] for cp in codepoints if cp in cmap]


def _is_arabic_mark(cp: int) -> bool:
    return unicodedata.category(chr(cp)) == "Mn" and any(
        low <= cp <= high for low, high in ARABIC_BLOCKS
    )


def plan(font: TTFont, params: Params, lines: Sequence[str]) -> Plan:
    """Decides membership on the default master, from shaping every Arabic
    letter alone and joined, pairs of `own_class` marks, and the corpus.
    """
    data = _bytes(font)
    shaper = Shaper(data)
    letters = shaped_letters(font, shaper)
    marks = mark_glyphs(font)
    order = font.getGlyphOrder()
    cmap = font.getBestCmap() or {}
    arabic = {g for cp, g in cmap.items() if _is_arabic_mark(cp)} | letters.marks
    own = set(_cmap_glyphs(font, params.own_class))
    # Ligatures of two own-class marks, such as shadda with fatha.
    beh = chr(0x0628)
    for first in params.own_class:
        for second in params.own_class:
            glyphs = [
                order[g.gid] for g in shaper.shape(beh + chr(first) + chr(second))
            ]
            found = [g for g in glyphs if g in marks and g not in letters.marks]
            if len(found) == 1:
                own.add(found[0])
    own |= letters.marks
    index = AttachIndex(font)
    on_base: set[tuple[str, str]] = set()
    on_mark: set[tuple[str, str]] = set()
    font_hb = hb_font(data)
    samples = [text for text, _ in letters.contexts] + list(lines)
    for text in samples:
        placed = shape(font_hb, text)
        for glyph in placed:
            if order[glyph.gid] in marks and glyph.rtl:
                arabic.add(order[glyph.gid])
        for parent, child, kind in index.attachments(placed, order):
            (on_mark if kind == _MARK_MARK else on_base).add((parent, child))
    stacks = tuple(
        (cmap[a], cmap[b]) for a, b in params.add_stacks if a in cmap and b in cmap
    )
    return Plan(
        arabic_marks=frozenset(arabic),
        letter_parts=frozenset(letters.marks),
        own_class=frozenset(own),
        on_base=frozenset(on_base),
        on_mark=frozenset(on_mark | {(b, a) for a, b in stacks}),
        add_stacks=stacks,
    )


def _bytes(font: TTFont) -> bytes:
    buffer = io.BytesIO()
    copy.deepcopy(font).save(buffer)
    return buffer.getvalue()


class AttachIndex:
    """Which subtable positions each mark of a shaped line, and on what.

    HarfBuzz reports only final positions, so an attachment is recognised
    by its geometry: the mark sits exactly where the anchor pair of some
    mark subtable puts it on the glyph before it. Of several, the last
    lookup wins, as it would in HarfBuzz.
    """

    def __init__(self, font: TTFont) -> None:
        self.order = font.getGlyphOrder()
        self.marks = mark_glyphs(font)
        self.gid = {g: i for i, g in enumerate(self.order)}
        gdef = table(font, "GDEF").table
        sets = (
            [set(c.glyphs) for c in gdef.MarkGlyphSetsDef.Coverage]
            if getattr(gdef, "MarkGlyphSetsDef", None)
            else []
        )
        # (lookup, kind, sub, mark records by glyph, anchors by glyph, filter)
        self.entries: list[tuple[int, int, Any, dict, dict, set[str] | None]] = []
        for li, lookup, kind, sub in subtables(font):
            if kind not in (_MARK_BASE, _MARK_LIG, _MARK_MARK):
                continue
            names, records = _mark_records(kind, sub)
            by_glyph = dict(zip(names, records, strict=True))
            anchors: dict[str, list[list[Any]]] = defaultdict(list)
            for glyph, _, lst in _anchored(kind, sub):
                anchors[glyph].append(lst)
            filtering = (
                sets[lookup.MarkFilteringSet]
                if lookup.LookupFlag & _USE_MARK_FILTERING_SET
                else None
            )
            self.entries.append((li, kind, sub, by_glyph, dict(anchors), filtering))

    def parent(
        self, placed: Sequence[Placed], i: int
    ) -> tuple[int, int, int, Any, int, int] | None:
        """(parent index, lookup, kind, subtable, component, class) of mark i."""
        mark = placed[i]
        name = self.order[mark.gid]
        best = None
        for li, kind, sub, by_glyph, anchors, filtering in self.entries:
            record = by_glyph.get(name)
            if record is None:
                continue
            j = i - 1
            if kind == _MARK_MARK:
                while (
                    j >= 0
                    and self.order[placed[j].gid] in self.marks
                    and filtering is not None
                    and self.order[placed[j].gid] not in filtering
                ):
                    j -= 1
                if j < 0 or self.order[placed[j].gid] not in self.marks:
                    continue
            else:
                while j >= 0 and self.order[placed[j].gid] in self.marks:
                    j -= 1
                if j < 0:
                    continue
            other = placed[j]
            if other.run != mark.run:
                continue
            for component, lst in enumerate(anchors.get(self.order[other.gid], [])):
                a = lst[record.Class] if record.Class < len(lst) else None
                if a is None:
                    continue
                m = record.MarkAnchor
                dx = other.x + a.XCoordinate - m.XCoordinate - mark.x
                dy = other.y + a.YCoordinate - m.YCoordinate - mark.y
                if dy == 0 and dx == 0:
                    best = (j, li, kind, sub, component, record.Class)
        return best

    def attachments(
        self, placed: Sequence[Placed], order: Sequence[str]
    ) -> Iterator[tuple[str, str, int]]:
        for i, glyph in enumerate(placed):
            if order[glyph.gid] not in self.marks:
                continue
            found = self.parent(placed, i)
            if found is not None:
                yield order[placed[found[0]].gid], order[glyph.gid], found[2]


class Master:
    """One static master and its glyphs' ink."""

    def __init__(self, font: TTFont, params: Params, plan: Plan) -> None:
        self.font = font
        self.params = params
        self.plan = plan
        self.upem = table(font, "head").unitsPerEm
        self.gap = params.gap * self.upem
        self.glyphset = font.getGlyphSet()
        self.step = params.sample_step * self.upem
        self.exempt = re.compile(params.exempt) if params.exempt else None
        self._inks: dict[str, Ink] = {}
        self.log: defaultdict[str, int] = defaultdict(int)

    def ink(self, glyph: str) -> Ink:
        found = self._inks.get(glyph)
        if found is None:
            found = self._inks[glyph] = Ink.drawn(
                lambda pen: self.glyphset[glyph].draw(pen), self.step, self.glyphset
            )
        return found

    def side(self, glyph: str) -> Side | None:
        box = self.ink(glyph).box
        if box is None:
            return None
        if box[1] >= 0.25 * self.upem:
            return "top"
        if box[3] <= 0:
            return "bottom"
        return None

    def movable(self, glyph: str) -> bool:
        return bool(self.ink(glyph)) and not (
            self.exempt is not None and self.exempt.search(glyph)
        )

    def arabic(self, kind: int, sub: Any) -> bool:
        names, _ = _mark_records(kind, sub)
        return any(n in self.plan.arabic_marks for n in names)


def split_classes(master: Master) -> None:
    """Step 1."""
    for _, _, kind, sub in subtables(master.font):
        if kind not in (_MARK_BASE, _MARK_LIG, _MARK_MARK) or not master.arabic(
            kind, sub
        ):
            continue
        names, records = _mark_records(kind, sub)
        sizes: defaultdict[int, int] = defaultdict(int)
        for record in records:
            sizes[record.Class] += 1
        moved = []
        for name, record in zip(names, records, strict=True):
            if name in master.plan.own_class and sizes[record.Class] > 1:
                sizes[record.Class] -= 1
                moved.append(record.Class)
                record.Class = sub.ClassCount + len(moved) - 1
        if not moved:
            continue
        for lst in _anchor_lists(kind, sub):
            lst.extend(
                None if lst[old] is None else copy.deepcopy(lst[old]) for old in moved
            )
        sub.ClassCount += len(moved)
        master.log["own classes"] += len(moved)


def _classes(
    master: Master, kind: int, sub: Any
) -> dict[int, tuple[Side, list[tuple[str, Any]]]]:
    """Per mark class: its side, by majority, and its movable marks on it."""
    names, records = _mark_records(kind, sub)
    by_class: defaultdict[int, list[tuple[str, Any]]] = defaultdict(list)
    for name, record in zip(names, records, strict=True):
        by_class[record.Class].append((name, record.MarkAnchor))
    found = {}
    for cls, members in by_class.items():
        sides = [s for n, _ in members if master.movable(n) and (s := master.side(n))]
        if not sides:
            continue
        side = max(set(sides), key=sides.count)
        found[cls] = (
            side,
            [
                (n, a)
                for n, a in members
                if master.movable(n) and master.side(n) == side
            ],
        )
    return found


def _limit(
    master: Master,
    marks: Iterable[tuple[str, Any]],
    anchor: Any,
    obstacle: NDArray[np.float64],
    side: Side,
) -> float:
    """How far the anchor can move towards `obstacle` with all of `marks`
    hung on it; negative when they must move away.
    """
    import numpy as np

    placed = [
        moved(
            master.ink(name).points,
            anchor.XCoordinate - own.XCoordinate,
            anchor.YCoordinate - own.YCoordinate,
        )
        for name, own in marks
    ]
    if not placed:
        return INF
    return approach(
        np.concatenate(placed), obstacle, master.gap, -1 if side == "top" else 1
    )


def _move(room: float | None, eligible: bool, max_move: float) -> int:
    """The move towards the obstacle: negative moves away from it."""
    if room is None or room == INF:
        return 0
    if room < 0:
        return math.floor(room) if -room <= max_move else 0
    return int(min(math.floor(room), max_move)) if eligible else 0


def _fit(
    master: Master,
    marks: Sequence[tuple[str, Any]],
    anchor: Any,
    obstacle: NDArray[np.float64],
    side: Side,
    eligible: bool,
    max_move: float,
    max_shift: float,
) -> tuple[int, int]:
    """The (sideways, towards the obstacle) move of an anchor: of the moves
    that leave its marks `gap` clear of the obstacle, the one that brings
    them closest, each unit sideways counting as half a unit lost. A move
    away counts as negative; with none clearing, no move.
    """
    q = 2 * max(1, round(master.params.quantum * master.upem))
    best: tuple[float, int, int] | None = None
    shifts = [0]
    for k in range(1, int(max_shift * master.upem // q) + 1):
        shifts += [k * q, -k * q]
    for dx in shifts:
        moved_anchor = copy.copy(anchor)
        moved_anchor.XCoordinate = anchor.XCoordinate + dx
        room = _limit(master, marks, moved_anchor, obstacle, side)
        if room < 0 and -room > max_move:
            continue
        step = _move(room, eligible or room < 0, max_move)
        score = step - abs(dx) / 2
        if best is None or score > best[0]:
            best = (score, dx, step)
    return (0, 0) if best is None else (best[1], best[2])


def _mark_shifts(master: Master) -> dict[str, float]:
    """The glyphs `mark_shifts` lets move further sideways, and how far."""
    cmap = master.font.getBestCmap() or {}
    return {
        cmap[cp]: shift
        for cps, shift in master.params.mark_shifts
        for cp in cps
        if cp in cmap
    }


def tighten_stacks(master: Master) -> dict[tuple[int, str, int, int], int]:
    """Step 3. Returns each moved anchor's move towards its mark's ink,
    keyed (lookup, mark2 glyph, 0, class).
    """
    max_move = master.params.stack_max_move * master.upem
    shifts = _mark_shifts(master)
    moves = {}
    for li, _, kind, sub in subtables(master.font):
        if kind != _MARK_MARK or not master.arabic(kind, sub):
            continue
        classes = _classes(master, kind, sub)
        for parent, _, anchors in _anchored(kind, sub):
            if not master.movable(parent):
                continue
            # Dots are drawn wherever their anchors put them, not on their
            # side of the origin as marks are, so they stack on either side.
            own = master.side(parent)
            if own is None and parent not in master.plan.letter_parts:
                continue
            for cls, (side, members) in classes.items():
                anchor = anchors[cls] if cls < len(anchors) else None
                marks = [
                    (n, a)
                    for n, a in members
                    if own in (None, side) and (parent, n) in master.plan.on_mark
                ]
                if anchor is None or not marks:
                    continue
                dx, step = _fit(
                    master,
                    marks,
                    anchor,
                    master.ink(parent).points,
                    side,
                    True,
                    max_move,
                    max(
                        [master.params.stack_max_shift]
                        + [shifts[n] for n, _ in marks if n in shifts]
                    ),
                )
                if step or dx:
                    anchors[cls] = anchor = copy.deepcopy(anchor)
                    anchor.XCoordinate += dx
                    anchor.YCoordinate -= step if side == "top" else -step
                    moves[li, parent, 0, cls] = step
                    master.log["stack anchors"] += 1
    return moves


def fit_letters(master: Master) -> dict[tuple[int, str, int, int], int]:
    """Step 4. Returns each moved anchor's move towards its letter, keyed
    (lookup, glyph, component, class).
    """
    params = master.params
    top_ceiling = params.top.ceiling * master.upem
    bottom_floor = params.bottom.ceiling * master.upem
    moves = {}
    for li, _, kind, sub in subtables(master.font):
        if kind not in (_MARK_BASE, _MARK_LIG) or not master.arabic(kind, sub):
            continue
        classes = _classes(master, kind, sub)
        for base, component, anchors in _anchored(kind, sub):
            points = master.ink(base).points
            for cls, (side, members) in classes.items():
                anchor = anchors[cls] if cls < len(anchors) else None
                marks = [
                    (n, a)
                    for n, a in members
                    if n not in master.plan.letter_parts
                    or (base, n) in master.plan.on_base
                ]
                if anchor is None or not marks:
                    continue
                if side == "top":
                    limits = params.top
                    eligible = anchor.YCoordinate > top_ceiling
                else:
                    limits = params.bottom
                    lowest = min(
                        box[1] + anchor.YCoordinate - a.YCoordinate
                        for n, a in marks
                        if (box := master.ink(n).box) is not None
                    )
                    eligible = lowest < bottom_floor
                dx, step = _fit(
                    master,
                    marks,
                    anchor,
                    points,
                    side,
                    eligible,
                    limits.max_move * master.upem,
                    limits.max_shift if eligible else 0.0,
                )
                if step or dx:
                    anchors[cls] = anchor = copy.deepcopy(anchor)
                    anchor.XCoordinate += dx
                    anchor.YCoordinate += -step if side == "top" else step
                    moves[li, base, component, cls] = step
                    master.log["letter anchors"] += 1
    return moves


def _insert(
    font: TTFont, glyphs: list[str], records: list[Any], glyph: str, record: Any
) -> None:
    gid = font.getGlyphID(glyph)
    at = next(
        (i for i, g in enumerate(glyphs) if font.getGlyphID(g) > gid), len(glyphs)
    )
    glyphs.insert(at, glyph)
    records.insert(at, record)


def add_stacks(master: Master) -> None:
    """Step 2: each pair's mark2 anchor sits over `on`'s ink at the height
    step 3 then tightens.
    """
    gdef = table(master.font, "GDEF").table
    for mark, on in master.plan.add_stacks:
        for _, lookup, kind, sub in subtables(master.font):
            if (
                kind != _MARK_MARK
                or mark not in sub.Mark1Coverage.glyphs
                or on in sub.Mark2Coverage.glyphs
            ):
                continue
            box = master.ink(on).box
            if box is None:
                break
            names, records = _mark_records(kind, sub)
            anchors = []
            for cls in range(sub.ClassCount):
                members = [
                    (n, r.MarkAnchor)
                    for n, r in zip(names, records, strict=True)
                    if r.Class == cls and master.side(n) == "top"
                ]
                if not members:
                    anchors.append(None)
                    continue
                offsets = [
                    a.XCoordinate - (b[0] + b[2]) / 2
                    for n, a in members
                    if (b := master.ink(n).box) is not None
                ]
                x = (box[0] + box[2]) / 2 + sum(offsets) / max(len(offsets), 1)
                anchors.append(make_anchor(x, box[3] + master.gap))
            record = ot.Mark2Record()
            record.Mark2Anchor = anchors
            _insert(
                master.font,
                sub.Mark2Coverage.glyphs,
                sub.Mark2Array.Mark2Record,
                on,
                record,
            )
            sub.Mark2Array.Mark2Count = len(sub.Mark2Array.Mark2Record)
            if lookup.LookupFlag & _USE_MARK_FILTERING_SET:
                coverage = gdef.MarkGlyphSetsDef.Coverage[lookup.MarkFilteringSet]
                if on not in coverage.glyphs:
                    coverage.glyphs = sorted(
                        [*coverage.glyphs, on], key=master.font.getGlyphID
                    )
            master.log["added stacks"] += 1
            break


AnchorKey = tuple[int, str, int, int]


def _anchor_at(font: TTFont, key: AnchorKey) -> tuple[list[Any], int] | None:
    li, glyph, component, cls = key
    for index, _, kind, sub in subtables(font):
        if index != li:
            continue
        for g, c, anchors in _anchored(kind, sub):
            if g == glyph and c == component and cls < len(anchors):
                return anchors, cls
    return None


def _shift_anchor(font: TTFont, key: AnchorKey, dy: int) -> None:
    found = _anchor_at(font, key)
    if found is None or found[0][found[1]] is None:
        raise CompactError(f"no anchor {key}")
    anchors, cls = found
    anchors[cls] = anchor = copy.deepcopy(anchors[cls])
    anchor.YCoordinate += dy


Parent = tuple[int, AnchorKey] | None


@dataclass
class Line:
    """A shaped corpus line, with each mark's attachment parent: its
    position in `placed` and the anchor it hangs on.
    """

    placed: list[Placed]
    parents: list[Parent]


def _structure(index: AttachIndex, placed: list[Placed]) -> list[Parent]:
    found: list[Parent] = [None] * len(placed)
    runs: defaultdict[int, list[int]] = defaultdict(list)
    for position, glyph in enumerate(placed):
        runs[glyph.run].append(position)
    for positions in runs.values():
        run = [placed[p] for p in positions]
        for i, glyph in enumerate(run):
            if index.order[glyph.gid] not in index.marks:
                continue
            parent = index.parent(run, i)
            if parent is not None:
                j, li, _, _, component, cls = parent
                key = (li, index.order[run[j].gid], component, cls)
                found[positions[i]] = (positions[j], key)
    return found


def _subtree(line: Line, root: int) -> list[int]:
    """`root` and every mark stacked on it, in line order."""
    members = {root}
    for position in range(root + 1, len(line.placed)):
        chain, seen = line.parents[position], 0
        while chain is not None and seen < 16:
            if chain[0] in members:
                members.add(position)
                break
            chain, seen = line.parents[chain[0]], seen + 1
    return sorted(members)


def _root(line: Line, position: int) -> int:
    """The mark at the bottom of `position`'s stack, the one hung on a letter."""
    seen = 0
    while seen < 16:
        parent = line.parents[position]
        if parent is None or line.parents[parent[0]] is None:
            return position
        position, seen = parent[0], seen + 1
    return position


def _side_of(master: Master, glyph: str) -> Side:
    side = master.side(glyph)
    return side if side is not None else "top"


@dataclass
class Scanner:
    """Shapes the corpus with one master and measures its contacts.

    Attachments are read from the master itself unless `structures` gives
    them, as for a master whose marks step 6 has moved off their anchors.
    """

    master: Master
    lines: Sequence[str]
    structures: list[list[Parent]] | None = None

    def table(self) -> InkTable:
        font = self.master.font
        gid = {g: i for i, g in enumerate(font.getGlyphOrder())}
        marks = mark_glyphs(font)
        cmap = font.getBestCmap() or {}
        # Hamza and madda are letter parts of alef with hamza or madda, and
        # marks of their own in text, so they are checked either way.
        written = {g for cp, g in cmap.items() if unicodedata.category(chr(cp)) == "Mn"}
        checked = marks - (self.master.plan.letter_parts - written)
        return InkTable(
            hb_font(_bytes(font)),
            self.master.step,
            frozenset(gid[g] for g in marks),
            frozenset(gid[g] for g in checked),
        )

    def shaped(self, table: InkTable) -> Iterator[Line]:
        if self.structures is None:
            index = AttachIndex(self.master.font)
            self.structures = [
                _structure(index, shape(table.font, t)) for t in self.lines
            ]
        for text, parents in zip(self.lines, self.structures, strict=True):
            yield Line(shape(table.font, text), parents)


def _clears(
    table: InkTable,
    line: Line,
    movers: Sequence[int],
    offset: tuple[int, int],
    limit: float,
    against: Iterable[int] | None = None,
) -> bool:
    """Whether the `movers` of `line`, moved by `offset`, clear by `limit`
    every other inked glyph of the line, or those `against`.
    """
    moving = set(movers)
    others = [
        p
        for p in (range(len(line.placed)) if against is None else against)
        if p not in moving
    ]
    for m in movers:
        a = line.placed[m]
        ink = table.ink(a.gid)
        if ink.box is None:
            continue
        moved = replace(a, x=a.x + offset[0], y=a.y + offset[1])
        box = (
            ink.box[0] + moved.x,
            ink.box[1] + moved.y,
            ink.box[2] + moved.x,
            ink.box[3] + moved.y,
        )
        for p in others:
            b = line.placed[p]
            other = table.ink(b.gid).box
            if other is None or boxes_apart(
                box,
                (other[0] + b.x, other[1] + b.y, other[2] + b.x, other[3] + b.y),
                limit,
            ):
                continue
            if table.gap(moved, b, limit) < limit:
                return False
    return True


def _lowered_root(
    line: Line, position: int, remaining: Mapping[AnchorKey, int]
) -> tuple[AnchorKey | None, int]:
    """The nearest anchor up `position`'s attachment chain that steps 3 and
    4 moved towards its ink, and the position of the glyph hung on it.
    """
    chain, seen = position, 0
    while seen < 16:
        parent = line.parents[chain]
        if parent is None:
            return None, position
        if parent[1] in remaining:
            return parent[1], chain
        chain, seen = parent[0], seen + 1
    return None, position


def _key_side(master: Master, key: AnchorKey) -> Side:
    li, _, _, cls = key
    for index, _, kind, sub in subtables(master.font):
        if index == li:
            names, records = _mark_records(kind, sub)
            for name, record in zip(names, records, strict=True):
                if record.Class == cls and (side := master.side(name)):
                    return side
    return "top"


def repair_neighbours(
    master: Master,
    lines: Sequence[str],
    lowered: Mapping[AnchorKey, int],
    passes: int,
) -> None:
    """Step 5: moves back anchors that steps 3 and 4 moved towards their ink,
    where a mark hung on them, or stacked above one, now comes within the
    gap of a neighbouring cluster, by at most what those steps took.
    """
    clearance = master.gap
    step = max(1, round(master.upem / 500))
    remaining = {k: v for k, v in lowered.items() if v > 0}
    order = master.font.getGlyphOrder()
    for _ in range(passes):
        scanner = Scanner(master, lines)
        table = scanner.table()
        need: dict[AnchorKey, int] = {}
        for line in scanner.shaped(table):
            position = {id(g): p for p, g in enumerate(line.placed)}
            for contact in table.contacts([g for g in line.placed if g.rtl], clearance):
                if contact.same_cluster:
                    continue
                i, j = position[id(contact.mark)], position[id(contact.other)]
                options = [(i, j)]
                if contact.other.gid in table.checked:
                    options.append((j, i))
                best: tuple[int, AnchorKey] | None = None
                for mover, obstacle in options:
                    key, root = _lowered_root(line, mover, remaining)
                    if key is None:
                        continue
                    side = _side_of(master, order[line.placed[mover].gid])
                    sign = 1 if side == "top" else -1
                    subtree = _subtree(line, root)
                    cap = remaining[key]
                    rise = cap
                    for r in range(step, cap + step, step):
                        r = min(r, cap)
                        if _clears(
                            table, line, subtree, (0, sign * r), clearance, [obstacle]
                        ):
                            rise = r
                            break
                    if best is None or rise < best[0]:
                        best = (rise, key)
                if best is not None and best[0] > need.get(best[1], 0):
                    need[best[1]] = best[0]
        if not need:
            break
        for key, rise in need.items():
            side = _key_side(master, key)
            _shift_anchor(master.font, key, rise if side == "top" else -rise)
            remaining[key] -= rise
            if remaining[key] <= 0:
                del remaining[key]
            master.log["neighbour repairs"] += 1


# A contextual adjustment matches a glyph sequence, in logical order, and
# moves some of its positions each by its own offset.
Context = tuple[str, ...]
Move = tuple[int, int]
Rules = dict[Context, dict[int, Move]]


def _span(line: Line, positions: Iterable[int]) -> tuple[int, int] | None:
    """The first and last line position of the clusters of `positions` and
    those between them, when they share one run. A run's glyphs are
    contiguous in `placed`, in logical order.
    """
    wanted = [line.placed[p] for p in positions]
    if len({g.run for g in wanted}) != 1:
        return None
    run = wanted[0].run
    lo = min(g.cluster for g in wanted)
    hi = max(g.cluster for g in wanted)
    inside = [
        p for p, g in enumerate(line.placed) if g.run == run and lo <= g.cluster <= hi
    ]
    return min(inside), max(inside)


def _sign(value: int) -> int:
    return (value > 0) - (value < 0)


def _ink_range(
    table: InkTable, line: Line, movers: Iterable[int]
) -> tuple[float, float]:
    top, bottom = -INF, INF
    for m in movers:
        g = line.placed[m]
        box = table.ink(g.gid).box
        if box is not None:
            top = max(top, box[3] + g.y)
            bottom = min(bottom, box[1] + g.y)
    return top, bottom


@dataclass(frozen=True)
class _Search:
    """One candidate move: `subtree` (line positions) moving together, at
    `offsets` in their context already, `away` the direction off the
    letter, and at most `shift` sideways.
    """

    subtree: tuple[int, ...]
    offsets: tuple[Move, ...]
    away: int
    shift: float
    sideways_only: bool


def _best_move(
    master: Master,
    table: InkTable,
    line: Line,
    search: _Search,
    extremes: tuple[float, float],
) -> tuple[float, Move] | None:
    """The cheapest further move of the subtree, as the line stands, that
    clears every other glyph of the line by `gap`: sideways, each unit
    costing one, and vertically, each unit costing `vertical_cost` and away
    from its letter first on a tie, while every glyph's total offset stays
    within `shift` sideways and `max_lift` either way, and the ink within
    `extremes`, the highest and lowest ink of the corpus before step 6.
    """
    params = master.params
    q = max(1, round(params.quantum * master.upem))
    lift = 0 if search.sideways_only else params.max_lift * master.upem
    top, bottom = _ink_range(table, line, search.subtree)
    ceiling, floor = max(extremes[0], top), min(extremes[1], bottom)
    xs = [o[0] for o in search.offsets]
    ys = [search.away * o[1] for o in search.offsets]
    low = math.ceil((-search.shift - min(xs)) / q)
    high = math.floor((search.shift - max(xs)) / q)
    best: tuple[float, Move] | None = None
    for i in sorted(range(low, high + 1), key=abs):
        dx = i * q
        if best is not None and abs(dx) >= best[0]:
            break
        steps = int(lift // q)
        for dy in sorted(
            range(-steps * q, steps * q + 1, q), key=lambda d: (abs(d), -d)
        ):
            if max(ys) + dy > lift or min(ys) + dy < -lift:
                continue
            cost = abs(dx) + params.vertical_cost * abs(dy)
            if best is not None and cost >= best[0]:
                break
            delta = (dx, search.away * dy)
            if (
                delta != (0, 0)
                and top + delta[1] <= ceiling
                and bottom + delta[1] >= floor
                and _clears(table, line, search.subtree, delta, master.gap)
            ):
                best = (cost, delta)
                break
    return best


@dataclass
class Found:
    """One pass of step 6 on one font: the further moves per context and
    position, the contacts no move within the limits clears, and the lines
    (by index) with contacts.
    """

    moves: Rules
    stuck: list[str]
    touched: set[int]


def find_contexts(
    master: Master,
    lines: Sequence[str],
    rules: Rules,
    structures: list[list[Parent]],
    extremes: tuple[float, float],
    only: Collection[int] | None = None,
) -> Found:
    """Step 6, one pass: for each contact left in the corpus (the lines
    `only` lists, or all), the further move of the mark, with the marks
    stacked on it, or of the whole stack it is part of, that clears it, as
    `rules` leave it.
    """
    params = master.params
    clearance = master.gap
    table = Scanner(master, lines, structures=structures).table()
    order = master.font.getGlyphOrder()
    shifts = _mark_shifts(master)
    found: Rules = {}
    tried: dict[tuple[Context, tuple[int, ...]], tuple[float, Move] | None] = {}
    stuck = []
    touched = set()
    for n, (text, parents) in enumerate(zip(lines, structures, strict=True)):
        if only is not None and n not in only:
            continue
        line = Line(shape(table.font, text), parents)
        position = {id(g): p for p, g in enumerate(line.placed)}
        for contact in table.contacts([g for g in line.placed if g.rtl], clearance):
            touched.add(n)
            i, j = position[id(contact.mark)], position[id(contact.other)]
            candidates = [(i, j)]
            if contact.other.gid in table.checked:
                candidates.append((j, i))
            # Or the whole stack, from the mark hung on the letter.
            candidates += [
                (root, other)
                for mover, other in list(candidates)
                if (root := _root(line, mover)) != mover
            ]
            best: (
                tuple[float, Context, tuple[int, ...], Move, tuple[int, ...]] | None
            ) = None
            for mover, other in candidates:
                name = order[line.placed[mover].gid]
                # Dots and signs stay where the letter has them.
                if not master.movable(name) or (
                    line.placed[mover].gid not in table.checked
                ):
                    continue
                stack = _subtree(line, mover)
                # A mark touching a mark stacked on it moves alone, and only
                # sideways. HarfBuzz carries attached marks along with the
                # mark they hang on, so the rest of its stack moves back.
                alone = other in stack
                followers: tuple[int, ...] = ()
                if alone:
                    # Alone, a stack's root would leave the touching mark put.
                    if mover not in (i, j):
                        continue
                    followers = tuple(p for p in stack if p != mover)
                    stack = [mover]
                subtree = tuple(
                    p for p in stack if master.movable(order[line.placed[p].gid])
                )
                span = _span(line, [*subtree, *followers, other])
                if span is None:
                    continue
                first, last = span
                context = tuple(order[g.gid] for g in line.placed[first : last + 1])
                relative = tuple(p - first for p in subtree)
                if (context, relative) not in tried:
                    existing = rules.get(context, {})
                    tried[context, relative] = _best_move(
                        master,
                        table,
                        line,
                        _Search(
                            subtree,
                            tuple(existing.get(p, (0, 0)) for p in relative),
                            1 if _side_of(master, name) == "top" else -1,
                            shifts.get(name, params.max_shift) * master.upem,
                            alone,
                        ),
                        extremes,
                    )
                move = tried[context, relative]
                if move is not None and (best is None or move[0] < best[0]):
                    back = tuple(p - first for p in followers)
                    best = (move[0], context, relative, move[1], back)
            if best is None:
                stuck.append(
                    f"{text[:32]}: {order[contact.mark.gid]} {contact.gap:.1f} "
                    f"from {order[contact.other.gid]}"
                )
                continue
            _, context, relative, delta, back = best
            moves = found.setdefault(context, {})
            undo = (-delta[0], -delta[1])
            for p, move in [
                *((p, delta) for p in relative),
                *((p, undo) for p in back),
            ]:
                old = moves.get(p, (0, 0))
                if abs(move[0]) + abs(move[1]) > abs(old[0]) + abs(old[1]):
                    moves[p] = move
    return Found(found, stuck, touched)


def add_contexts(
    fonts: Sequence[TTFont], rules: Sequence[Rules], layers: Mapping[Context, int]
) -> int:
    """Appends step 6's lookups to each of `fonts`, the masters, from each
    master's own `rules`: single adjustment lookups, each moving a glyph by
    one offset per master, as few as keep every glyph to one offset per
    lookup; then, per layer, contextual lookups that apply them. Every
    master gets every rule, with zero offsets where its own rules have no
    move, so that varLib sees one structure. HarfBuzz skips past a matched
    context, so rules whose contexts overlap in the corpus go in different
    layers. Returns the number of lookups added.
    """
    contexts = sorted({c for own in rules for c in own})
    if not contexts:
        return 0
    zero = (0, 0)
    slots: list[dict[str, tuple[Move, ...]]] = []
    slot_of: dict[tuple[Context, int], int] = {}
    for context in contexts:
        positions = sorted({p for own in rules for p in own.get(context, {})})
        for p in positions:
            glyph = context[p]
            offsets = tuple(own.get(context, {}).get(p, zero) for own in rules)
            if all(o == zero for o in offsets):
                continue
            n = next(
                (
                    i
                    for i, slot in enumerate(slots)
                    if slot.get(glyph, offsets) == offsets
                ),
                len(slots),
            )
            if n == len(slots):
                slots.append({})
            slots[n][glyph] = offsets
            slot_of[context, p] = n
    added = 0
    for m, font in enumerate(fonts):
        gpos = table(font, "GPOS").table
        lookups = gpos.LookupList.Lookup
        first = len(lookups)
        for slot in slots:
            sub = ot.SinglePos()
            sub.Format = 2
            sub.Coverage = ot.Coverage()
            sub.Coverage.glyphs = sorted(slot, key=font.getGlyphID)
            sub.ValueFormat = _X_PLACEMENT | _Y_PLACEMENT
            sub.Value = [
                buildValue({"XPlacement": slot[g][m][0], "YPlacement": slot[g][m][1]})
                for g in sub.Coverage.glyphs
            ]
            sub.ValueCount = len(sub.Value)
            lookups.append(_lookup(_SINGLE, 0, [sub]))
        chains = []
        for layer in sorted({layers[c] for c in contexts}):
            mine = [c for c in contexts if layers[c] == layer]
            for start in range(0, len(mine), _RULES_PER_LOOKUP):
                subs = []
                for glyphs in mine[start : start + _RULES_PER_LOOKUP]:
                    records = []
                    for p in range(len(glyphs)):
                        if (glyphs, p) not in slot_of:
                            continue
                        record = ot.PosLookupRecord()
                        record.SequenceIndex = p
                        record.LookupListIndex = first + slot_of[glyphs, p]
                        records.append(record)
                    if records:
                        subs.append(_chain(glyphs, records))
                if subs:
                    lookups.append(_lookup(_CHAIN_CONTEXT, 0, subs))
                    chains.append(len(lookups) - 1)
        gpos.LookupList.LookupCount = len(lookups)
        for record in gpos.FeatureList.FeatureRecord:
            if record.FeatureTag == "mark":
                record.Feature.LookupListIndex += chains
                record.Feature.LookupCount = len(record.Feature.LookupListIndex)
        added = len(slots) + len(chains)
    return added


def _lookup(kind: int, flag: int, subs: list[Any]) -> Any:
    lookup = ot.Lookup()
    lookup.LookupType, lookup.LookupFlag = kind, flag
    lookup.SubTable = subs
    lookup.SubTableCount = len(subs)
    return lookup


def _chain(glyphs: Sequence[str], records: list[Any]) -> Any:
    sub = ot.ChainContextPos()
    sub.Format = 3
    sub.BacktrackGlyphCount = sub.LookAheadGlyphCount = 0
    sub.BacktrackCoverage, sub.LookAheadCoverage = [], []
    sub.InputCoverage = []
    for glyph in glyphs:
        coverage = ot.Coverage()
        coverage.glyphs = [glyph]
        sub.InputCoverage.append(coverage)
    sub.InputGlyphCount = len(sub.InputCoverage)
    sub.PosLookupRecord = records
    sub.PosCount = len(records)
    return sub


def layer_rules(
    lines: Iterable[Line], contexts: Iterable[Context], order: Sequence[str]
) -> dict[Context, int]:
    """A layer per context such that no two contexts of one layer match
    overlapping glyphs of any corpus line.
    """
    wanted = sorted(set(contexts))
    by_first: defaultdict[str, list[Context]] = defaultdict(list)
    for context in wanted:
        by_first[context[0]].append(context)
    conflicts: defaultdict[Context, set[Context]] = defaultdict(set)
    for line in lines:
        names = [order[g.gid] for g in line.placed]
        spans = []
        for start, name in enumerate(names):
            for context in by_first.get(name, ()):
                if tuple(names[start : start + len(context)]) == context:
                    spans.append((start, start + len(context), context))
        for a in spans:
            for b in spans:
                if a[2] != b[2] and a[0] < b[1] and b[0] < a[1]:
                    conflicts[a[2]].add(b[2])
    layers: dict[Context, int] = {}
    for context in sorted(wanted, key=lambda c: (-len(conflicts[c]), c)):
        taken = {layers[o] for o in conflicts[context] if o in layers}
        layers[context] = next(n for n in range(len(wanted) + 1) if n not in taken)
    return layers


@dataclass(frozen=True)
class Job:
    wght: float
    data: bytes
    params: Params
    plan: Plan
    lines: tuple[str, ...]


def _anchor_steps(job: Job) -> tuple[bytes, dict[str, int]]:
    """Steps 1 to 5 on one master."""
    master = Master(TTFont(io.BytesIO(job.data)), job.params, job.plan)
    split_classes(master)
    add_stacks(master)
    lowered = tighten_stacks(master)
    lowered |= fit_letters(master)
    repair_neighbours(master, job.lines, lowered, job.params.passes)
    return _bytes(master.font), dict(master.log)


def _context_pass(
    args: tuple[Job, Rules, dict[Context, int], frozenset[int] | None],
) -> Found:
    job, rules, layers, only = args
    font = TTFont(io.BytesIO(job.data))
    add_contexts([font], [rules], layers)
    return _scan(job, _bytes(font), rules, only)


def _midpoint(
    a: Job, b: Job, rules: Sequence[Rules], layers: Mapping[Context, int]
) -> bytes:
    """The static font halfway between masters `a` and `b`, each with its
    own `rules`, as the variable font interpolates it.
    """
    from fontTools.varLib import instancer

    from sawa_tools.build.merge import WghtRange, build_variable

    fonts = [TTFont(io.BytesIO(a.data)), TTFont(io.BytesIO(b.data))]
    add_contexts(fonts, rules, layers)
    font = build_variable(
        {a.wght: fonts[0], b.wght: fonts[1]}, WghtRange(a.wght, a.wght, b.wght)
    )
    return _bytes(
        instancer.instantiateVariableFont(font, {"wght": (a.wght + b.wght) / 2})
    )


def _halfway(a: Rules, b: Rules) -> Rules:
    zero = (0, 0)
    return {
        c: {
            p: (
                (a.get(c, {}).get(p, zero)[0] + b.get(c, {}).get(p, zero)[0]) // 2,
                (a.get(c, {}).get(p, zero)[1] + b.get(c, {}).get(p, zero)[1]) // 2,
            )
            for p in {*a.get(c, {}), *b.get(c, {})}
        }
        for c in {*a, *b}
    }


def _midpoint_pass(
    args: tuple[Job, Job, Rules, Rules, dict[Context, int], frozenset[int] | None],
) -> Found:
    """Step 6's contacts halfway between two masters with their rules."""
    a, b, rules_a, rules_b, layers, only = args
    key = hashlib.sha256(a.data + b.data).hexdigest()
    if key not in _MIDPOINTS:
        _MIDPOINTS[key] = _midpoint(a, b, [{}, {}], {})
    job = replace(a, wght=(a.wght + b.wght) / 2, data=_MIDPOINTS[key])
    data = _midpoint(a, b, [rules_a, rules_b], layers)
    return _scan(job, data, _halfway(rules_a, rules_b), only)


def _scan(
    job: Job, data: bytes, rules: Rules, only: frozenset[int] | None = None
) -> Found:
    """find_contexts on `data`, `job`'s font with `rules` added, taking the
    attachments from `job`'s font without them.
    """
    master = Master(TTFont(io.BytesIO(data)), job.params, job.plan)
    key = hashlib.sha256(job.data).hexdigest()
    if key not in _STRUCTURES:
        before = TTFont(io.BytesIO(job.data))
        index, base = AttachIndex(before), hb_font(job.data)
        inks = Scanner(Master(before, job.params, job.plan), ()).table()
        structures, top, bottom = [], -INF, INF
        for text in job.lines:
            placed = shape(base, text)
            structures.append(_structure(index, placed))
            extent = inks.extent(placed)
            if extent is not None:
                top, bottom = max(top, extent[0]), min(bottom, extent[1])
        _STRUCTURES[key] = (structures, (top, bottom))
    structures, extremes = _STRUCTURES[key]
    return find_contexts(master, job.lines, rules, structures, extremes, only)


# Each worker process's attachments per master, by the master's hash, kept
# across passes: they do not change in step 6.
_STRUCTURES: dict[str, tuple[list[list[Parent]], tuple[float, float]]] = {}
# And the fonts halfway between two masters without step 6's rules.
_MIDPOINTS: dict[str, bytes] = {}


@dataclass
class Report:
    """What compaction did, for the build log."""

    steps: dict[float, dict[str, int]] = field(default_factory=dict)
    rules: int = 0
    lookups: int = 0
    passes: int = 0
    # Per pass, the contexts with contacts plus the contacts no move clears.
    contacts: list[int] = field(default_factory=list)
    moves: Rules = field(default_factory=dict)
    stuck: list[str] = field(default_factory=list)


def compact_masters(
    masters: Mapping[float, TTFont],
    default: float,
    params: Params,
    lines: Sequence[str],
    jobs: int | None = None,
) -> tuple[dict[float, TTFont], Report]:
    """Runs every step on every master, deciding structure on `default`."""
    report = Report()
    with ProcessPoolExecutor(max_workers=jobs) as pool:
        work = fit_masters(masters, default, params, lines, pool, report)
        return add_context_rules(work, params, pool, report), report


def fit_masters(
    masters: Mapping[float, TTFont],
    default: float,
    params: Params,
    lines: Sequence[str],
    pool: ProcessPoolExecutor,
    report: Report,
) -> list[Job]:
    """Steps 1 to 5 on every master. Steps 5 and 6 see the everyday view of
    `lines`.
    """
    decided = plan(masters[default], params, lines)
    views = tuple(dict.fromkeys(everyday(t) for t in lines))
    work = [
        Job(w, _bytes(m), params, decided, views) for w, m in sorted(masters.items())
    ]
    done = list(pool.map(_anchor_steps, work))
    report.steps = {j.wght: log for j, (_, log) in zip(work, done, strict=True)}
    return [replace(j, data=data) for j, (data, _) in zip(work, done, strict=True)]


def merge_moves(rules: Rules, proposal: Rules) -> bool:
    """Adds `proposal`'s further moves to `rules`; returns whether any
    rule changed.
    """
    changed = False
    for context, moves in proposal.items():
        for p, (dx, dy) in moves.items():
            if (dx, dy) == (0, 0):
                continue
            old = rules.setdefault(context, {}).get(p, (0, 0))
            rules[context][p] = (old[0] + dx, old[1] + dy)
            changed = True
    return changed


@dataclass
class Fitted:
    """One master's step 6: its rules, the contacts no move cleared, and
    per pass the contexts with contacts plus those contacts.
    """

    rules: Rules
    stuck: list[str]
    contacts: list[int]


def fit_contexts(job: Job) -> Fitted:
    """Step 6 on one master: passes until no contact is left, no move
    clears the rest, `patience` passes bring no fewer contacts or the
    passes run out. The pass with the fewest contacts is kept.
    """
    shaped = _shaped_names(job)
    order = reference_order(job)
    rules: Rules = {}
    layers: dict[Context, int] = {}
    best: tuple[int, Rules, list[str]] | None = None
    counts: list[int] = []
    since = 0
    for _ in range(job.params.passes):
        found = _context_pass((job, rules, layers, None))
        count = len(found.moves) + len(found.stuck)
        counts.append(count)
        if best is None or count < best[0]:
            best, since = (count, copy.deepcopy(rules), found.stuck), 0
        else:
            since += 1
        if count == 0 or since >= job.params.patience:
            break
        if not merge_moves(rules, found.moves):
            break
        layers = layer_rules(shaped, rules, order)
    assert best is not None
    return Fitted(best[1], best[2], counts)


def add_context_rules(
    work: Sequence[Job],
    params: Params,
    pool: ProcessPoolExecutor,
    report: Report,
) -> dict[float, TTFont]:
    """Step 6, fitted on each master alone, then on the masters and the
    fonts halfway between each two neighbours together, passes until none
    has a contact, `patience` passes bring no fewer or the passes run out;
    the pass with the fewest is kept. A move a halfway font needs is added
    to both its masters. Every master's rules go to every master with its
    own offsets (add_contexts). After the first joint pass, each font is
    scanned again only on the lines it had contacts in and those a changed
    rule matches.
    """
    fitted = list(pool.map(fit_contexts, work))
    order = reference_order(work[0])
    by_master = [_shaped_names(job) for job in work]
    shaped = [line for lines in by_master for line in lines]
    names = [
        {tuple(order[g.gid] for g in lines[n].placed) for lines in by_master}
        for n in range(len(work[0].lines))
    ]
    rules = [f.rules for f in fitted]
    reference = Master(TTFont(io.BytesIO(work[0].data)), params, work[0].plan)
    limits = MoveLimits(
        params.max_lift * reference.upem,
        params.max_shift * reference.upem,
        {g: s * reference.upem for g, s in _mark_shifts(reference).items()},
    )
    pairs = list(pairwise(range(len(work))))
    # Per font (the masters, then the halfway fonts): lines with contacts,
    # and the lines to scan next pass (None for all).
    touched: list[set[int]] = [set() for _ in range(len(work) + len(pairs))]
    scan: list[frozenset[int] | None] = [None] * len(touched)
    best: tuple[int, list[Rules], list[str]] | None = None
    since = 0
    for _ in range(params.passes):
        report.passes += 1
        layers = layer_rules(shaped, {c for own in rules for c in own}, order)
        tasks = [
            pool.submit(_context_pass, (job, r, layers, scan[m]))
            for m, (job, r) in enumerate(zip(work, rules, strict=True))
        ] + [
            pool.submit(
                _midpoint_pass,
                (work[i], work[k], rules[i], rules[k], layers, scan[len(work) + h]),
            )
            for h, (i, k) in enumerate(pairs)
        ]
        found = [f.result() for f in tasks]
        for t, result in enumerate(found):
            lines = scan[t]
            touched[t] = (touched[t] - lines if lines is not None else set()) | (
                result.touched
            )
        stuck = sorted({s for result in found for s in result.stuck})
        count = sum(len(t) for t in touched)
        report.contacts.append(count)
        if best is None or count < best[0]:
            best, since = (count, copy.deepcopy(rules), stuck), 0
        else:
            since += 1
        if count == 0 or since >= params.patience:
            break
        changed: set[Context] = set()
        for m, result in enumerate(found[: len(work)]):
            if merge_moves(rules[m], result.moves):
                changed |= set(result.moves)
        for (i, k), result in zip(pairs, found[len(work) :], strict=True):
            if merge_moves(rules[i], result.moves) | merge_moves(
                rules[k], result.moves
            ):
                changed |= set(result.moves)
        if not changed:
            break
        for mine in rules:
            clamp_moves(mine, limits)
        again = _lines_matching(names, changed)
        scan = [frozenset(again | t) for t in touched]
    assert best is not None
    _, rules, report.stuck = best
    layers = layer_rules(shaped, {c for own in rules for c in own}, order)
    fonts = [TTFont(io.BytesIO(job.data)) for job in work]
    report.lookups = add_contexts(fonts, rules, layers)
    report.rules = len(layers)
    report.moves = {
        c: {p: m for own in rules for p, m in own.get(c, {}).items()} for c in layers
    }
    return {
        job.wght: TTFont(io.BytesIO(_bytes(font)))
        for job, font in zip(work, fonts, strict=True)
    }


@dataclass(frozen=True)
class MoveLimits:
    """How far step 6 may move a glyph in all, in font units: vertically,
    sideways, and sideways for the glyphs `markShifts` names.
    """

    lift: float
    shift: float
    shifts: Mapping[str, float]


def clamp_moves(rules: Rules, limits: MoveLimits) -> None:
    """Holds every move of `rules` within `limits`, where moves a master
    and the halfway fonts beside it each asked for add up past them.
    """
    for context, moves in rules.items():
        for p, (dx, dy) in moves.items():
            shift = limits.shifts.get(context[p], limits.shift)
            moves[p] = (
                int(max(-shift, min(shift, dx))),
                int(max(-limits.lift, min(limits.lift, dy))),
            )


def _lines_matching(
    names: Sequence[set[tuple[str, ...]]], contexts: Iterable[Context]
) -> set[int]:
    """The indices of the lines, each given as the glyph sequences the
    masters shape it to, where any of `contexts` matches.
    """
    by_first: defaultdict[str, list[Context]] = defaultdict(list)
    for context in contexts:
        by_first[context[0]].append(context)
    found = set()
    for n, sequences in enumerate(names):
        for sequence in sequences:
            if any(
                sequence[start : start + len(c)] == c
                for start, name in enumerate(sequence)
                for c in by_first.get(name, ())
            ):
                found.add(n)
                break
    return found


def reference_order(job: Job) -> list[str]:
    return TTFont(io.BytesIO(job.data)).getGlyphOrder()


def _shaped_names(job: Job) -> list[Line]:
    font = hb_font(job.data)
    return [Line(shape(font, text), []) for text in job.lines]


# The modules whose code decides a compacted master, beside bidi.py and
# corpus.py.
STAGE_MODULES = ("compact.py", "clearance.py", "lines.py")


@dataclass(frozen=True)
class Compaction:
    """A family's compaction parameters and the corpus its steps fit."""

    family: str
    params: Params
    lines: tuple[str, ...]

    def key(self) -> str:
        """Hashes the parameters, the corpus and this stage's code."""
        from pathlib import Path

        digest = hashlib.sha256(repr(self.params).encode())
        digest.update("\n".join(self.lines).encode())
        here = Path(__file__).parent
        for path in [here / m for m in STAGE_MODULES]:
            digest.update(path.read_bytes())
        digest.update((here.parent / "report" / "bidi.py").read_bytes())
        digest.update((here.parent / "corpus.py").read_bytes())
        return digest.hexdigest()


def compacted(
    masters: Mapping[float, TTFont],
    default: float,
    compaction: Compaction,
    cache: MastersCache | None,
) -> dict[float, TTFont]:
    """The masters compacted, or the cached result of compacting them."""
    from sawa_tools.build.masters import anchored

    def build() -> dict[float, TTFont]:
        started = time.perf_counter()
        result, report = compact_masters(
            masters, default, compaction.params, compaction.lines
        )
        print(
            f"{compaction.family}: compacted in "
            f"{time.perf_counter() - started:.0f} s, {report.rules} contextual "
            f"rules in {report.lookups} lookups"
            + (f", {len(report.stuck)} contacts unresolved" if report.stuck else "")
        )
        return result

    stage = None if cache is None else cache.stage("compact", compaction.key())
    return anchored(stage, build)
