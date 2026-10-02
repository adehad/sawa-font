"""Bakes Sawa Lab's glyph overrides into a copy of the calibrated font, so
the lab can set its live overlay beside the real thing shaped by HarfBuzz.

- A body offset moves the glyph's outline and its mark-attachment anchors,
  so its dots and marks follow; composites that use the glyph as a
  component are compensated and stay where they were.
- A dot group inside the glyph moves its component or contours alone.
- A dot group that `ccmp` splits off as a glyph of its own gets a copy of
  that glyph with the outline moved and every anchor kept, and a final
  contextual substitution swaps the copy in after this base glyph only.
  Marks stacked on the dots therefore stay put, as in the lab.

Per-cell mark offsets are not baked: no font table holds one placement per
letter and mark sequence.
"""

from __future__ import annotations

import argparse
import copy
import json
import sys
from pathlib import Path
from typing import TYPE_CHECKING, Any

from fontTools.ttLib.tables import otTables as _otTables

if TYPE_CHECKING:
    from fontTools.ttLib import TTFont

# otTables builds its classes when it is imported, out of a type checker's
# sight.
ot: Any = _otTables

DEFAULT_FONTS = Path("lab/public/fonts")
PREVIEW = "calib-preview.ttf"
BAKED = "calib-preview.json"
# The feature the dot swaps are added to: HarfBuzz applies it in the last
# Arabic GSUB stage, after every lookup that could look for the dot glyph.
SWAP_FEATURE = "calt"


class BakeError(Exception):
    """Raised when overrides name something the font does not have, or a
    dot glyph sits in a GPOS table the copy cannot follow.
    """


def glyph_overrides(value: Any) -> list[dict[str, Any]]:
    """The glyph entries of an overrides file; version 1 files have none."""
    if not isinstance(value, dict) or value.get("schema") != "sawa-lab/overrides":
        raise BakeError("not a sawa-lab/overrides file")
    if value.get("version") == 1:
        return []
    if value.get("version") != 2:
        raise BakeError(f"unsupported overrides version {value.get('version')!r}")
    return list(value.get("glyphs", []))


def _translate_simple(
    glyph: Any, glyf: Any, dx: int, dy: int, keep: set[int] | None
) -> None:
    coords, ends, _flags = glyph.getCoordinates(glyf)
    start = 0
    for index, end in enumerate(ends):
        if keep is None or index in keep:
            for i in range(start, end + 1):
                x, y = coords[i]
                coords[i] = (x + dx, y + dy)
        start = end + 1
    glyph.coordinates = coords


def _shift_glyph(font: TTFont, name: str, dx: int, dy: int) -> None:
    glyf: Any = font["glyf"]
    glyph = glyf[name]
    if glyph.isComposite():
        for component in glyph.components:
            component.x += dx
            component.y += dy
    elif glyph.numberOfContours > 0:
        _translate_simple(glyph, glyf, dx, dy, None)


def _users(font: TTFont, name: str) -> list[str]:
    glyf: Any = font["glyf"]
    return [
        other
        for other in font.getGlyphOrder()
        if glyf[other].isComposite()
        and any(c.glyphName == name for c in glyf[other].components)
    ]


def _subtables(table: Any) -> list[tuple[int, int, Any]]:
    out = []
    for index, lookup in enumerate(table.LookupList.Lookup):
        for subtable in lookup.SubTable:
            kind = lookup.LookupType
            if hasattr(subtable, "ExtSubTable"):
                kind = subtable.ExtensionLookupType
                subtable = subtable.ExtSubTable
            out.append((index, kind, subtable))
    return out


def _moved(anchor: Any, dx: int, dy: int) -> Any:
    if anchor is None:
        return None
    moved = copy.deepcopy(anchor)
    moved.XCoordinate += dx
    moved.YCoordinate += dy
    return moved


def _shift_anchors(font: TTFont, name: str, dx: int, dy: int) -> None:
    """Moves where marks attach to `name` as a base or ligature."""
    if "GPOS" not in font:
        return
    for _index, kind, subtable in _subtables(font["GPOS"].table):
        if kind == 4 and name in subtable.BaseCoverage.glyphs:
            record = subtable.BaseArray.BaseRecord[
                subtable.BaseCoverage.glyphs.index(name)
            ]
            record.BaseAnchor = [_moved(a, dx, dy) for a in record.BaseAnchor]
        elif kind == 5 and name in subtable.LigatureCoverage.glyphs:
            attach = subtable.LigatureArray.LigatureAttach[
                subtable.LigatureCoverage.glyphs.index(name)
            ]
            for component in attach.ComponentRecord:
                component.LigatureAnchor = [
                    _moved(a, dx, dy) for a in component.LigatureAnchor
                ]


def move_body(font: TTFont, name: str, dx: int, dy: int) -> None:
    """Moves a glyph's outline and anchors; composites built from it keep
    their place.
    """
    _shift_glyph(font, name, dx, dy)
    for user in _users(font, name):
        for component in font["glyf"][user].components:
            if component.glyphName == name:
                component.x -= dx
                component.y -= dy
    _shift_anchors(font, name, dx, dy)


def move_inline(font: TTFont, name: str, part: str, dx: int, dy: int) -> None:
    """Moves a dot group drawn inside `name`: a component or some contours."""
    glyf: Any = font["glyf"]
    glyph = glyf[name]
    kind, _, spec = part.partition(":")
    if kind == "component" and glyph.isComposite():
        component = glyph.components[int(spec)]
        component.x += dx
        component.y += dy
    elif kind == "contours" and not glyph.isComposite():
        _translate_simple(glyph, glyf, dx, dy, {int(i) for i in spec.split(",")})
    else:
        raise BakeError(f"{name} has no part {part}")


def _clone_glyph(font: TTFont, source: str, clone: str, dx: int, dy: int) -> None:
    glyf: Any = font["glyf"]
    hmtx: Any = font["hmtx"]
    font.setGlyphOrder([*font.getGlyphOrder(), clone])
    glyf.glyphOrder = font.getGlyphOrder()
    glyf[clone] = copy.deepcopy(glyf[source])
    _shift_glyph(font, clone, dx, dy)
    advance, lsb = hmtx[source]
    hmtx[clone] = (advance, lsb + dx)


def _follow_in_gpos(font: TTFont, pairs: list[tuple[str, str]]) -> None:
    """Gives each clone every anchor its source has. Clones are the last
    glyphs in the font, so appending them keeps every coverage sorted.
    """
    if "GPOS" not in font:
        return
    sources = {source for source, _ in pairs}
    for index, kind, subtable in _subtables(font["GPOS"].table):
        if kind in (4, 5):
            marks = subtable.MarkCoverage.glyphs
            records = subtable.MarkArray.MarkRecord
            for source, clone in pairs:
                if source in marks:
                    marks.append(clone)
                    records.append(copy.deepcopy(records[marks.index(source)]))
            subtable.MarkArray.MarkCount = len(records)
        elif kind == 6:
            marks = subtable.Mark1Coverage.glyphs
            records = subtable.Mark1Array.MarkRecord
            bases = subtable.Mark2Coverage.glyphs
            base_records = subtable.Mark2Array.Mark2Record
            for source, clone in pairs:
                if source in marks:
                    marks.append(clone)
                    records.append(copy.deepcopy(records[marks.index(source)]))
                if source in bases:
                    bases.append(clone)
                    base_records.append(
                        copy.deepcopy(base_records[bases.index(source)])
                    )
            subtable.Mark1Array.MarkCount = len(records)
            subtable.Mark2Array.Mark2Count = len(base_records)
        else:
            named = _glyphs_in(subtable)
            stray = sorted(sources & named)
            if stray:
                raise BakeError(
                    f"GPOS lookup {index} (type {kind}) uses {', '.join(stray)}"
                )


def _glyphs_in(subtable: Any) -> set[str]:
    names: set[str] = set()
    for attr in ("Coverage", "InputCoverage", "BacktrackCoverage", "LookAheadCoverage"):
        value = getattr(subtable, attr, None)
        for coverage in value if isinstance(value, list) else [value]:
            if coverage is not None:
                names |= set(coverage.glyphs)
    for attr in (
        "ClassDef1",
        "ClassDef2",
        "ClassDef",
        "InputClassDef",
        "BacktrackClassDef",
        "LookAheadClassDef",
    ):
        value = getattr(subtable, attr, None)
        if value is not None:
            names |= set(value.classDefs)
    return names


def _follow_in_gdef(font: TTFont, pairs: list[tuple[str, str]]) -> None:
    if "GDEF" not in font:
        return
    gdef: Any = font["GDEF"].table
    for source, clone in pairs:
        if gdef.GlyphClassDef and source in gdef.GlyphClassDef.classDefs:
            gdef.GlyphClassDef.classDefs[clone] = gdef.GlyphClassDef.classDefs[source]
        if gdef.MarkAttachClassDef and source in gdef.MarkAttachClassDef.classDefs:
            gdef.MarkAttachClassDef.classDefs[clone] = (
                gdef.MarkAttachClassDef.classDefs[source]
            )
        if getattr(gdef, "MarkGlyphSetsDef", None):
            for coverage in gdef.MarkGlyphSetsDef.Coverage:
                if source in coverage.glyphs:
                    coverage.glyphs.append(clone)


def _swap_lookups(font: TTFont, swaps: list[tuple[str, str, str]]) -> None:
    """Adds one lookup that swaps each (base, dot, clone): the dot glyph
    right after the base becomes the clone.
    """
    gsub: Any = font["GSUB"].table
    lookups = gsub.LookupList.Lookup
    chain = ot.Lookup()
    chain.LookupType = 6
    chain.LookupFlag = 0
    chain.SubTable = []
    for base, dot, clone in swaps:
        single = ot.Lookup()
        single.LookupType = 1
        single.LookupFlag = 0
        sub = ot.SingleSubst()
        sub.mapping = {dot: clone}
        single.SubTable = [sub]
        single.SubTableCount = 1
        lookups.append(single)
        rule = ot.ChainContextSubst()
        rule.Format = 3

        def coverage(glyph: str) -> Any:
            c = ot.Coverage()
            c.glyphs = [glyph]
            return c

        rule.BacktrackCoverage = [coverage(base)]
        rule.BacktrackGlyphCount = 1
        rule.InputCoverage = [coverage(dot)]
        rule.InputGlyphCount = 1
        rule.LookAheadCoverage = []
        rule.LookAheadGlyphCount = 0
        record = ot.SubstLookupRecord()
        record.SequenceIndex = 0
        record.LookupListIndex = len(lookups) - 1
        rule.SubstLookupRecord = [record]
        rule.SubstCount = 1
        chain.SubTable.append(rule)
    chain.SubTableCount = len(chain.SubTable)
    lookups.append(chain)
    gsub.LookupList.LookupCount = len(lookups)
    _add_to_feature(gsub, len(lookups) - 1)


def _add_to_feature(gsub: Any, lookup_index: int) -> None:
    for script in gsub.ScriptList.ScriptRecord:
        if script.ScriptTag != "arab":
            continue
        systems = [script.Script.DefaultLangSys] + [
            r.LangSys for r in script.Script.LangSysRecord
        ]
        for system in systems:
            if system is None:
                continue
            records = gsub.FeatureList.FeatureRecord
            found = [
                i for i in system.FeatureIndex if records[i].FeatureTag == SWAP_FEATURE
            ]
            if found:
                for i in found:
                    feature = records[i].Feature
                    if lookup_index not in feature.LookupListIndex:
                        feature.LookupListIndex.append(lookup_index)
                        feature.LookupCount = len(feature.LookupListIndex)
                continue
            record = ot.FeatureRecord()
            record.FeatureTag = SWAP_FEATURE
            record.Feature = ot.Feature()
            record.Feature.LookupListIndex = [lookup_index]
            record.Feature.LookupCount = 1
            record.Feature.FeatureParams = None
            records.append(record)
            gsub.FeatureList.FeatureCount = len(records)
            system.FeatureIndex.append(len(records) - 1)
            system.FeatureCount = len(system.FeatureIndex)


def bake(font: TTFont, entries: list[dict[str, Any]]) -> TTFont:
    """Applies glyph overrides to `font` in place and returns it."""
    order = set(font.getGlyphOrder())
    clones: list[tuple[str, str, str, int, int]] = []
    for entry in entries:
        name = entry["glyph"]
        if name not in order:
            raise BakeError(f"the font has no glyph {name}")
        body = entry.get("body", {"dx": 0, "dy": 0})
        dx, dy = round(body["dx"]), round(body["dy"])
        if dx or dy:
            move_body(font, name, dx, dy)
        for dot in entry.get("dots", []):
            part, ddx, ddy = dot["part"], round(dot["dx"]), round(dot["dy"])
            if ":" in part:
                move_inline(font, name, part, ddx, ddy)
            elif part in order:
                clones.append((name, part, f"{part}.lab.{name}", ddx, ddy))
            else:
                raise BakeError(f"{name}: no dot glyph {part}")
    for _base, dot, clone, dx, dy in clones:
        _clone_glyph(font, dot, clone, dx, dy)
    pairs = [(dot, clone) for _base, dot, clone, _dx, _dy in clones]
    _follow_in_gpos(font, pairs)
    _follow_in_gdef(font, pairs)
    if clones:
        _swap_lookups(font, [(base, dot, clone) for base, dot, clone, _, _ in clones])
    hmtx: Any = font["hmtx"]
    glyf: Any = font["glyf"]
    for name in {e["glyph"] for e in entries}:
        glyph = glyf[name]
        glyph.recalcBounds(glyf)
        hmtx[name] = (hmtx[name][0], getattr(glyph, "xMin", 0))
    return font


def preview(overrides: Path, fonts: Path) -> Path:
    """Writes calib-preview.ttf and calib-preview.json into `fonts`."""
    from fontTools.ttLib import TTFont

    try:
        value = json.loads(overrides.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise BakeError(f"cannot read {overrides}: {exc}") from exc
    entries = glyph_overrides(value)
    font = TTFont(fonts / "calib.ttf")
    bake(font, entries)
    out = fonts / PREVIEW
    font.save(out)
    lab = json.loads((fonts / "lab.json").read_text(encoding="utf-8"))
    (fonts / BAKED).write_text(
        json.dumps(
            {"build": lab["build"], "source": overrides.name, "glyphs": entries},
            indent=2,
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )
    return out


def add_parser(subparsers: argparse._SubParsersAction) -> None:
    parser = subparsers.add_parser(
        "preview",
        help="Bake an overrides.json into calib-preview.ttf for the lab's comparison",
    )
    parser.add_argument("--overrides", type=Path, required=True)
    parser.add_argument("--fonts", type=Path, default=DEFAULT_FONTS)
    parser.set_defaults(handler=run)


def run(args: argparse.Namespace) -> int:
    try:
        out = preview(args.overrides, args.fonts)
    except BakeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(out)
    return 0
