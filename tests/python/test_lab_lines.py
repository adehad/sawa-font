import io
import json
from pathlib import Path
from typing import Any

import pytest

from sawa_tools import lab, lab_lines
from sawa_tools.tanzil import uthmani, verse_ref

DOWNLOADS = Path(".cache/downloads")
ALEF = chr(0x0627)
needs_noto = pytest.mark.skipif(
    not (DOWNLOADS / "noto_sans_arabic").exists(),
    reason="needs the cached Noto sources (sawa build fonts)",
)

# Beh turns into beh.alt before lam, through a chained contextual lookup.
CONTEXT_FEATURES = """
languagesystem DFLT dflt;
languagesystem arab dflt;
lookup ALT { sub beh by beh.alt; } ALT;
feature rlig {
    sub beh' lookup ALT lam;
} rlig;
"""


def _context_font() -> tuple[Any, bytes]:
    from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
    from fontTools.fontBuilder import FontBuilder
    from fontTools.pens.ttGlyphPen import TTGlyphPen
    from fontTools.ttLib import TTFont

    def box(x1: int, y1: int) -> Any:
        pen = TTGlyphPen(None)
        pen.moveTo((0, 0))
        pen.lineTo((0, y1))
        pen.lineTo((x1, y1))
        pen.lineTo((x1, 0))
        pen.closePath()
        return pen.glyph()

    glyphs = {
        ".notdef": box(100, 100),
        "beh": box(500, 100),
        "beh.alt": box(400, 100),
        "lam": box(100, 800),
        "alef": box(100, 700),
    }
    builder = FontBuilder(unitsPerEm=1000, isTTF=True)
    builder.setupGlyphOrder(list(glyphs))
    builder.setupCharacterMap({0x0628: "beh", 0x0644: "lam", 0x0627: "alef"})
    builder.setupGlyf(glyphs)
    builder.setupHorizontalMetrics({name: (500, 0) for name in glyphs})
    builder.setupHorizontalHeader(ascent=800, descent=-200)
    builder.setupPost()
    addOpenTypeFeaturesFromString(builder.font, CONTEXT_FEATURES)
    buffer = io.BytesIO()
    builder.font.save(buffer)
    return TTFont(io.BytesIO(buffer.getvalue())), buffer.getvalue()


def test_walking_gsub_finds_a_contextual_alternate_and_its_context() -> None:
    font, _ = _context_font()
    found = lab_lines.reachable({"beh"}, lab_lines.substitutions(font))
    assert list(found) == ["beh.alt"]
    assert found["beh.alt"].feature == "rlig"
    assert found["beh.alt"].context == "before [lam]"


def test_the_shortest_string_that_triggers_an_alternate_is_checked() -> None:
    font, raw = _context_font()
    shaper = lab_lines.Shaper(raw, font.getGlyphOrder(), set())
    letters = [
        {"char": "ب", "name": "beh", "joining": "dual"},
        {"char": "ل", "name": "lam", "joining": "dual"},
        {"char": ALEF, "name": "alef", "joining": "right"},
    ]
    wanted = lab_lines.reachable({"beh"}, lab_lines.substitutions(font))
    lines, unreached = lab_lines.font_lines(letters[0], letters, [], wanted, shaper)
    assert unreached == []
    assert [(line["text"], line["glyph"]) for line in lines] == [("بل", "beh.alt")]
    assert lines[0]["label"].startswith("isolated before lam: alternate glyph beh.alt")


def test_situational_lines_fit_the_letter_s_joining() -> None:
    by_char = {letter["char"]: letter for letter in lab.matrix()["letters"]}
    beh = lab_lines.situational_lines(by_char["ب"], shadda_ok=True)
    labels = [line["label"] for line in beh]
    joiners = " ".join(lab_lines.NON_JOINING)
    assert labels[0] == f"initial after non-joining letters {joiners}"
    assert beh[0]["text"].split() == [f"{n}بب" for n in "ادذرزو"]
    assert "with kashida U+0640" in labels
    assert any("َّ" in line["text"] for line in beh)
    alef = lab_lines.situational_lines(by_char[ALEF], shadda_ok=False)
    assert not any(line["label"].startswith(("initial", "medial")) for line in alef)
    assert all("اّ" not in line["text"] for line in alef)
    hamza = lab_lines.situational_lines(by_char["ء"], shadda_ok=False)
    assert all(line["label"] != "with kashida U+0640" for line in hamza)


def test_project_words_drop_punctuation_and_latin(tmp_path: Path) -> None:
    mixed = tmp_path / "mixed.json"
    stress = tmp_path / "stress.json"
    mixed.write_text(
        json.dumps({"sentences": [{"id": "m", "text": "word (كتاب)، 45 بيت."}]}),
        encoding="utf-8",
    )
    stress.write_text(
        json.dumps({"tests": [{"id": "s", "purpose": {"ar": "الشدة فوق؟"}}]}),
        encoding="utf-8",
    )
    words = lab_lines.project_words(stress, mixed)
    assert [(w.text, w.corpus, w.ref) for w in words] == [
        ("كتاب", "mixed", "m"),
        ("بيت", "mixed", "m"),
        ("الشدة", "stress", "s"),
        ("فوق", "stress", "s"),
    ]


def test_quran_words_are_whole_tokens_of_their_verse() -> None:
    words = lab_lines.quran_words(Path("data/tanzil/quran-uthmani.txt.gz"))
    verses = {verse_ref(i): v for i, v in enumerate(uthmani())}
    assert len(words) > 10000
    for word in words[:: len(words) // 200]:
        assert word.corpus == "tanzil"
        assert word.text in verses[word.ref].split()


@pytest.fixture(scope="module")
def built(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Any]:
    out = tmp_path_factory.mktemp("lab")
    return lab.build_lab_fonts(
        out_dir=out,
        scale=1.15,
        manifest=Path("data/upstream.json"),
        families=Path("data/sawa.json"),
        cache_dir=DOWNLOADS,
    ) | {"out": out}


@needs_noto
@pytest.mark.parametrize("char", "بني")
def test_finds_noto_s_wide_beh_shapes_before_wide_dots(
    built: dict[str, Any], char: str
) -> None:
    from fontTools.ttLib import TTFont

    font = TTFont(built["out"] / "calib.ttf")
    cmap = font.getBestCmap() or {}
    found = lab_lines.reachable({cmap[ord(char)]}, lab_lines.substitutions(font))
    wide = found["uni066E.init.wide"]
    assert wide.feature == "rlig"
    assert wide.context.startswith("before [")
    assert found["uni066E.medi.wide"].lookup == wide.lookup


@needs_noto
def test_lam_alef_lines_come_from_the_font(built: dict[str, Any]) -> None:
    lam = built["lines"]["U+0644"]["lines"]
    font = {line["glyph"]: line for line in lam if line["kind"] == "font"}
    assert font["uni0644.init.rlig"]["text"] == "لا"
    assert font["uni0644.init.rlig"]["feature"] == "rlig"
    assert "uni0644.medi.rlig" in font
    alef = built["lines"]["U+0627"]["lines"]
    assert any(line.get("glyph") == "uni0627.fina.rlig" for line in alef)


@needs_noto
def test_every_letter_gets_lines_of_each_kind(built: dict[str, Any]) -> None:
    for letter in built["matrix"]["letters"]:
        lines = built["lines"][letter["codepoint"]]["lines"]
        kinds = {line["kind"] for line in lines}
        assert {"situational", "word"} <= kinds, letter["name"]
        assert all(line["text"] and line["label"] for line in lines)
        forms = {
            line["label"].split(":")[0] for line in lines if line["kind"] == "word"
        }
        assert len(forms) >= len(letter["forms"]) - 1, letter["name"]
    beh = built["lines"]["U+0628"]["lines"]
    assert all(
        line["source"]["corpus"] != "tanzil" for line in beh if line["kind"] == "word"
    )


@needs_noto
def test_font_lines_shape_to_the_glyph_they_name(built: dict[str, Any]) -> None:
    from fontTools.ttLib import TTFont

    path = built["out"] / "calib.ttf"
    names = TTFont(path).getGlyphOrder()
    raw = path.read_bytes()
    for entry in built["lines"].values():
        for line in entry["lines"]:
            if "glyph" not in line:
                continue
            shaped = lab.shape(raw, [ord(c) for c in line["text"]])
            assert line["glyph"] in {names[g[0]] for g in shaped}, line["label"]
