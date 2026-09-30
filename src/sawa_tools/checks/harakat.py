"""Checks a Harakat twin (build/harakat.py) against its plain family.

The COLR base glyphs must be exactly the mark glyphs of data/mark-groups.json
the plain font has, each layer a mark glyph coloured by its group or a split
layer of a mixed ligature; CPAL must hold data/palettes.json's palettes with
their light and dark types; HarfBuzz must colour every mark on a dotted
circle with its group's entry and no glyph of the sample lines with their
marks taken out; and the stress strings and mixed sentences must shape to
the plain family's glyphs and positions at the wght minimum and maximum.
"""

from __future__ import annotations

import importlib
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from collections.abc import Iterable, Mapping
    from pathlib import Path

    from sawa_tools.build.harakat import Palette
    from sawa_tools.checks.fonts import Line

DOTTED_CIRCLE = "◌"
# The sample lines shaping must match the plain family's on.
SAME_SHAPING = ("stress/", "mixed/")


def _shape(face: Any, text: str, weight: float) -> list[tuple[int, int, int, int, int]]:
    hb: Any = importlib.import_module("uharfbuzz")
    font = hb.Font(face)
    font.set_variations({"wght": weight})
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(font, buf)
    return [
        (info.codepoint, info.cluster, pos.x_advance, pos.x_offset, pos.y_offset)
        for info, pos in zip(buf.glyph_infos, buf.glyph_positions, strict=True)
    ]


def colr_errors(font: Any, plain: Any, groups: Mapping[str, list[int]]) -> list[str]:
    from sawa_tools.build.harakat import HarakatError, classify, separate

    if "COLR" not in font or font["COLR"].version != 0:
        return ["no COLRv0 table"]
    try:
        separate(plain, groups)
        expected = classify(plain, groups)
    except HarakatError as exc:
        return [f"cannot classify the plain family's mark glyphs: {exc}"]
    order = list(groups)
    colr: dict[str, list[tuple[str, int]]] = {
        base: [(layer.name, layer.colorID) for layer in layers]
        for base, layers in font["COLR"].ColorLayers.items()
    }
    errors = []
    want = set(expected.assigned) | expected.mixed
    missing, extra = sorted(want - set(colr)), sorted(set(colr) - want)
    if missing:
        errors.append("mark glyphs without colour: " + ", ".join(missing))
    if extra:
        errors.append("coloured glyphs that are no mark: " + ", ".join(extra))
    glyphs = set(font.getGlyphOrder())
    for base, layers in sorted(colr.items()):
        if base in expected.assigned:
            index = order.index(expected.assigned[base])
            if layers != [(base, index)]:
                errors.append(f"{base}: layers {layers}, not itself in entry {index}")
            continue
        for name, index in layers:
            group = order[index] if 0 <= index < len(order) else None
            if name not in glyphs or name != f"{base}.{group}":
                errors.append(
                    f"{base}: layer {name} in entry {index} is no split layer"
                )
        if len(layers) < 2:
            errors.append(f"{base}: a mixed ligature with {len(layers)} layer")
    return errors


def cpal_errors(font: Any, palettes: list[Palette], entries: int) -> list[str]:
    if "CPAL" not in font:
        return ["no CPAL table"]
    cpal = font["CPAL"]
    errors = []
    if cpal.version != 1:
        errors.append(f"CPAL version {cpal.version}, not 1")
    if len(cpal.palettes) != len(palettes):
        return [*errors, f"{len(cpal.palettes)} palettes, not {len(palettes)}"]
    if cpal.numPaletteEntries != entries:
        errors.append(f"{cpal.numPaletteEntries} palette entries, not {entries}")
    flags = {"light": 0x0001, "dark": 0x0002}
    for i, (found, palette) in enumerate(zip(cpal.palettes, palettes, strict=True)):
        if (
            getattr(cpal, "paletteTypes", [0] * len(palettes))[i]
            != flags[palette.scheme]
        ):
            errors.append(f"palette {i} is not typed {palette.scheme}")
        colours = [f"#{c.red:02x}{c.green:02x}{c.blue:02x}" for c in found]
        if colours != list(palette.colours) or any(c.alpha != 255 for c in found):
            errors.append(f"palette {i} ({palette.label}) differs from palettes.json")
    return errors


def painting_errors(
    font: Any, data: bytes, groups: Mapping[str, list[int]], lines: Iterable[Line]
) -> list[str]:
    hb: Any = importlib.import_module("uharfbuzz")
    from sawa_tools.checks.fonts import without

    face = hb.Face(data)
    default = font["fvar"].axes[0].defaultValue if "fvar" in font else 400
    order = font.getGlyphOrder()
    colr = font["COLR"].ColorLayers if "COLR" in font else {}
    cmap = font.getBestCmap() or {}
    circle = cmap.get(ord(DOTTED_CIRCLE))
    errors = []
    for index, (group, codepoints) in enumerate(groups.items()):
        for cp in codepoints:
            if cp not in cmap:
                continue
            for gid, *_ in _shape(face, DOTTED_CIRCLE + chr(cp), default):
                name = order[gid]
                if name == circle:
                    continue
                entries = {layer.colorID for layer in colr.get(name, [])}
                if index not in entries:
                    errors.append(f"U+{cp:04X} shapes to {name}, not coloured {group}")
    marks = {cp for cps in groups.values() for cp in cps}
    for line in lines:
        coloured = {
            order[gid]
            for gid, *_ in _shape(face, without(line.text, marks), default)
            if order[gid] in colr
        }
        if coloured:
            errors.append(f"{line.label} without its marks paints {sorted(coloured)}")
    return errors


def shaping_differences(
    data: bytes,
    plain_data: bytes,
    order: list[str],
    plain_order: list[str],
    weights: Iterable[float],
    lines: Iterable[Line],
) -> list[str]:
    """Where the twin shapes a line to other glyphs or positions than the
    plain family, taking a letter's copy of a mark (harakat.separate()) as
    the mark.
    """
    hb: Any = importlib.import_module("uharfbuzz")
    from sawa_tools.build.harakat import LETTER_SUFFIX

    face, plain_face = hb.Face(data), hb.Face(plain_data)
    errors = []
    for weight in weights:
        for line in lines:
            if not line.label.startswith(SAME_SHAPING):
                continue
            twin = [
                (order[g].removesuffix(LETTER_SUFFIX), *rest)
                for g, *rest in _shape(face, line.text, weight)
            ]
            plain = [
                (plain_order[g], *rest)
                for g, *rest in _shape(plain_face, line.text, weight)
            ]
            if twin != plain:
                errors.append(
                    f"wght {weight:g}: {line.label} shapes unlike the plain family"
                )
    return errors


def name_errors(font: Any, family_name: str) -> list[str]:
    from sawa_tools.build.naming import ps_name

    ps = ps_name(family_name)
    name = font["name"]
    want = {
        1: family_name,
        4: f"{family_name} Regular",
        6: f"{ps}-Regular",
        16: family_name,
        25: ps,
    }
    errors = [
        f"name ID {name_id} is {name.getDebugName(name_id)!r}, not {text!r}"
        for name_id, text in want.items()
        if name.getDebugName(name_id) != text
    ]
    if not (name.getDebugName(3) or "").endswith(f";{ps}-Regular"):
        errors.append(
            f"name ID 3 {name.getDebugName(3)!r} does not end in {ps}-Regular"
        )
    for inst in font["fvar"].instances:
        text = name.getDebugName(inst.postscriptNameID) or ""
        if not text.startswith(f"{ps}-"):
            errors.append(f"instance PostScript name {text!r} is not {ps}-...")
    if "STAT" not in font:
        errors.append("no STAT table")
    return errors


def check_twin(
    ttf: Path,
    plain_ttf: Path,
    family_name: str,
    weights: Iterable[float],
    lines: list[Line],
    groups: Mapping[str, list[int]],
    palettes: list[Palette],
) -> list[str]:
    """Everything this module checks of the Harakat twin at `ttf`."""
    from fontTools.ttLib import TTFont

    for path in (ttf, plain_ttf):
        if not path.exists():
            return [f"{path} not found; run `sawa build fonts` first"]
    data, plain_data = ttf.read_bytes(), plain_ttf.read_bytes()
    font = TTFont(ttf)
    plain = TTFont(plain_ttf, lazy=False)
    plain.ensureDecompiled()
    plain_order = plain.getGlyphOrder()
    errors = name_errors(font, family_name)
    errors += colr_errors(font, plain, groups)
    errors += cpal_errors(font, palettes, len(groups))
    errors += painting_errors(font, data, groups, lines)
    errors += shaping_differences(
        data, plain_data, font.getGlyphOrder(), plain_order, weights, lines
    )
    return errors
