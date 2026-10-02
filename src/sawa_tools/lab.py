"""Writes the fonts and matrix definition Sawa Lab (lab/) renders.

`calib.ttf` is one static Sawa Sans master: Noto Sans and Noto Sans Arabic
instanced at one weight, the Arabic scaled and merged, with Noto's own mark
placement left as it is. The two sources come along unscaled so the lab can
show before and after. `lab.json` carries the Latin metrics and the letter,
form and mark matrix the lab draws.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import unicodedata
from pathlib import Path
from typing import TYPE_CHECKING, Any

from sawa_tools import lab_lines
from sawa_tools.corpus import DEFAULT_MIXED, DEFAULT_STRESS
from sawa_tools.tanzil import DEFAULT_UTHMANI

if TYPE_CHECKING:
    from fontTools.ttLib import TTFont

DEFAULT_OUT = Path("lab/public/fonts")
TANZIL_CREDIT = (
    "Quran text from the Tanzil Project (tanzil.net), used verbatim under its"
    " terms of use."
)
FAMILY_ID = "sawa-sans"
DEFAULT_SCALE = 1.15
WGHT = 400.0
ZWJ = 0x200D

# (codepoint, name); the order is the matrix's row order.
LETTER_CODEPOINTS = [
    (0x0627, "alef"),
    (0x0623, "alef hamza above"),
    (0x0625, "alef hamza below"),
    (0x0622, "alef maddah"),
    (0x0628, "beh"),
    (0x062A, "teh"),
    (0x062B, "theh"),
    (0x062C, "jeem"),
    (0x062D, "hah"),
    (0x062E, "khah"),
    (0x062F, "dal"),
    (0x0630, "thal"),
    (0x0631, "reh"),
    (0x0632, "zain"),
    (0x0633, "seen"),
    (0x0634, "sheen"),
    (0x0635, "sad"),
    (0x0636, "dad"),
    (0x0637, "tah"),
    (0x0638, "zah"),
    (0x0639, "ain"),
    (0x063A, "ghain"),
    (0x0641, "feh"),
    (0x0642, "qaf"),
    (0x0643, "kaf"),
    (0x0644, "lam"),
    (0x0645, "meem"),
    (0x0646, "noon"),
    (0x0647, "heh"),
    (0x0648, "waw"),
    (0x064A, "yeh"),
    (0x0649, "alef maksura"),
    (0x0629, "teh marbuta"),
    (0x0621, "hamza"),
    (0x0624, "waw hamza above"),
    (0x0626, "yeh hamza above"),
]
LETTERS = [(chr(cp), name) for cp, name in LETTER_CODEPOINTS]

# Letters that join only to the letter before them; hamza joins to neither.
RIGHT_JOINING = {
    chr(cp)
    for cp in (
        0x0627,
        0x0623,
        0x0625,
        0x0622,
        0x062F,
        0x0630,
        0x0631,
        0x0632,
        0x0648,
        0x0629,
        0x0649,
        0x0624,
    )
}
NON_JOINING = {chr(0x0621)}

# Which marks ordinary spelling puts on which letters. Maddah and hamza
# below go only on bare alef, hamza above only on alef, waw, yeh and alef
# maksura; shadda never on an alef, hamza, alef maksura or teh marbuta.
ALEF = chr(0x0627)
ALEFS = {chr(cp) for cp in (0x0627, 0x0623, 0x0625, 0x0622)}
HAMZA_ABOVE_CARRIERS = {chr(cp) for cp in (0x0627, 0x0648, 0x064A, 0x0649)}
NO_SHADDA = ALEFS | {chr(cp) for cp in (0x0621, 0x0649, 0x0629)}

# The line box the owner approved: the plausible everyday envelope of
# Sans 400 at 1.15 (2.302 em, rounded up to 2.31) plus 0.05 em.
DEFAULT_LINE_BOX = 2.36
LINE_BOX_BASIS = "plausible everyday envelope + 0.05 em"

FORMS = ["isolated", "initial", "medial", "final"]

FATHA, DAMMA, KASRA = "\u064e", "\u064f", "\u0650"
FATHATAN, DAMMATAN, KASRATAN = "\u064b", "\u064c", "\u064d"
SUKUN, SHADDA = "\u0652", "\u0651"
VOWELS = [("fatha", FATHA), ("damma", DAMMA), ("kasra", KASRA)]
TANWEEN = [("fathatan", FATHATAN), ("dammatan", DAMMATAN), ("kasratan", KASRATAN)]

# The owner's everyday tashkeel: U+064B..0655, U+0670, U+06E1, U+08F0..08F2.
EVERYDAY_CODEPOINTS = [*range(0x064B, 0x0656), 0x0670, 0x06E1, 0x08F0, 0x08F1, 0x08F2]
NICHE_RANGES = [(0x0610, 0x061A), (0x0656, 0x065F), (0x06D6, 0x06ED)]


def everyday_marks() -> list[dict[str, Any]]:
    """The mark sequences the matrix offers, each with an id the lab's URLs
    and annotations use.
    """
    marks: list[tuple[str, str, str]] = [
        *((key, key, seq) for key, seq in VOWELS),
        *((key, key, seq) for key, seq in TANWEEN),
        ("sukun", "sukun", SUKUN),
        ("shadda", "shadda", SHADDA),
        *(
            (f"shadda-{key}", f"shadda + {key}", SHADDA + seq)
            for key, seq in [*VOWELS, *TANWEEN]
        ),
        ("maddah", "maddah", "\u0653"),
        ("dagger-alef", "dagger alef", "\u0670"),
        ("hamza-above", "hamza above", "\u0654"),
        ("hamza-above-fatha", "hamza above + fatha", "\u0654" + FATHA),
        ("hamza-above-damma", "hamza above + damma", "\u0654" + DAMMA),
        ("hamza-above-sukun", "hamza above + sukun", "\u0654" + SUKUN),
        ("hamza-below", "hamza below", "\u0655"),
        ("hamza-below-kasra", "hamza below + kasra", "\u0655" + KASRA),
        ("small-high-dotless-khah", "Quranic sukun", "\u06e1"),
        ("open-fathatan", "open fathatan", "\u08f0"),
        ("open-dammatan", "open dammatan", "\u08f1"),
        ("open-kasratan", "open kasratan", "\u08f2"),
    ]
    return [
        {"id": key, "label": label, "codepoints": [f"U+{ord(c):04X}" for c in seq]}
        for key, label, seq in marks
    ]


def niche_marks() -> list[dict[str, Any]]:
    """Every nonspacing mark in the niche ranges, one sequence each."""
    found = []
    for low, high in NICHE_RANGES:
        for cp in range(low, high + 1):
            if unicodedata.category(chr(cp)) != "Mn":
                continue
            name = unicodedata.name(chr(cp), f"U+{cp:04X}")
            label = name.removeprefix("ARABIC ").lower()
            found.append(
                {"id": f"u{cp:04x}", "label": label, "codepoints": [f"U+{cp:04X}"]}
            )
    return found


def plausible(letter: str, marks: list[str]) -> bool:
    """Whether ordinary spelling puts the mark sequence on the letter."""
    cps = {int(cp[2:], 16) for cp in marks}
    if 0x0653 in cps and letter != ALEF:
        return False
    if 0x0654 in cps and letter not in HAMZA_ABOVE_CARRIERS:
        return False
    if 0x0655 in cps and letter != ALEF:
        return False
    return not (0x0651 in cps and letter in NO_SHADDA)


def joining(letter: str) -> str:
    if letter in NON_JOINING:
        return "none"
    return "right" if letter in RIGHT_JOINING else "dual"


def forms_of(letter: str) -> list[str]:
    """The forms a letter actually has: a right-joining letter has no
    initial or medial form, hamza only its isolated one.
    """
    return {
        "none": ["isolated"],
        "right": ["isolated", "final"],
        "dual": FORMS,
    }[joining(letter)]


def matrix() -> dict[str, Any]:
    return {
        "zwj": f"U+{ZWJ:04X}",
        "forms": FORMS,
        "letters": [
            {
                "char": char,
                "codepoint": f"U+{ord(char):04X}",
                "name": name,
                "joining": joining(char),
                "forms": forms_of(char),
                "implausible": [
                    mark["id"]
                    for mark in everyday_marks()
                    if not plausible(char, mark["codepoints"])
                ],
            }
            for char, name in LETTERS
        ],
        "everyday": everyday_marks(),
        "everydayCodepoints": [f"U+{cp:04X}" for cp in EVERYDAY_CODEPOINTS],
        "niche": niche_marks(),
    }


def cell_codepoints(letter: str, form: str, marks: list[str]) -> list[int]:
    """The codepoints of one matrix cell: the letter, its marks, and ZWJ on
    the joining sides that force the form.
    """
    before = [ZWJ] if form in ("medial", "final") else []
    after = [ZWJ] if form in ("initial", "medial") else []
    return [*before, ord(letter), *(int(cp[2:], 16) for cp in marks), *after]


def cells(definition: dict[str, Any]) -> list[dict[str, Any]]:
    """Every cell the lab shapes: each letter in each of its forms, bare and
    with every everyday and niche mark sequence.
    """
    sequences: list[dict[str, Any]] = [
        {"id": "none", "codepoints": []},
        *definition["everyday"],
        *definition["niche"],
    ]
    return [
        {
            "letter": letter["codepoint"],
            "form": form,
            "mark": mark["id"],
            "codepoints": [
                f"U+{cp:04X}"
                for cp in cell_codepoints(letter["char"], form, mark["codepoints"])
            ],
        }
        for letter in definition["letters"]
        for form in letter["forms"]
        for mark in sequences
    ]


def letter_forms(
    font: TTFont, font_bytes: bytes, definition: dict[str, Any]
) -> dict[str, Any]:
    """Each letter form's body glyph and parts, keyed "U+0628|initial"."""
    from sawa_tools import lab_parts

    order = font.getGlyphOrder()
    return {
        f"{letter['codepoint']}|{form}": lab_parts.letter_form_parts(
            font,
            shape(font_bytes, cell_codepoints(letter["char"], form, [])),
            glyph_name=order.__getitem__,
        )
        for letter in definition["letters"]
        for form in letter["forms"]
    }


def glyph_table(font: TTFont, names: set[str]) -> dict[str, Any]:
    """Advance, class, parts with outlines, and anchors of each named glyph."""
    from sawa_tools import lab_parts

    anchors = lab_parts.anchors(font)
    return {name: lab_parts.glyph_entry(font, name, anchors) for name in sorted(names)}


def shape(font_bytes: bytes, codepoints: list[int]) -> list[list[int]]:
    """HarfBuzz's output for `codepoints` as [glyph id, cluster, x advance,
    x offset, y offset] per glyph, clusters counted in codepoints.
    """
    hb = _uharfbuzz()
    font = _hb_font(font_bytes)
    buf = hb.Buffer()
    buf.cluster_level = hb.BufferClusterLevel.MONOTONE_CHARACTERS
    buf.add_codepoints(codepoints)
    buf.guess_segment_properties()
    hb.shape(font, buf)
    return [
        [info.codepoint, info.cluster, pos.x_advance, pos.x_offset, pos.y_offset]
        for info, pos in zip(buf.glyph_infos, buf.glyph_positions, strict=True)
    ]


_HB_FONTS: dict[int, Any] = {}


def _uharfbuzz() -> Any:
    """uharfbuzz, untyped: it is a compiled extension without type stubs."""
    import importlib

    return importlib.import_module("uharfbuzz")


def _hb_font(font_bytes: bytes) -> Any:
    hb = _uharfbuzz()
    key = id(font_bytes)
    if key not in _HB_FONTS:
        _HB_FONTS[key] = hb.Font(hb.Face(hb.Blob(font_bytes)))
    return _HB_FONTS[key]


def expected_shaping(
    fonts: dict[str, bytes],
    definition: dict[str, Any],
    lines: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Every cell and edge-case line shaped by uharfbuzz in each of
    `fonts`, for the lab's parity test against harfbuzzjs.
    """
    shaped = []
    for cell in cells(definition):
        cps = [int(cp[2:], 16) for cp in cell["codepoints"]]
        shaped.append(
            cell | {"glyphs": {key: shape(raw, cps) for key, raw in fonts.items()}}
        )
    texts = sorted(
        {line["text"] for entry in (lines or {}).values() for line in entry["lines"]}
    )
    return {
        "harfbuzz": harfbuzz_versions(),
        "clusterLevel": 1,
        "cells": shaped,
        "lines": [
            {
                "text": text,
                "glyphs": {
                    key: shape(raw, [ord(c) for c in text])
                    for key, raw in fonts.items()
                },
            }
            for text in texts
        ],
    }


def harfbuzz_versions() -> dict[str, str]:
    import importlib.metadata

    hb = _uharfbuzz()
    return {
        "harfbuzz": hb.version_string(),
        "uharfbuzz": importlib.metadata.version("uharfbuzz"),
    }


def required_codepoints(definition: dict[str, Any]) -> set[int]:
    """Every codepoint the matrix shapes."""
    cps = {int(definition["zwj"][2:], 16)}
    cps |= {ord(letter["char"]) for letter in definition["letters"]}
    for mark in [*definition["everyday"], *definition["niche"]]:
        cps |= {int(cp[2:], 16) for cp in mark["codepoints"]}
    return cps


def missing_codepoints(font: TTFont, codepoints: set[int]) -> list[int]:
    """The codepoints `font`'s cmap lacks. ZWJ needs no glyph to shape."""
    cmap = set(font.getBestCmap() or {})
    return sorted(cp for cp in codepoints - cmap if cp != ZWJ)


def latin_metrics(font: TTFont) -> dict[str, int]:
    """Latin heights from the font's own ink: x-height and cap height from
    x and H, ascender from d, descender from p.
    """
    glyphs = font.getGlyphSet()
    cmap = font.getBestCmap() or {}

    def ink(char: str) -> tuple[float, float]:
        from fontTools.pens.boundsPen import BoundsPen

        pen = BoundsPen(glyphs)
        glyphs[cmap[ord(char)]].draw(pen)
        assert pen.bounds is not None
        return pen.bounds[1], pen.bounds[3]

    hhea: Any = font["hhea"]
    return {
        "unitsPerEm": font["head"].unitsPerEm,  # ty: ignore[unresolved-attribute]
        "xHeight": round(ink("x")[1]),
        "capHeight": round(ink("H")[1]),
        "ascender": round(ink("d")[1]),
        "descender": round(ink("p")[0]),
        "hheaAscender": hhea.ascent,
        "hheaDescender": hhea.descent,
    }


def build_id(shas: list[str], scale: float) -> str:
    digest = hashlib.sha256(json.dumps([shas, scale, WGHT]).encode("utf-8"))
    for source in sorted(Path(__file__).parent.glob("lab*.py")):
        digest.update(source.read_bytes().replace(b"\r\n", b"\n"))
    return f"sans-{WGHT:g}-{scale:g}-{digest.hexdigest()[:10]}"


def build_lab_fonts(
    *,
    out_dir: Path,
    scale: float,
    line_box: float = DEFAULT_LINE_BOX,
    manifest: Path,
    families: Path,
    cache_dir: Path,
    quran: Path | None = DEFAULT_UTHMANI,
) -> dict[str, Any]:
    """Writes calib.ttf, noto-arabic.ttf, noto-sans.ttf, lab.json and
    expected-shaping.json into `out_dir`; returns what lab.json holds.
    `quran` is the Tanzil text the real words come from after the
    project's own sentences, or None for those alone.
    """
    import io

    from fontTools.ttLib import TTFont

    from sawa_tools.build import fonts
    from sawa_tools.build.families import load_config
    from sawa_tools.build.merge import instance, make_master

    data = json.loads(manifest.read_text(encoding="utf-8"))
    sources = data["sources"]
    family = next(f for f in load_config(families).families if f.id == FAMILY_ID)
    latin_member, arabic_member = family.inputs["latin"], family.inputs["arabic"]
    names = {latin_member.source, arabic_member.source}
    cached = {
        name: fonts._ensure_cached(name, sources[name], cache_dir) for name in names
    }

    def read(member: Any) -> TTFont:
        raw = fonts._read_source_bytes(
            member.source, member.path, sources, cached, context=member.source
        )
        return TTFont(io.BytesIO(raw), recalcTimestamp=False)

    latin_vf, arabic_vf = read(latin_member), read(arabic_member)
    pinned = family.pinned_axes
    calib = make_master(latin_vf, arabic_vf, WGHT, scale, pinned)
    noto_arabic = instance(arabic_vf, WGHT, pinned)
    noto_sans = instance(latin_vf, WGHT, pinned)

    definition = matrix()
    required = required_codepoints(definition)
    for label, font in (("calib", calib), ("noto-arabic", noto_arabic)):
        missing = missing_codepoints(font, required)
        if missing:
            listed = ", ".join(f"U+{cp:04X}" for cp in missing)
            raise fonts.BuildError(f"{label} lacks {listed}")

    out_dir.mkdir(parents=True, exist_ok=True)
    calib.save(out_dir / "calib.ttf")
    noto_arabic.save(out_dir / "noto-arabic.ttf")
    noto_sans.save(out_dir / "noto-sans.ttf")
    calib_bytes = (out_dir / "calib.ttf").read_bytes()
    saved = TTFont(out_dir / "calib.ttf")
    forms = letter_forms(saved, calib_bytes, definition)
    words = lab_lines.project_words(DEFAULT_STRESS, DEFAULT_MIXED)
    if quran is not None:
        words += lab_lines.quran_words(quran)
    lines = lab_lines.edge_lines(saved, calib_bytes, definition, forms, words)
    used = {name for form in forms.values() for name in form["glyphs"]}
    used |= {
        line["glyph"]
        for entry in lines.values()
        for line in entry["lines"]
        if "glyph" in line
    }
    shaping = expected_shaping(
        {
            "calib": calib_bytes,
            "notoArabic": (out_dir / "noto-arabic.ttf").read_bytes(),
        },
        definition,
        lines,
    )
    (out_dir / "expected-shaping.json").write_text(
        json.dumps(shaping, separators=(",", ":")) + "\n", encoding="utf-8"
    )
    shas = sorted(sources[name]["sha256"] for name in names)
    lab = {
        "build": build_id(shas, scale),
        "family": family.name,
        "wght": WGHT,
        "arabicScale": scale,
        "fonts": {
            "calib": "calib.ttf",
            "notoArabic": "noto-arabic.ttf",
            "notoSans": "noto-sans.ttf",
        },
        "harfbuzz": harfbuzz_versions(),
        "metrics": latin_metrics(noto_sans),
        "approvedLineBox": {"height": line_box, "basis": LINE_BOX_BASIS},
        "clearance": family.mark_clearance,
        "matrix": definition,
        "letterForms": forms,
        "glyphs": glyph_table(saved, used),
        "lines": lines,
        "credits": {"tanzil": TANZIL_CREDIT},
    }
    (out_dir / "lab.json").write_text(
        json.dumps(lab, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    return lab


def add_parsers(subparsers: argparse._SubParsersAction) -> None:
    from sawa_tools.build.families import DEFAULT_FAMILIES
    from sawa_tools.build.fonts import DEFAULT_CACHE, DEFAULT_MANIFEST

    parser = subparsers.add_parser(
        "fonts", help="Write the calibration fonts and matrix Sawa Lab renders"
    )
    parser.add_argument(
        "--arabic-scale",
        type=float,
        default=DEFAULT_SCALE,
        help="Scale of the Arabic against the Latin (default: %(default)s)",
    )
    parser.add_argument(
        "--line-box",
        type=float,
        default=DEFAULT_LINE_BOX,
        help="The approved line box in em the lab draws (default: %(default)s)",
    )
    parser.add_argument(
        "--quran",
        type=lambda value: Path(value) if value else None,
        default=DEFAULT_UTHMANI,
        help="Tanzil text real words come from, '' for none (default: %(default)s)",
    )
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--families", type=Path, default=DEFAULT_FAMILIES)
    parser.add_argument("--cache", type=Path, default=DEFAULT_CACHE)
    parser.set_defaults(handler=run)


def run(args: argparse.Namespace) -> int:
    from sawa_tools.build.fonts import BuildError

    try:
        lab = build_lab_fonts(
            out_dir=args.out,
            scale=args.arabic_scale,
            line_box=args.line_box,
            quran=args.quran,
            manifest=args.manifest,
            families=args.families,
            cache_dir=args.cache,
        )
    except BuildError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(f"{args.out}: {lab['build']}")
    return 0
