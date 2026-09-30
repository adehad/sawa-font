from __future__ import annotations

import importlib
import io
import json
from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest

pytest.importorskip("fontTools")

from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables.TupleVariation import TupleVariation

from sawa_tools.build import harakat
from sawa_tools.build.families import BuiltFamily, load_config
from sawa_tools.build.merge import WghtRange
from sawa_tools.build.naming import set_named_weights
from sawa_tools.checks import harakat as harakat_check
from sawa_tools.checks.fonts import Line

REPO = Path(__file__).resolve().parents[2]
DATA = REPO / "data"
GROUPS = harakat.load_groups(DATA / harakat.GROUPS_FILE)
PALETTES = harakat.load_palettes(DATA / harakat.PALETTES_FILE, GROUPS)
ORDER = list(GROUPS)

FEATURES = """
languagesystem DFLT dflt;
languagesystem arab dflt;
markClass [fatha shadda hamza shaddakasra] <anchor 100 700> @TOP;
markClass kasra <anchor 100 -50> @BOTTOM;
lookup DECOMPOSE {
    sub alefhamza by alef hamza;
} DECOMPOSE;
lookup SHADDA {
    sub shadda kasra by shaddakasra;
} SHADDA;
feature ccmp {
    lookup DECOMPOSE;
    lookup SHADDA;
} ccmp;
feature mark {
    pos base [alef beh dottedcircle] <anchor 150 800> mark @TOP
        <anchor 150 -50> mark @BOTTOM;
} mark;
feature mkmk {
    pos mark hamza <anchor 100 900> mark @TOP;
} mkmk;
table GDEF {
    GlyphClassDef [alef beh alefhamza dottedcircle space], ,
        [fatha kasra shadda hamza shaddakasra], ;
} GDEF;
"""


def _pen(*boxes: tuple[int, int, int, int]) -> Any:
    pen = TTGlyphPen(None)
    for x0, y0, x1, y1 in boxes:
        pen.moveTo((x0, y0))
        pen.lineTo((x0, y1))
        pen.lineTo((x1, y1))
        pen.lineTo((x1, y0))
        pen.closePath()
    return pen.glyph()


SHADDA = (0, 700, 200, 760)
KASRA = (0, -100, 150, -60)


def _plain(path: Path, family: str = "Fixture Sans") -> Path:
    """A wght 400 to 700 variable font laid out like a Sawa family: U+0623
    decomposes into alef and the hamza mark, shadda and kasra make a
    ligature drawn as both marks' contours, and every glyph gets heavier.
    """
    glyphs = {
        ".notdef": _pen(),
        "space": _pen(),
        "alef": _pen((100, 0, 200, 650)),
        "beh": _pen((50, 0, 550, 150)),
        "alefhamza": _pen((100, 0, 200, 650), (80, 700, 220, 800)),
        "dottedcircle": _pen((50, 0, 450, 400)),
        "fatha": _pen((0, 700, 200, 740)),
        "kasra": _pen(KASRA),
        "shadda": _pen(SHADDA),
        "hamza": _pen((0, 700, 140, 800)),
        "shaddakasra": _pen(SHADDA, KASRA),
    }
    cmap = {
        0x20: "space",
        0x0623: "alefhamza",
        0x0627: "alef",
        0x0628: "beh",
        0x064E: "fatha",
        0x0650: "kasra",
        0x0651: "shadda",
        0x0654: "hamza",
        0x25CC: "dottedcircle",
    }
    builder = FontBuilder(unitsPerEm=1000, isTTF=True)
    builder.setupGlyphOrder(list(glyphs))
    builder.setupCharacterMap(cmap)
    builder.setupGlyf(glyphs)
    widths = {"alef": 300, "beh": 600, "alefhamza": 300, "dottedcircle": 500}
    builder.setupHorizontalMetrics(
        {
            g: (widths.get(g, 0), getattr(glyph, "xMin", 0))
            for g, glyph in glyphs.items()
        }
    )
    builder.setupHorizontalHeader(ascent=1000, descent=-300)
    ps = family.replace(" ", "")
    builder.setupNameTable(
        {
            "familyName": family,
            "styleName": "Regular",
            "uniqueFontIdentifier": f"0.001;TEST;{ps}-Regular",
            "fullName": f"{family} Regular",
            "psName": f"{ps}-Regular",
            "typographicFamily": family,
            "typographicSubfamily": "Regular",
            "variationsPostScriptNamePrefix": ps,
        },
        mac=False,
    )
    builder.setupOS2(sTypoAscender=1000, sTypoDescender=-300, version=4)
    builder.setupPost()
    builder.setupFvar([("wght", 400, 400, 700, "Weight")], [])
    heavier = {"wght": (0, 1.0, 1.0)}
    variations = {}
    for name, glyph in glyphs.items():
        points = len(glyph.coordinates) if glyph.numberOfContours > 0 else 0
        deltas = [(10 + i, i) for i in range(points)] + [(0, 0)] * 4
        variations[name] = [TupleVariation(heavier, deltas)]
    builder.setupGvar(variations)
    addOpenTypeFeaturesFromString(builder.font, FEATURES)
    set_named_weights(builder.font, family, WghtRange(400, 400, 700))
    buffer = io.BytesIO()
    builder.font.save(buffer)
    path.write_bytes(buffer.getvalue())
    return path


def _twin(tmp_path: Path) -> tuple[Path, Path, harakat.Coloured]:
    plain = _plain(tmp_path / "plain.ttf")
    font = TTFont(plain, lazy=False)
    coloured = harakat.colour(
        font, GROUPS, PALETTES, "Fixture Sans", "Fixture Sans Harakat"
    )
    twin = tmp_path / "twin.ttf"
    font.save(twin)
    return plain, twin, coloured


def _shaped(path: Path, text: str) -> list[tuple[str, int, int, int]]:
    hb: Any = importlib.import_module("uharfbuzz")

    font = hb.Font(hb.Face(path.read_bytes()))
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(font, buf)
    order = TTFont(path).getGlyphOrder()
    return [
        (order[i.codepoint], p.x_advance, p.x_offset, p.y_offset)
        for i, p in zip(buf.glyph_infos, buf.glyph_positions, strict=True)
    ]


def test_marks_are_their_own_layer_in_their_group(tmp_path: Path) -> None:
    _, twin, coloured = _twin(tmp_path)
    colr = {
        base: [(layer.name, layer.colorID) for layer in layers]
        for base, layers in TTFont(twin)["COLR"].ColorLayers.items()
    }
    for glyph, group in [
        ("fatha", "short"),
        ("kasra", "short"),
        ("shadda", "shadda"),
        ("hamza", "hamza"),
    ]:
        assert colr[glyph] == [(glyph, ORDER.index(group))]
    assert colr["shaddakasra"] == [
        ("shaddakasra.short", ORDER.index("short")),
        ("shaddakasra.shadda", ORDER.index("shadda")),
    ]
    assert set(colr) == {"fatha", "kasra", "shadda", "hamza", "shaddakasra"}
    assert coloured.letter_copies == {"hamza": "hamza.letter"}


def test_a_split_layer_keeps_its_contours_and_their_deltas(tmp_path: Path) -> None:
    _, twin, _ = _twin(tmp_path)
    font = TTFont(twin)
    glyf, gvar = font["glyf"], font["gvar"]
    kasra = glyf["shaddakasra.short"]
    assert kasra.numberOfContours == 1
    assert (
        list(kasra.getCoordinates(glyf)[0])
        == list(glyf["shaddakasra"].getCoordinates(glyf)[0])[4:]
    )
    whole = gvar.variations["shaddakasra"][0].coordinates
    assert gvar.variations["shaddakasra.short"][0].coordinates == whole[4:]
    assert gvar.variations["shaddakasra.shadda"][0].coordinates == (
        whole[:4] + whole[8:]
    )


def test_a_letter_keeps_its_hamza_in_the_text_colour(tmp_path: Path) -> None:
    plain, twin, _ = _twin(tmp_path)
    letter = _shaped(twin, "أ")
    assert [g for g, *_ in letter] == ["hamza.letter", "alef"]
    assert "hamza.letter" not in TTFont(twin)["COLR"].ColorLayers
    assert [g for g, *_ in _shaped(twin, "بٔ")] == ["hamza", "beh"]
    for text in ("أَ", "أ", "بِّ", "◌َٔ"):
        twin_glyphs = [
            (g.removesuffix(harakat.LETTER_SUFFIX), *rest)
            for g, *rest in _shaped(twin, text)
        ]
        assert twin_glyphs == _shaped(plain, text)


def test_the_palettes_and_names_follow_the_data(tmp_path: Path) -> None:
    _, twin, _ = _twin(tmp_path)
    font = TTFont(twin)
    cpal = font["CPAL"]
    assert len(cpal.palettes) == 4
    assert cpal.paletteTypes == [1, 2, 1, 2]
    short = cpal.palettes[0][ORDER.index("short")]
    assert (
        f"#{short.red:02x}{short.green:02x}{short.blue:02x}" == PALETTES[0].colours[0]
    )
    name = font["name"]
    assert name.getDebugName(1) == "Fixture Sans Harakat"
    assert name.getDebugName(6) == "FixtureSansHarakat-Regular"
    assert name.getDebugName(25) == "FixtureSansHarakat"
    labels = [name.getDebugName(i) for i in cpal.paletteLabels]
    assert labels == ["Groups (light)", "Groups (dark)", "Gray (light)", "Gray (dark)"]


def test_the_check_passes_a_twin_and_fails_a_recoloured_one(tmp_path: Path) -> None:
    plain, twin, _ = _twin(tmp_path)
    lines = [Line("stress/x", "أَبِّ"), Line("mixed/y", "بَ")]

    def check(path: Path) -> list[str]:
        return harakat_check.check_twin(
            path, plain, "Fixture Sans Harakat", [400, 700], lines, GROUPS, PALETTES
        )

    assert check(twin) == []
    font = TTFont(twin)
    font["COLR"].ColorLayers["fatha"][0].colorID = ORDER.index("tanween")
    font["COLR"].ColorLayers["alef"] = font["COLR"].ColorLayers.pop("hamza")
    bad = tmp_path / "bad.ttf"
    font.save(bad)
    errors = check(bad)
    assert any("mark glyphs without colour: hamza" in e for e in errors)
    assert any("coloured glyphs that are no mark: alef" in e for e in errors)
    assert any("U+064E shapes to fatha, not coloured short" in e for e in errors)
    assert any("paints ['alef']" in e for e in errors)


def test_palettes_need_every_group_and_valid_colours(tmp_path: Path) -> None:
    data = json.loads((DATA / harakat.PALETTES_FILE).read_text(encoding="utf-8"))
    path = tmp_path / "palettes.json"
    del data["groups"]["waqf"]
    path.write_text(json.dumps(data), encoding="utf-8")
    with pytest.raises(harakat.HarakatError, match="exactly"):
        harakat.load_palettes(path, GROUPS)
    data = json.loads((DATA / harakat.PALETTES_FILE).read_text(encoding="utf-8"))
    data["gray"]["dark"] = "gray"
    path.write_text(json.dumps(data), encoding="utf-8")
    with pytest.raises(harakat.HarakatError, match="colour"):
        harakat.load_palettes(path, GROUPS)


def test_the_twin_is_rebuilt_only_when_its_inputs_change(tmp_path: Path) -> None:
    family = next(f for f in load_config(DATA / "sawa.json").families if f.harakat)
    family = replace(family, name="Fixture Sans")
    fonts_dir = tmp_path / "fonts"
    fonts_dir.mkdir()
    plain = _plain(fonts_dir / family.ttf_name)
    (fonts_dir / f"{family.id}.stamp").write_text("one\n", encoding="utf-8")
    built = BuiltFamily(family, plain, None, rebuilt=False)

    first = harakat.build_twin(built, fonts_dir=fonts_dir, data_dir=DATA)
    assert first.rebuilt
    assert first.ttf.name == "FixtureSansHarakat[wght].ttf"
    assert first.family.id == f"{family.id}-harakat"
    assert not harakat.build_twin(built, fonts_dir=fonts_dir, data_dir=DATA).rebuilt
    (fonts_dir / f"{family.id}.stamp").write_text("two\n", encoding="utf-8")
    assert harakat.build_twin(built, fonts_dir=fonts_dir, data_dir=DATA).rebuilt
