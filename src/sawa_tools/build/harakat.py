"""Builds the Harakat twin of a Sawa family: the finished variable font
with its tashkeel coloured by mark group through COLR and CPAL.

The groups are data/mark-groups.json's and the colours data/palettes.json's,
which the site reads for its legend too. Every glyph that only a mark
group's codepoints reach is a COLRv0 base glyph whose one layer is itself,
so its outline keeps following gvar; a ligature of marks from two groups
(shadda and kasra) gets one layer glyph per group, each with its slice of
the ligature's gvar deltas. A mark glyph that a letter decomposes into
(the hamza of U+0623, the small v of U+06CE) gets a copy for the letter,
positioned wherever the mark is, so every letter keeps the text colour.
Shaping gives the same glyphs and positions as the plain family.
"""

from __future__ import annotations

import copy
import hashlib
import json
import re
from dataclasses import dataclass, replace
from itertools import product
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from collections.abc import Iterable, Mapping

    from fontTools.ttLib import TTFont

    from sawa_tools.build.families import BuiltFamily, Family

PALETTES_FILE = "palettes.json"
GROUPS_FILE = "mark-groups.json"
SUFFIX = "Harakat"
# The copy of a mark glyph that letters decompose into.
LETTER_SUFFIX = ".letter"

_CODE_MODULES = ("harakat.py", "naming.py")
_HEX_RE = re.compile(r"^#[0-9a-f]{6}$")
_KINDS = ("groups", "gray")
_SCHEMES = ("light", "dark")
# CPAL v1 palette type flags: usable on a light, and on a dark, background.
_PALETTE_TYPES = {"light": 0x0001, "dark": 0x0002}
_MARK_CLASS = 3


class HarakatError(Exception):
    """Raised when a font or the palette data can't be coloured as described."""


@dataclass(frozen=True)
class Palette:
    kind: str
    scheme: str
    label: str
    # One colour per mark group, in mark-groups.json order.
    colours: tuple[str, ...]


def load_groups(path: Path) -> dict[str, list[int]]:
    """mark-groups.json as {group id: codepoints}, in file order."""
    from sawa_tools.checks.marks import MarksError, _parse_codepoints

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return {
            group["id"]: [
                cp for spec in group["codepoints"] for cp in _parse_codepoints(spec)
            ]
            for group in data["groups"]
        }
    except (OSError, json.JSONDecodeError, KeyError, TypeError, MarksError) as exc:
        raise HarakatError(f"cannot read mark groups from {path}: {exc}") from exc


def load_palettes(path: Path, group_ids: Iterable[str]) -> list[Palette]:
    """The CPAL palettes data/palettes.json describes, in its `order`."""
    ids = list(group_ids)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise HarakatError(f"cannot read {path}: {exc}") from exc

    def colour(value: Any, where: str) -> str:
        if not isinstance(value, str) or not _HEX_RE.match(value):
            raise HarakatError(f"{path}: {where} must be a lowercase #rrggbb colour")
        return value

    def schemes(value: Any, where: str) -> dict[str, str]:
        if not isinstance(value, dict) or set(value) != set(_SCHEMES):
            raise HarakatError(f"{path}: {where} must give exactly {_SCHEMES}")
        return {s: colour(value[s], f"{where}.{s}") for s in _SCHEMES}

    groups = data.get("groups")
    if not isinstance(groups, dict) or set(groups) != set(ids):
        raise HarakatError(f"{path}: 'groups' must give a colour to exactly {ids}")
    group_colours = {g: schemes(groups[g], f"groups.{g}") for g in ids}
    gray = schemes(data.get("gray"), "gray")
    order = data.get("order")
    if not isinstance(order, list) or not order:
        raise HarakatError(f"{path}: 'order' must list the palettes")
    palettes = []
    for i, entry in enumerate(order):
        where = f"order[{i}]"
        if not isinstance(entry, dict):
            raise HarakatError(f"{path}: {where} must be an object")
        kind, scheme, label = (
            entry.get("palette"),
            entry.get("scheme"),
            entry.get("label"),
        )
        if kind not in _KINDS or scheme not in _SCHEMES or not isinstance(label, str):
            raise HarakatError(
                f"{path}: {where} needs a palette in {_KINDS}, a scheme in "
                f"{_SCHEMES} and a label"
            )
        colours = (
            tuple(group_colours[g][scheme] for g in ids)
            if kind == "groups"
            else (gray[scheme],) * len(ids)
        )
        palettes.append(Palette(kind, scheme, label, colours))
    if len({(p.kind, p.scheme) for p in palettes}) != len(palettes):
        raise HarakatError(f"{path}: 'order' lists a palette twice")
    return palettes


def twin_family(family: Family) -> Family:
    """The Harakat twin of `family`: its own id and name, nothing else changed."""
    return replace(
        family,
        id=f"{family.id}-{SUFFIX.lower()}",
        name=f"{family.name} {SUFFIX}",
        harakat=False,
    )


def _closure(font: TTFont, codepoints: Iterable[int]) -> set[str]:
    from fontTools import subset

    subsetter = subset.Subsetter(
        subset.Options(layout_features=["*"], notdef_outline=False)
    )
    subsetter.populate(unicodes=sorted(set(codepoints)))
    subsetter._closure_glyphs(font)
    # glyphs_gsubed stops before the glyf closure, so composite components
    # stay out.
    return set(subsetter.glyphs_gsubed)


def _letter_codepoints(font: TTFont, groups: Mapping[str, list[int]]) -> list[int]:
    marks = {cp for cps in groups.values() for cp in cps}
    return [cp for cp in (font.getBestCmap() or {}) if cp not in marks]


def _subtables(font: TTFont, tag: str) -> Iterable[tuple[int, Any]]:
    """Every (lookup type, subtable) of GSUB or GPOS, extensions unwrapped."""
    if tag not in font:
        return
    extension = 7 if tag == "GSUB" else 9
    layout: Any = font[tag]
    for lookup in layout.table.LookupList.Lookup:
        for subtable in lookup.SubTable:
            if lookup.LookupType == extension:
                yield subtable.ExtSubTable.LookupType, subtable.ExtSubTable
            else:
                yield lookup.LookupType, subtable


@dataclass(frozen=True)
class MarkGlyphs:
    """Which mark group colours each glyph: `assigned` maps a glyph to its
    one group, `mixed` holds the ligatures of marks from several groups.
    """

    assigned: dict[str, str]
    mixed: set[str]


def classify(font: TTFont, groups: Mapping[str, list[int]]) -> MarkGlyphs:
    """The glyphs of `font` that need a mark group's codepoints to be
    reached: a glyph one group's codepoints reach, with every other
    codepoint of the font, belongs to that group; one that needs several
    groups is mixed. Letters must not reach any mark glyph (separate()).
    """
    letters = _letter_codepoints(font, groups)
    base = _closure(font, letters)
    assigned: dict[str, str] = {}
    for group, codepoints in groups.items():
        for glyph in _closure(font, [*letters, *codepoints]) - base:
            if glyph in assigned:
                raise HarakatError(
                    f"{glyph} is reached from both {assigned[glyph]} and {group} marks"
                )
            assigned[glyph] = group
    every = {cp for cps in groups.values() for cp in cps}
    mixed = _closure(font, [*letters, *every]) - base - set(assigned)
    return MarkGlyphs(assigned, mixed)


def _copy_glyph(font: TTFont, src: str, new: str) -> None:
    """Appends `new` to the glyph order as an exact copy of `src`'s outline,
    variations, metrics and GDEF class.
    """
    glyf = font["glyf"]
    order = [*font.getGlyphOrder(), new]
    glyf.glyphs[new] = copy.deepcopy(glyf[src])
    glyf.glyphOrder = order
    font.setGlyphOrder(order)
    if "gvar" in font:
        gvar = font["gvar"]
        gvar.variations[new] = copy.deepcopy(gvar.variations.get(src, []))
    font["hmtx"].metrics[new] = font["hmtx"].metrics[src]
    if "HVAR" in font:
        hvar = font["HVAR"].table
        for mapping in (hvar.AdvWidthMap, hvar.LsbMap, hvar.RsbMap):
            if mapping is not None:
                mapping.mapping[new] = mapping.mapping[src]
        if hvar.AdvWidthMap is None:
            raise HarakatError("HVAR without an advance width map is not supported")
    if "GDEF" in font:
        classes = font["GDEF"].table.GlyphClassDef
        if classes is not None and src in classes.classDefs:
            classes.classDefs[new] = classes.classDefs[src]


def separate(font: TTFont, groups: Mapping[str, list[int]]) -> dict[str, str]:
    """Gives letters their own copy of every mark glyph they decompose into.

    A multiple substitution whose input is a letter (U+0623 to alef and
    hamza above) outputs the copy instead. Returns {mark glyph: copy}; the
    copies are in no other lookup yet (mirror() puts them there).
    """
    letters = _letter_codepoints(font, groups)
    base = _closure(font, letters)
    marks = _closure(font, [cp for cps in groups.values() for cp in cps])
    shared = sorted((marks & base) - {".notdef"}, key=font.getGlyphID)
    if not shared:
        return {}
    aliases = {glyph: f"{glyph}{LETTER_SUFFIX}" for glyph in shared}
    for glyph, alias in aliases.items():
        if alias in font.getGlyphOrder():
            raise HarakatError(f"{alias} already exists")
        _copy_glyph(font, glyph, alias)
    letter_glyphs = base - marks
    for lookup_type, subtable in _subtables(font, "GSUB"):
        if lookup_type != 2:
            continue
        for key, out in subtable.mapping.items():
            if key in letter_glyphs:
                subtable.mapping[key] = [aliases.get(g, g) for g in out]
    left = _closure(font, letters) & set(shared)
    if left:
        raise HarakatError(
            "letters reach the mark glyphs "
            + ", ".join(sorted(left))
            + " other than by a multiple substitution"
        )
    return aliases


class _Mirror:
    """Makes every layout table treat each alias exactly as its source.

    The aliases come last in the glyph order, in `aliases` order, so
    appending them keeps every coverage table sorted by glyph ID.
    """

    def __init__(self, aliases: Mapping[str, str]) -> None:
        self.pairs = list(aliases.items())
        self.alias = dict(aliases)

    def coverage(self, cov: Any, *arrays: list[Any]) -> None:
        if cov is None:
            return
        for src, dup in self.pairs:
            if src in cov.glyphs and dup not in cov.glyphs:
                i = cov.glyphs.index(src)
                cov.glyphs.append(dup)
                for array in arrays:
                    array.append(copy.deepcopy(array[i]))

    def classdef(self, classdef: Any) -> None:
        if classdef is None:
            return
        for src, dup in self.pairs:
            if src in classdef.classDefs:
                classdef.classDefs[dup] = classdef.classDefs[src]

    def keyed(self, mapping: dict[str, Any]) -> None:
        for src, dup in self.pairs:
            if src in mapping:
                mapping[dup] = copy.deepcopy(mapping[src])

    def variants(self, seq: list[str]) -> list[list[str]]:
        """Every copy of `seq` with at least one source swapped for its alias."""
        options = [[g, self.alias[g]] if g in self.alias else [g] for g in seq]
        return [list(v) for v in product(*options)][1:]

    def ligatures(self, subtable: Any) -> None:
        from fontTools.ttLib.tables import otTables

        ot: Any = otTables
        out: dict[str, list[Any]] = {}
        for first, ligs in subtable.ligatures.items():
            for lig in ligs:
                out.setdefault(first, []).append(lig)
                for seq in self.variants([first, *lig.Component]):
                    new = ot.Ligature()
                    new.LigGlyph, new.Component = lig.LigGlyph, seq[1:]
                    new.CompCount = len(seq)
                    out.setdefault(seq[0], []).append(new)
        subtable.ligatures = out

    def rules(self, rulesets: list[Any]) -> None:
        """Format 1 context rules: each rule with an aliased glyph in it
        gets its variants right after it.
        """
        fields = ("Backtrack", "Input", "LookAhead")
        for ruleset in rulesets:
            if ruleset is None:
                continue
            attr = next(a for a in vars(ruleset) if a.endswith("Rule"))
            rules = getattr(ruleset, attr)
            out = []
            for rule in rules:
                out.append(rule)
                present = [f for f in fields if hasattr(rule, f)]
                lengths = [len(getattr(rule, f)) for f in present]
                flat = [g for f in present for g in getattr(rule, f)]
                for seq in self.variants(flat):
                    new = copy.deepcopy(rule)
                    start = 0
                    for f, n in zip(present, lengths, strict=True):
                        setattr(new, f, seq[start : start + n])
                        start += n
                    out.append(new)
            setattr(ruleset, attr, out)

    def context(self, subtable: Any) -> None:
        if subtable.Format == 1:
            attr = next(a for a in vars(subtable) if a.endswith("RuleSet"))
            rulesets = getattr(subtable, attr)
            self.rules(rulesets)
            self.coverage(subtable.Coverage, rulesets)
        elif subtable.Format == 2:
            self.coverage(subtable.Coverage)
            for attr in (
                "ClassDef",
                "BacktrackClassDef",
                "InputClassDef",
                "LookAheadClassDef",
            ):
                self.classdef(getattr(subtable, attr, None))
        else:
            for attr in (
                "Coverage",
                "BacktrackCoverage",
                "InputCoverage",
                "LookAheadCoverage",
            ):
                for cov in getattr(subtable, attr, None) or []:
                    self.coverage(cov)

    def gsub(self, lookup_type: int, st: Any) -> None:
        if lookup_type in (1, 2):
            self.keyed(st.mapping)
        elif lookup_type == 3:
            self.keyed(st.alternates)
        elif lookup_type == 4:
            self.ligatures(st)
        elif lookup_type in (5, 6):
            self.context(st)
        elif lookup_type == 8:
            self.coverage(st.Coverage, st.Substitute)
            for cov in [*st.BacktrackCoverage, *st.LookAheadCoverage]:
                self.coverage(cov)
        else:
            raise HarakatError(f"GSUB lookup type {lookup_type} is not supported")

    def gpos(self, lookup_type: int, st: Any) -> None:
        if lookup_type == 1:
            self.coverage(st.Coverage, *([st.Value] if st.Format == 2 else []))
        elif lookup_type == 2 and st.Format == 1:
            for pairset in st.PairSet:
                records = pairset.PairValueRecord
                for src, dup in self.pairs:
                    for record in [r for r in records if r.SecondGlyph == src]:
                        new = copy.deepcopy(record)
                        new.SecondGlyph = dup
                        records.append(new)
            self.coverage(st.Coverage, st.PairSet)
        elif lookup_type == 2:
            self.coverage(st.Coverage)
            self.classdef(st.ClassDef1)
            self.classdef(st.ClassDef2)
        elif lookup_type == 3:
            self.coverage(st.Coverage, st.EntryExitRecord)
        elif lookup_type == 4:
            self.coverage(st.MarkCoverage, st.MarkArray.MarkRecord)
            self.coverage(st.BaseCoverage, st.BaseArray.BaseRecord)
        elif lookup_type == 5:
            self.coverage(st.MarkCoverage, st.MarkArray.MarkRecord)
            self.coverage(st.LigatureCoverage, st.LigatureArray.LigatureAttach)
        elif lookup_type == 6:
            self.coverage(st.Mark1Coverage, st.Mark1Array.MarkRecord)
            self.coverage(st.Mark2Coverage, st.Mark2Array.Mark2Record)
        elif lookup_type in (7, 8):
            self.context(st)
        else:
            raise HarakatError(f"GPOS lookup type {lookup_type} is not supported")

    def gdef(self, table: Any) -> None:
        self.classdef(table.MarkAttachClassDef)
        if getattr(table, "MarkGlyphSetsDef", None) is not None:
            for cov in table.MarkGlyphSetsDef.Coverage:
                self.coverage(cov)
        if table.AttachList is not None:
            self.coverage(table.AttachList.Coverage, table.AttachList.AttachPoint)
        if table.LigCaretList is not None:
            self.coverage(table.LigCaretList.Coverage, table.LigCaretList.LigGlyph)


def mirror(font: TTFont, aliases: Mapping[str, str]) -> None:
    """Puts each alias wherever GSUB, GPOS and GDEF name its source."""
    if not aliases:
        return
    mirror = _Mirror(aliases)
    for lookup_type, subtable in _subtables(font, "GSUB"):
        mirror.gsub(lookup_type, subtable)
    for lookup_type, subtable in _subtables(font, "GPOS"):
        mirror.gpos(lookup_type, subtable)
    if "GDEF" in font:
        mirror.gdef(font["GDEF"].table)


def _ligature_inputs(font: TTFont) -> dict[str, list[list[str]]]:
    found: dict[str, list[list[str]]] = {}
    for lookup_type, subtable in _subtables(font, "GSUB"):
        if lookup_type != 4:
            continue
        for first, ligs in subtable.ligatures.items():
            for lig in ligs:
                found.setdefault(lig.LigGlyph, []).append([first, *lig.Component])
    return found


def _contours(glyf: Any, name: str) -> list[list[tuple[int, int]]]:
    coords, ends, _ = glyf[name].getCoordinates(glyf)
    out, start = [], 0
    for end in ends:
        out.append([tuple(p) for p in coords[start : end + 1]])
        start = end + 1
    return out


def _same_shape(
    a: list[tuple[int, int]], b: list[tuple[int, int]], tol: int = 2
) -> bool:
    if len(a) != len(b):
        return False
    ax, ay = min(p[0] for p in a), min(p[1] for p in a)
    bx, by = min(p[0] for p in b), min(p[1] for p in b)
    return all(
        abs((p[0] - ax) - (q[0] - bx)) <= tol and abs((p[1] - ay) - (q[1] - by)) <= tol
        for p, q in zip(a, b, strict=True)
    )


def _split(
    font: TTFont, lig: str, inputs: list[str], assigned: Mapping[str, str]
) -> dict[str, list[int]]:
    """{group: indices of `lig`'s components, or of its contours if it is
    a simple glyph} for each group among `inputs`: a piece matches the input
    it is drawn from, and pieces no input matches go to the one input left.
    """
    glyf = font["glyf"]
    glyph = glyf[lig]
    if glyph.isComposite():
        pieces: list[Any] = [c.glyphName for c in glyph.components]

        def matches(piece: Any, name: str) -> bool:
            return piece == name
    else:
        pieces = _contours(glyf, lig)
        drawn = {name: _contours(glyf, name) for name in inputs}

        def matches(piece: Any, name: str) -> bool:
            return any(_same_shape(piece, c) for c in drawn[name])

    by_piece: dict[int, str] = {}
    for i, piece in enumerate(pieces):
        name = next((n for n in inputs if matches(piece, n)), None)
        if name is not None:
            by_piece[i] = name
    left = [n for n in inputs if n not in by_piece.values()]
    unmatched = [i for i in range(len(pieces)) if i not in by_piece]
    if unmatched:
        if len(left) != 1:
            raise HarakatError(
                f"cannot tell which of {inputs} draws pieces {unmatched} of {lig}"
            )
        by_piece |= dict.fromkeys(unmatched, left[0])
    out: dict[str, list[int]] = {}
    for i, name in sorted(by_piece.items()):
        out.setdefault(assigned[name], []).append(i)
    return out


def _layer_glyph(font: TTFont, src: str, new: str, pieces: list[int]) -> None:
    """Appends `new`: the components or contours `pieces` of `src`, with
    their slice of its gvar deltas and its metrics.
    """
    glyf = font["glyf"]
    whole = glyf[src]
    glyph = copy.deepcopy(whole)
    if glyph.isComposite():
        keep = pieces
        glyph.components = [glyph.components[i] for i in pieces]
        count = len(whole.components)
    else:
        ends = whole.endPtsOfContours
        starts = [0, *[e + 1 for e in ends[:-1]]]
        keep = [p for c in pieces for p in range(starts[c], ends[c] + 1)]
        glyph.coordinates = type(whole.coordinates)(
            [whole.coordinates[p] for p in keep]
        )
        glyph.flags = type(whole.flags)([whole.flags[p] for p in keep])
        glyph.endPtsOfContours, total = [], 0
        for c in pieces:
            total += ends[c] - starts[c] + 1
            glyph.endPtsOfContours.append(total - 1)
        glyph.numberOfContours = len(pieces)
        count = len(whole.coordinates)
    _copy_glyph(font, src, new)
    glyf.glyphs[new] = glyph
    glyph.recalcBounds(glyf)
    if "gvar" in font:
        from fontTools.ttLib.tables.TupleVariation import TupleVariation

        gvar = font["gvar"]
        # The four phantom points follow the outline's own points.
        gvar.variations[new] = [
            TupleVariation(
                tv.axes,
                [tv.coordinates[p] for p in keep] + tv.coordinates[count : count + 4],
            )
            for tv in gvar.variations.get(src, [])
        ]


def _rename(font: TTFont, family: str, new_family: str) -> None:
    from sawa_tools.build.naming import family_name_records, rename_text

    ids = {name_id for name_id, _ in family_name_records(font)}
    for record in font["name"].names:
        if record.nameID in ids:
            record.string = rename_text(record.toUnicode(), family, new_family)


@dataclass(frozen=True)
class Coloured:
    colour_glyphs: int
    letter_copies: dict[str, str]
    split: dict[str, dict[str, list[int]]]


def colour(
    font: TTFont,
    groups: Mapping[str, list[int]],
    palettes: list[Palette],
    family: str,
    new_family: str,
) -> Coloured:
    """Turns `font`, a finished Sawa variable font, into its Harakat twin in place."""
    from fontTools.colorLib.builder import ColorPaletteType, buildCOLR, buildCPAL

    # Every table must be decompiled before the glyph order grows.
    font.ensureDecompiled()
    for tag in ("COLR", "CPAL"):
        if tag in font:
            raise HarakatError(f"the font already has a {tag} table")
    order = list(groups)
    lig_inputs = _ligature_inputs(font)
    aliases = separate(font, groups)
    marks = classify(font, groups)
    mirror(font, aliases)

    layers: dict[str, list[tuple[str, int]]] = {
        glyph: [(glyph, order.index(group))] for glyph, group in marks.assigned.items()
    }
    split = {}
    for lig in sorted(marks.mixed, key=font.getGlyphID):
        inputs = next(
            (
                seq
                for seq in lig_inputs.get(lig, [])
                if all(g in marks.assigned for g in seq)
            ),
            None,
        )
        if inputs is None:
            raise HarakatError(
                f"{lig} needs several mark groups but is no ligature of their marks"
            )
        parts = _split(font, lig, inputs, marks.assigned)
        split[lig] = parts
        layers[lig] = []
        for group in sorted(parts, key=order.index):
            layer = f"{lig}.{group}"
            _layer_glyph(font, lig, layer, parts[group])
            layers[lig].append((layer, order.index(group)))

    colour_glyphs: dict[str, Any] = dict(layers)
    font["COLR"] = buildCOLR(
        colour_glyphs, version=0, glyphMap=font.getReverseGlyphMap()
    )
    font["CPAL"] = buildCPAL(
        [[_rgba(c) for c in p.colours] for p in palettes],
        paletteTypes=[ColorPaletteType(_PALETTE_TYPES[p.scheme]) for p in palettes],
        paletteLabels=[p.label for p in palettes],
        paletteEntryLabels=[f"{group} marks" for group in order],
        nameTable=font["name"],
    )
    _rename(font, family, new_family)
    return Coloured(len(layers), aliases, split)


def _rgba(hex_colour: str) -> tuple[float, float, float, float]:
    return (
        int(hex_colour[1:3], 16) / 255,
        int(hex_colour[3:5], 16) / 255,
        int(hex_colour[5:7], 16) / 255,
        1.0,
    )


def _digest(plain_stamp: Path, data: Iterable[Path]) -> str:
    from fontTools import version as fonttools_version

    from sawa_tools.build.masters import code_bytes

    digest = hashlib.sha256(fonttools_version.encode())
    for path in [plain_stamp, *data]:
        digest.update(code_bytes(path))
    here = Path(__file__).parent
    for module in _CODE_MODULES:
        digest.update(code_bytes(here / module))
    return digest.hexdigest()


def build_twin(
    plain: BuiltFamily,
    *,
    fonts_dir: Path,
    data_dir: Path,
    force: bool = False,
) -> BuiltFamily:
    """Builds the Harakat twin of the built family `plain` into `fonts_dir`
    from `data_dir`'s mark groups and palettes, or reuses a fresh earlier
    build: one whose plain family's stamp, data and code are unchanged.
    """
    from fontTools.ttLib import TTFont

    from sawa_tools.build.families import BuiltFamily, is_fresh

    family = plain.family
    twin = twin_family(family)
    ttf = fonts_dir / twin.ttf_name
    woff2 = fonts_dir / twin.woff2_name if plain.woff2 is not None else None
    outputs = [ttf] if woff2 is None else [ttf, woff2]
    stamp = fonts_dir / f"{twin.id}.stamp"
    groups_path, palettes_path = data_dir / GROUPS_FILE, data_dir / PALETTES_FILE
    digest = _digest(fonts_dir / f"{family.id}.stamp", [groups_path, palettes_path])
    if not force and not plain.rebuilt and is_fresh(stamp, digest, outputs):
        return BuiltFamily(twin, ttf, woff2, rebuilt=False)

    groups = load_groups(groups_path)
    palettes = load_palettes(palettes_path, groups)
    font = TTFont(plain.ttf, lazy=False, recalcTimestamp=False)
    colour(font, groups, palettes, family.name, twin.name)
    stamp.unlink(missing_ok=True)
    for path, flavor in ((ttf, None), (woff2, "woff2")):
        if path is None:
            continue
        font.flavor = flavor
        tmp = path.with_name(path.name + ".tmp")
        font.save(tmp)
        tmp.replace(path)
    tmp = stamp.with_name(stamp.name + ".tmp")
    tmp.write_text(digest + "\n", encoding="utf-8")
    tmp.replace(stamp)
    return BuiltFamily(twin, ttf, woff2, rebuilt=True)
