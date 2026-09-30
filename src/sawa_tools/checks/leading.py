"""Checks each family's line box and mark clearance over whole lines of text.

Per family, at every sampled wght (sampled_weights: the minimum, default,
maximum and every master location, and the midpoints between them), every
line of the corpus is shaped by HarfBuzz and measured twice: as it is, and
in its everyday view, with only everyday tashkeel (corpus.py). The everyday
view must pass:

- lines: set at the family's typo/hhea line box (ascender minus descender,
  no line gap), no line's ink may reach the ink of any other line set above
  it, since any two lines can be neighbours: the box must be at least the
  highest top less the lowest bottom over the corpus;
- contacts: no mark of an Arabic run comes within the family's mark
  clearance of any other glyph's ink, in its own cluster or another. The
  marks are the GDEF marks other than the dots and signs HarfBuzz
  decomposes letters into, which are part of the letter, except those text
  also writes as combining marks, such as hamza and madda.

The lines as they are must keep their ink inside the win metrics. Their
collisions and contacts, in lines with niche marks, are reported only, as
is the share of lines whose ink stays inside the line box.

The corpus is corpus.py's; families with `leading.quran` false skip its
Quran text. Each (family, wght) runs in its own process.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import unicodedata
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from dataclasses import asdict, dataclass, field
from itertools import pairwise
from pathlib import Path
from typing import TYPE_CHECKING

from sawa_tools.build.families import (
    DEFAULT_FAMILIES,
    DEFAULT_FONTS_DIR,
    Family,
    FamilyError,
    load_config,
)
from sawa_tools.corpus import CorpusError, Part, corpus, everyday
from sawa_tools.tanzil import DEFAULT_UTHMANI

if TYPE_CHECKING:
    from collections.abc import Iterable, Iterator, Sequence
    from typing import Any

# Contacts listed per (family, wght) before the rest are only counted.
_EXAMPLES = 12


class LeadingError(Exception):
    """Raised for a failure that should stop the check with a clear message."""


@dataclass(frozen=True)
class Box:
    ascender: float
    descender: float

    @property
    def height(self) -> float:
        return self.ascender - self.descender


Extent = tuple[float, float] | None


def collisions(extents: Sequence[Extent], pitch: float) -> list[int]:
    """Indices of the lines whose ink, set `pitch` below the line with the
    lowest ink, reaches it.
    """
    inked = [e for e in extents if e is not None]
    if not inked:
        return []
    lowest = min(b for _, b in inked)
    return [i for i, e in enumerate(extents) if e is not None and e[0] - lowest > pitch]


def zero_collision_pitch(extents: Sequence[Extent]) -> float:
    """The smallest pitch at which no two lines' inks meet, whichever pair
    ends up adjacent: the highest top less the lowest bottom.
    """
    inked = [e for e in extents if e is not None]
    if not inked:
        return 0.0
    return max(t for t, _ in inked) - min(b for _, b in inked)


def sampled_weights(font: Any) -> list[float]:
    """The wght minimum, default and maximum, every master location the
    font's variation regions peak at, and the midpoint between each two
    adjacent ones.
    """
    from fontTools.varLib.models import piecewiseLinearMap

    axes = font["fvar"].axes
    axis = next(a for a in axes if a.axisTag == "wght")
    low, default, high = axis.minValue, axis.defaultValue, axis.maxValue
    avar = font["avar"].segments.get("wght") if "avar" in font else None
    inverse = {v: k for k, v in avar.items()} if avar else None
    index = [a.axisTag for a in axes].index("wght")
    peaks = {0.0}
    for tag in ("HVAR", "GDEF", "MVAR"):
        store = getattr(font[tag].table, "VarStore", None) if tag in font else None
        if store is not None:
            for region in store.VarRegionList.Region:
                peaks.add(region.VarRegionAxis[index].PeakCoord)
    if "gvar" in font:
        for variations in font["gvar"].variations.values():
            for variation in variations:
                if "wght" in variation.axes:
                    peaks.add(variation.axes["wght"][1])
    found = {low, default, high}
    for peak in peaks:
        mapped = piecewiseLinearMap(peak, inverse) if inverse else peak
        at = default + mapped * ((high - default) if mapped > 0 else (default - low))
        found.add(round(at, 1))
    ordered = sorted(w for w in found if low <= w <= high)
    return sorted(set(ordered) | {(a + b) / 2 for a, b in pairwise(ordered)})


def inside_share(extents: Iterable[Extent], box: Box) -> float:
    inked = [e for e in extents if e is not None]
    if not inked:
        return 1.0
    inside = sum(1 for t, b in inked if t <= box.ascender and b >= box.descender)
    return inside / len(inked)


@dataclass
class Result:
    """Measurements of one (family, wght): per corpus part, each line's
    extent in its everyday view (`extents`) and as it is (`full`); contacts
    in the everyday views, and in the lines with niche marks.
    """

    family: str
    wght: float
    upem: int
    extents: dict[str, list[Extent]]
    full: dict[str, list[Extent]] = field(default_factory=dict)
    contacts: Counter[str] = field(default_factory=Counter)
    examples: list[str] = field(default_factory=list)
    niche: Counter[str] = field(default_factory=Counter)
    seconds: float = 0.0


def measure(
    family_id: str,
    ttf: Path,
    wght: float,
    parts: Sequence[Part],
    clearance_em: float,
) -> Result:
    from fontTools.ttLib import TTFont

    from sawa_tools.build.anchors import shaped_letters, table
    from sawa_tools.build.harfbuzz import Shaper
    from sawa_tools.build.lines import InkTable, hb_font, mark_glyphs, shape

    started = time.perf_counter()
    data = ttf.read_bytes()
    font = TTFont(ttf, lazy=True)
    upem = table(font, "head").unitsPerEm
    order = font.getGlyphOrder()
    parts_of_letters = shaped_letters(font, Shaper(data, {"wght": wght})).marks
    marks = mark_glyphs(font)
    cmap = font.getBestCmap() or {}
    written = {g for cp, g in cmap.items() if unicodedata.category(chr(cp)) == "Mn"}
    gid = {name: i for i, name in enumerate(order)}
    table = InkTable(
        hb_font(data, wght),
        upem / 250,
        frozenset(gid[g] for g in marks),
        frozenset(gid[g] for g in marks - (parts_of_letters - written)),
    )
    clearance = clearance_em * upem
    result = Result(family_id, wght, upem, {})

    def contacts(placed: list[Any]) -> Iterator[tuple[str, str]]:
        for contact in table.contacts([g for g in placed if g.rtl], clearance):
            a, b = order[contact.mark.gid], order[contact.other.gid]
            kind = "mark" if contact.other.gid in table.marks else "base"
            where = "within" if contact.same_cluster else "between"
            yield (
                f"{where} {kind}: {a} {b}",
                f"{a} {contact.gap:.1f} units from {b} ({where} clusters)",
            )

    for part in parts:
        extents, full = [], []
        for label, text in part.lines:
            view = everyday(text)
            placed = shape(table.font, view)
            extents.append(table.extent(placed))
            for key, example in contacts(placed):
                result.contacts[key] += 1
                if len(result.examples) < _EXAMPLES:
                    result.examples.append(f"{part.name} {label}: {example}")
            if view == text:
                full.append(extents[-1])
                continue
            placed = shape(table.font, text)
            full.append(table.extent(placed))
            for key, _ in contacts(placed):
                result.niche[key] += 1
        result.extents[part.name] = extents
        result.full[part.name] = full
    result.seconds = time.perf_counter() - started
    return result


def _measure(args: tuple[str, Path, float, list[Part], float]) -> Result:
    return measure(*args)


def family_box(family: Family, upem: int) -> Box:
    return Box(family.metrics.ascender / upem, family.metrics.descender / upem)


def family_win(family: Family, upem: int) -> Box:
    return Box(family.metrics.win_ascent / upem, -family.metrics.win_descent / upem)


@dataclass(frozen=True)
class Summary:
    """One (family, wght) measured against the family's box, in em."""

    family: str
    wght: float
    box: Box
    win: Box | None
    collisions: int
    inside: float
    zero_collision: float
    top: float
    bottom: float
    ink_split: Box
    contacts: int
    seconds: float
    # The lines as they are, niche marks and all.
    niche_collisions: int = 0
    niche_zero_collision: float = 0.0
    niche_contacts: int = 0


def _scaled(
    extents: dict[str, list[Extent]], upem: int, parts: Iterable[str] | None = None
) -> list[Extent]:
    wanted = set(extents if parts is None else parts)
    return [
        None if e is None else (e[0] / upem, e[1] / upem)
        for name, part in extents.items()
        if name in wanted
        for e in part
    ]


def summarise(
    result: Result,
    box: Box,
    win: Box | None = None,
    box_parts: Iterable[str] | None = None,
) -> Summary:
    """`result` against `box` and `win`; the lines of `box_parts` (all by
    default) size the box.
    """
    upem = result.upem
    scaled = _scaled(result.extents, upem, box_parts)
    whole = _scaled(result.full or result.extents, upem)
    inked = [e for e in scaled if e is not None]
    return Summary(
        family=result.family,
        wght=result.wght,
        box=box,
        win=win,
        collisions=len(collisions(scaled, box.height)),
        inside=inside_share(scaled, box),
        zero_collision=zero_collision_pitch(scaled),
        top=max(e[0] for e in whole if e is not None),
        bottom=min(e[1] for e in whole if e is not None),
        ink_split=Box(max(t for t, _ in inked), min(b for _, b in inked)),
        contacts=sum(result.contacts.values()),
        seconds=result.seconds,
        niche_collisions=len(
            collisions(
                _scaled(result.full or result.extents, upem, box_parts), box.height
            )
        ),
        niche_zero_collision=zero_collision_pitch(
            _scaled(result.full or result.extents, upem, box_parts)
        ),
        niche_contacts=sum(result.niche.values()),
    )


def errors(summary: Summary, result: Result) -> list[str]:
    where = f"wght {summary.wght:g}"
    found = []
    if summary.collisions:
        found.append(
            f"{where}: {summary.collisions} lines reach the lowest line above "
            f"them at the {summary.box.height:.3f} em line box (zero collisions "
            f"need {summary.zero_collision:.3f} em)"
        )
    if summary.win is not None and (
        summary.top > summary.win.ascender or summary.bottom < summary.win.descender
    ):
        found.append(
            f"{where}: ink {summary.top:.3f}/{summary.bottom:.3f} em reaches past "
            f"the win metrics {summary.win.ascender:.3f}/{summary.win.descender:.3f}"
        )
    if summary.contacts:
        found.append(
            f"{where}: {summary.contacts} mark contacts under the clearance: "
            + "; ".join(f"{n} {k}" for k, n in result.contacts.most_common(8))
        )
        found += [f"{where}:   {example}" for example in result.examples]
    return found


def add_parser(subparsers: argparse._SubParsersAction) -> None:
    parser = subparsers.add_parser(
        "leading",
        help="Check line boxes and mark clearance over the Quran and test strings",
    )
    parser.add_argument("--families", type=Path, default=DEFAULT_FAMILIES)
    parser.add_argument("--fonts-dir", type=Path, default=DEFAULT_FONTS_DIR)
    parser.add_argument("--quran", type=Path, default=DEFAULT_UTHMANI)
    parser.add_argument(
        "--family", action="append", help="Only check this family id (repeatable)"
    )
    parser.add_argument(
        "--jobs", type=int, default=None, help="Worker processes (default: CPUs)"
    )
    parser.add_argument(
        "--json", type=Path, help="Also write every measurement to this file"
    )
    parser.set_defaults(handler=run)


def run(args: argparse.Namespace) -> int:
    from fontTools.ttLib import TTFont

    started = time.perf_counter()
    try:
        config = load_config(args.families)
        families = [
            f for f in config.families if not args.family or f.id in args.family
        ]
        with_quran = corpus(args.quran)
        without_quran = [p for p in with_quran if p.name != "quran"]
        jobs = []
        for family in families:
            ttf = args.fonts_dir / family.ttf_name
            if not ttf.exists():
                raise LeadingError(f"{ttf} not found; run `sawa build fonts` first")
            if family.mark_clearance is None:
                raise LeadingError(f"family '{family.id}' has no markClearance")
            parts = with_quran if family.leading_quran else without_quran
            for wght in sampled_weights(TTFont(ttf)):
                jobs.append((family.id, ttf, wght, parts, family.mark_clearance))
        with ProcessPoolExecutor(max_workers=args.jobs) as pool:
            results = list(pool.map(_measure, jobs))
    except (CorpusError, FamilyError, LeadingError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    by_id = {f.id: f for f in families}
    failed = False
    report = []
    for result in results:
        family = by_id[result.family]
        summary = summarise(
            result,
            family_box(family, result.upem),
            family_win(family, result.upem),
            family.box_parts,
        )
        report.append(
            asdict(summary)
            | {"contactKinds": dict(result.contacts), "nicheKinds": dict(result.niche)}
        )
        found = errors(summary, result)
        for error in found:
            print(f"{result.family}: {error}", file=sys.stderr)
        state = "FAIL" if found else "OK"
        print(
            f"{state}: {result.family} wght {result.wght:g}: box "
            f"{summary.box.height:.3f} em ({summary.box.ascender:.3f}/"
            f"{summary.box.descender:.3f}), zero-collision "
            f"{summary.zero_collision:.3f} em, ink {summary.top:.3f}/"
            f"{summary.bottom:.3f}, {summary.inside:.2%} inside, "
            f"{summary.contacts} contacts, {summary.seconds:.0f} s; with niche "
            f"marks: {summary.niche_collisions} collisions (zero at "
            f"{summary.niche_zero_collision:.3f} em), {summary.niche_contacts} "
            "contacts"
        )
        failed = failed or bool(found)
    if args.json:
        args.json.write_text(json.dumps(report, indent=1), encoding="utf-8")
    print(f"sawa check leading: {time.perf_counter() - started:.0f} s")
    return 1 if failed else 0
