"""Bakes Sawa Lab's edits into a copy of the calibrated font, so the lab can
set its live overlay beside the real thing shaped by HarfBuzz. Each edit
names the font mechanism it becomes:

- outline: a body offset moves the glyph's outline and its mark-attachment
  anchors, so its dots and marks follow; composites that use the glyph as
  a component are compensated and stay where they were. A dot group inside
  the glyph moves its component or contours alone. A dot group that `ccmp`
  splits off as a glyph of its own gets a copy of that glyph with the
  outline moved and every anchor kept, and a final contextual substitution
  swaps the copy in after this base glyph only, so marks stacked on the
  dots stay put.
- anchor: the glyph's mark-to-base or mark-to-ligature anchor for one class.
- split-class: the named marks get a class of their own in that lookup;
  every base keeps its anchor for them, and this glyph's moves.
- mkmk-anchor: a mark's mark-to-mark anchor for one class.
- pair: a chained contextual positioning lookup per mark, with a mark
  filtering set of that mark alone, appended after every other GPOS lookup
  so it adjusts the mark after attachment.

Requests for a form of its own (GSUB alternates) are listed, not baked.
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
    from collections.abc import Callable

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
# The feature the pair lookups join. Which feature does not decide when they
# run: HarfBuzz applies GPOS lookups in lookup order, and they come last.
PAIR_FEATURE = "mark"
MECHANISMS = ("outline", "anchor", "split-class", "pair", "mkmk-anchor")


class BakeError(Exception):
    """Raised when edits name something the font does not have, or a dot
    glyph sits in a GPOS table the copy cannot follow.
    """


def _edit(mechanism: str, target: dict[str, Any], dx: Any, dy: Any) -> dict[str, Any]:
    return {"mechanism": mechanism, "target": target, "dx": round(dx), "dy": round(dy)}


def edits_of(
    value: Any, body_of: Callable[[dict[str, Any]], str | None] = lambda _key: None
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """The edits and alternate requests of an overrides file. Version 2
    glyph entries become outline edits; a cell's mark offsets, in versions 1
    and 2, become pair rules on the cell's body glyph, which `body_of` names
    when the entry does not.
    """
    if not isinstance(value, dict) or value.get("schema") != "sawa-lab/overrides":
        raise BakeError("not a sawa-lab/overrides file")
    version = value.get("version")
    if version == 3:
        edits = []
        for entry in value.get("edits", []):
            if entry.get("mechanism") not in MECHANISMS:
                raise BakeError(f"unknown mechanism {entry.get('mechanism')!r}")
            at = (entry.get("values") or {}).get("400")
            if not at:
                raise BakeError(f"{entry.get('id')}: no value at wght 400")
            edits.append(_edit(entry["mechanism"], entry["target"], at["dx"], at["dy"]))
        return edits, list(value.get("requests", []))
    if version not in (1, 2):
        raise BakeError(f"unsupported overrides version {version!r}")
    edits = []
    for entry in value.get("glyphs", []) if version == 2 else []:
        glyph = entry["glyph"]
        body = entry.get("body", {"dx": 0, "dy": 0})
        moves = [("body", body["dx"], body["dy"])]
        moves += [(d["part"], d["dx"], d["dy"]) for d in entry.get("dots", [])]
        edits += [
            _edit("outline", {"glyph": glyph, "part": part}, dx, dy)
            for part, dx, dy in moves
            if dx or dy
        ]
    for entry in value.get("overrides" if version == 1 else "marks", []):
        base = entry.get("glyph") or body_of(entry["key"])
        if not base:
            continue
        edits += [
            _edit("pair", {"base": base, "mark": m["glyph"]}, m["dx"], m["dy"])
            for m in entry.get("marks", [])
            if m["dx"] or m["dy"]
        ]
    return edits, []


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


def _class(spec: str) -> tuple[int, int]:
    lookup, _, cls = spec.partition(".")
    try:
        return int(lookup), int(cls)
    except ValueError as exc:
        raise BakeError(f"bad class id {spec!r}") from exc


def _lookup_subtables(font: TTFont, lookup: int) -> list[tuple[int, Any]]:
    if "GPOS" not in font:
        raise BakeError("the font has no GPOS")
    found = [(k, s) for i, k, s in _subtables(font["GPOS"].table) if i == lookup]
    if not found:
        raise BakeError(f"GPOS has no lookup {lookup}")
    return found


def move_anchor(font: TTFont, glyph: str, spec: str, dx: int, dy: int) -> None:
    """Moves `glyph`'s mark-to-base or mark-to-ligature anchor for a class."""
    lookup, cls = _class(spec)
    hit = False
    for kind, subtable in _lookup_subtables(font, lookup):
        if kind == 4 and glyph in subtable.BaseCoverage.glyphs:
            record = subtable.BaseArray.BaseRecord[
                subtable.BaseCoverage.glyphs.index(glyph)
            ]
            record.BaseAnchor[cls] = _moved(record.BaseAnchor[cls], dx, dy)
            hit = record.BaseAnchor[cls] is not None
        elif kind == 5 and glyph in subtable.LigatureCoverage.glyphs:
            attach = subtable.LigatureArray.LigatureAttach[
                subtable.LigatureCoverage.glyphs.index(glyph)
            ]
            for component in attach.ComponentRecord:
                anchor = component.LigatureAnchor[cls]
                component.LigatureAnchor[cls] = _moved(anchor, dx, dy)
                hit = hit or anchor is not None
    if not hit:
        raise BakeError(f"{glyph} has no anchor for class {spec}")


def move_mark2(font: TTFont, glyph: str, spec: str, dx: int, dy: int) -> None:
    """Moves `glyph`'s mark-to-mark anchor for the class that stacks on it."""
    lookup, cls = _class(spec)
    for kind, subtable in _lookup_subtables(font, lookup):
        if kind == 6 and glyph in subtable.Mark2Coverage.glyphs:
            record = subtable.Mark2Array.Mark2Record[
                subtable.Mark2Coverage.glyphs.index(glyph)
            ]
            if record.Mark2Anchor[cls] is not None:
                record.Mark2Anchor[cls] = _moved(record.Mark2Anchor[cls], dx, dy)
                return
    raise BakeError(f"{glyph} has no mark-to-mark anchor for class {spec}")


def _extend(
    anchors: list[Any],
    glyph: str,
    new: list[tuple[tuple[int, tuple[int, ...]], int]],
    group: list[dict[str, Any]],
    applied: list[bool],
) -> list[Any]:
    """`anchors` with one more per new class: a copy of the old class's
    anchor, moved by each split in the class's signature that names `glyph`.
    """
    out = list(anchors)
    for (old, signature), _index in new:
        anchor = anchors[old]
        for i in signature:
            split = group[i]
            if split["target"]["glyph"] == glyph and anchor is not None:
                anchor = _moved(anchor, split["dx"], split["dy"])
                applied[i] = True
        out.append(copy.deepcopy(anchor))
    return out


def split_classes(font: TTFont, splits: list[dict[str, Any]]) -> None:
    """Gives the marks of each split a class of their own in its lookup.
    A mark named by several splits of the class gets one class for that
    combination. Every base and ligature keeps its anchor for the new
    classes, a copy of the old class's; each split's glyph gets its delta
    on top.
    """
    by_lookup: dict[int, list[dict[str, Any]]] = {}
    for split in splits:
        by_lookup.setdefault(_class(split["target"]["class"])[0], []).append(split)
    for lookup, group in by_lookup.items():
        applied = [False] * len(group)
        for kind, subtable in _lookup_subtables(font, lookup):
            if kind not in (4, 5):
                raise BakeError(f"lookup {lookup} is not a mark-to-base lookup")
            count = subtable.ClassCount
            classes: dict[tuple[int, tuple[int, ...]], int] = {}
            for name, record in zip(
                subtable.MarkCoverage.glyphs, subtable.MarkArray.MarkRecord, strict=True
            ):
                signature = tuple(
                    i
                    for i, s in enumerate(group)
                    if name in s["target"]["marks"]
                    and _class(s["target"]["class"])[1] == record.Class
                )
                if signature:
                    key = (record.Class, signature)
                    record.Class = classes.setdefault(key, count + len(classes))
            if not classes:
                continue
            new = sorted(classes.items(), key=lambda kv: kv[1])

            if kind == 4:
                for glyph, record in zip(
                    subtable.BaseCoverage.glyphs,
                    subtable.BaseArray.BaseRecord,
                    strict=True,
                ):
                    record.BaseAnchor = _extend(
                        record.BaseAnchor, glyph, new, group, applied
                    )
            else:
                for glyph, attach in zip(
                    subtable.LigatureCoverage.glyphs,
                    subtable.LigatureArray.LigatureAttach,
                    strict=True,
                ):
                    for component in attach.ComponentRecord:
                        component.LigatureAnchor = _extend(
                            component.LigatureAnchor, glyph, new, group, applied
                        )
            subtable.ClassCount = count + len(classes)
        for split, done in zip(group, applied, strict=True):
            if not done:
                target = split["target"]
                raise BakeError(
                    f"{target['glyph']} has no anchor in class {target['class']}"
                    f" for {', '.join(target['marks'])}"
                )


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


def _coverage(glyphs: list[str]) -> Any:
    c = ot.Coverage()
    c.glyphs = list(glyphs)
    return c


def _lookup(kind: int, subtables: list[Any], flag: int = 0) -> Any:
    lookup = ot.Lookup()
    lookup.LookupType = kind
    lookup.LookupFlag = flag
    lookup.SubTable = subtables
    lookup.SubTableCount = len(subtables)
    return lookup


def _swap_lookups(font: TTFont, swaps: list[tuple[str, str, str]]) -> None:
    """Adds one lookup that swaps each (base, dot, clone): the dot glyph
    right after the base becomes the clone.
    """
    gsub: Any = font["GSUB"].table
    lookups = gsub.LookupList.Lookup
    rules = []
    for base, dot, clone in swaps:
        sub = ot.SingleSubst()
        sub.mapping = {dot: clone}
        lookups.append(_lookup(1, [sub]))
        rule = ot.ChainContextSubst()
        rule.Format = 3
        rule.BacktrackCoverage = [_coverage([base])]
        rule.BacktrackGlyphCount = 1
        rule.InputCoverage = [_coverage([dot])]
        rule.InputGlyphCount = 1
        rule.LookAheadCoverage = []
        rule.LookAheadGlyphCount = 0
        record = ot.SubstLookupRecord()
        record.SequenceIndex = 0
        record.LookupListIndex = len(lookups) - 1
        rule.SubstLookupRecord = [record]
        rule.SubstCount = 1
        rules.append(rule)
    lookups.append(_lookup(6, rules))
    gsub.LookupList.LookupCount = len(lookups)
    _add_to_feature(gsub, SWAP_FEATURE, len(lookups) - 1)


def _mark_set(font: TTFont, glyphs: list[str]) -> int:
    """The index of a new GDEF mark glyph set holding `glyphs`."""
    gdef: Any = font["GDEF"].table
    if getattr(gdef, "MarkGlyphSetsDef", None) is None:
        gdef.Version = max(getattr(gdef, "Version", 0x00010000), 0x00010002)
        sets = ot.MarkGlyphSetsDef()
        sets.MarkSetTableFormat = 1
        sets.Coverage = []
        gdef.MarkGlyphSetsDef = sets
    sets = gdef.MarkGlyphSetsDef
    sets.Coverage.append(_coverage(glyphs))
    sets.MarkSetCount = len(sets.Coverage)
    return len(sets.Coverage) - 1


def pair_lookups(font: TTFont, pairs: list[dict[str, Any]]) -> None:
    """Adds, after every GPOS lookup, one chained contextual lookup per mark
    that adjusts it after each named base, skipping every other mark.
    """
    if not pairs:
        return
    gpos: Any = font["GPOS"].table
    lookups = gpos.LookupList.Lookup
    by_mark: dict[str, list[dict[str, Any]]] = {}
    for pair in pairs:
        by_mark.setdefault(pair["target"]["mark"], []).append(pair)
    chains = []
    for mark, group in by_mark.items():
        rules = []
        for pair in group:
            single = ot.SinglePos()
            single.Format = 1
            single.Coverage = _coverage([mark])
            value = ot.ValueRecord()
            value.XPlacement = pair["dx"]
            value.YPlacement = pair["dy"]
            single.Value = value
            single.ValueFormat = 0x0003
            lookups.append(_lookup(1, [single]))
            rule = ot.ChainContextPos()
            rule.Format = 3
            rule.BacktrackCoverage = [_coverage([pair["target"]["base"]])]
            rule.BacktrackGlyphCount = 1
            rule.InputCoverage = [_coverage([mark])]
            rule.InputGlyphCount = 1
            rule.LookAheadCoverage = []
            rule.LookAheadGlyphCount = 0
            record = ot.PosLookupRecord()
            record.SequenceIndex = 0
            record.LookupListIndex = len(lookups) - 1
            rule.PosLookupRecord = [record]
            rule.PosCount = 1
            rules.append(rule)
        chain = _lookup(8, rules, flag=0x0010)
        chain.MarkFilteringSet = _mark_set(font, [mark])
        chains.append(chain)
    for chain in chains:
        lookups.append(chain)
        _add_to_feature(gpos, PAIR_FEATURE, len(lookups) - 1)
    gpos.LookupList.LookupCount = len(lookups)


def _add_to_feature(table: Any, tag: str, lookup_index: int) -> None:
    """Adds a lookup to the `tag` feature of every Arabic language system,
    making the feature where a system lacks it.
    """
    for script in table.ScriptList.ScriptRecord:
        if script.ScriptTag != "arab":
            continue
        systems = [script.Script.DefaultLangSys] + [
            r.LangSys for r in script.Script.LangSysRecord
        ]
        for system in systems:
            if system is None:
                continue
            records = table.FeatureList.FeatureRecord
            found = [i for i in system.FeatureIndex if records[i].FeatureTag == tag]
            if found:
                for i in found:
                    feature = records[i].Feature
                    if lookup_index not in feature.LookupListIndex:
                        feature.LookupListIndex.append(lookup_index)
                        feature.LookupCount = len(feature.LookupListIndex)
                continue
            record = ot.FeatureRecord()
            record.FeatureTag = tag
            record.Feature = ot.Feature()
            record.Feature.LookupListIndex = [lookup_index]
            record.Feature.LookupCount = 1
            record.Feature.FeatureParams = None
            records.append(record)
            table.FeatureList.FeatureCount = len(records)
            system.FeatureIndex.append(len(records) - 1)
            system.FeatureCount = len(system.FeatureIndex)


def bake(font: TTFont, edits: list[dict[str, Any]]) -> TTFont:
    """Applies edits to `font` in place and returns it: outlines first, so
    the anchor edits land on anchors the outlines moved, then anchors, split
    classes and mark-to-mark anchors, and the pair lookups last.
    """
    order = set(font.getGlyphOrder())

    def glyph(name: str) -> str:
        if name not in order:
            raise BakeError(f"the font has no glyph {name}")
        return name

    by: dict[str, list[dict[str, Any]]] = {m: [] for m in MECHANISMS}
    for edit in edits:
        if edit["dx"] or edit["dy"]:
            by[edit["mechanism"]].append(edit)
    clones: list[tuple[str, str, str, int, int]] = []
    outlined: set[str] = set()
    for edit in by["outline"]:
        name, part = glyph(edit["target"]["glyph"]), edit["target"]["part"]
        dx, dy = edit["dx"], edit["dy"]
        outlined.add(name)
        if part == "body":
            move_body(font, name, dx, dy)
        elif ":" in part:
            move_inline(font, name, part, dx, dy)
        elif part in order:
            clones.append((name, part, f"{part}.lab.{name}", dx, dy))
        else:
            raise BakeError(f"{name}: no dot glyph {part}")
    for _base, dot, clone, dx, dy in clones:
        _clone_glyph(font, dot, clone, dx, dy)
    pairs = [(dot, clone) for _base, dot, clone, _dx, _dy in clones]
    _follow_in_gpos(font, pairs)
    _follow_in_gdef(font, pairs)
    if clones:
        _swap_lookups(font, [(base, dot, clone) for base, dot, clone, _, _ in clones])
    for edit in by["anchor"]:
        target = edit["target"]
        move_anchor(
            font, glyph(target["glyph"]), target["class"], edit["dx"], edit["dy"]
        )
    for edit in by["split-class"]:
        glyph(edit["target"]["glyph"])
        for mark in edit["target"]["marks"]:
            glyph(mark)
    split_classes(font, by["split-class"])
    for edit in by["mkmk-anchor"]:
        target = edit["target"]
        move_mark2(
            font, glyph(target["glyph"]), target["class"], edit["dx"], edit["dy"]
        )
    for edit in by["pair"]:
        glyph(edit["target"]["base"])
        glyph(edit["target"]["mark"])
    pair_lookups(font, by["pair"])
    hmtx: Any = font["hmtx"]
    glyf: Any = font["glyf"]
    for name in outlined:
        drawn = glyf[name]
        drawn.recalcBounds(glyf)
        hmtx[name] = (hmtx[name][0], getattr(drawn, "xMin", 0))
    return font


def preview(overrides: Path, fonts: Path) -> Path:
    """Writes calib-preview.ttf and calib-preview.json into `fonts`."""
    from fontTools.ttLib import TTFont

    try:
        value = json.loads(overrides.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise BakeError(f"cannot read {overrides}: {exc}") from exc
    lab = json.loads((fonts / "lab.json").read_text(encoding="utf-8"))

    def body_of(key: dict[str, Any]) -> str | None:
        form = lab.get("letterForms", {}).get(f"{key['letter']}|{key['form']}")
        return form.get("body") if form else None

    edits, requests = edits_of(value, body_of)
    font = TTFont(fonts / "calib.ttf")
    bake(font, edits)
    out = fonts / PREVIEW
    font.save(out)
    (fonts / BAKED).write_text(
        json.dumps(
            {
                "build": lab["build"],
                "source": overrides.name,
                "edits": [
                    {
                        "mechanism": e["mechanism"],
                        "scope": "pair",
                        "target": e["target"],
                        "values": {"400": {"dx": e["dx"], "dy": e["dy"]}},
                        "usedBy": [],
                        "build": lab["build"],
                        "updated": "",
                    }
                    for e in edits
                ],
                "requests": requests,
            },
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
