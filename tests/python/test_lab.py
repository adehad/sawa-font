import json
import unicodedata
from pathlib import Path

import pytest
from conftest import MakeFont

from sawa_tools import lab

DOWNLOADS = Path(".cache/downloads")


def test_every_letter_and_form_is_listed() -> None:
    definition = lab.matrix()
    chars = [letter["char"] for letter in definition["letters"]]
    assert len(chars) == len(set(chars)) == 36
    for char in "اأإآبتثجحخدذرزسشصضطظعغفقكلمنهويىةءؤئ":
        assert char in chars
    by_char = {letter["char"]: letter for letter in definition["letters"]}
    assert by_char["ب"]["forms"] == lab.FORMS
    assert by_char["د"]["forms"] == ["isolated", "final"]
    assert by_char["ء"]["forms"] == ["isolated"]
    assert "hamza-above-damma" in by_char["أ"]["implausible"]
    assert "shadda-kasratan" in by_char["أ"]["implausible"]
    assert "hamza-below-kasra" in by_char["ي"]["implausible"]
    assert "shadda-kasratan" not in by_char["ث"]["implausible"]


@pytest.mark.parametrize(
    ("letter", "marks", "expected"),
    [
        (0x0627, ["U+0653"], True),
        (0x0628, ["U+0653"], False),
        (0x064A, ["U+0654", "U+064E"], True),
        (0x0628, ["U+0654"], False),
        (0x0627, ["U+0655", "U+0650"], True),
        (0x062C, ["U+0655", "U+0650"], False),
        (0x0623, ["U+0651"], False),
        (0x0629, ["U+0651", "U+064B"], False),
        (0x062B, ["U+0651", "U+064D"], True),
    ],
)
def test_plausible_follows_ordinary_spelling(
    letter: int, marks: list[str], expected: bool
) -> None:
    assert lab.plausible(chr(letter), marks) is expected


def test_everyday_marks_cover_the_owner_set() -> None:
    marks = lab.everyday_marks()
    ids = [mark["id"] for mark in marks]
    assert len(ids) == len(set(ids))
    used = {cp for mark in marks for cp in mark["codepoints"]}
    assert used == {f"U+{cp:04X}" for cp in lab.EVERYDAY_CODEPOINTS}
    shadda = [m for m in marks if m["codepoints"][0] == "U+0651"]
    assert len(shadda) == 7


def test_niche_marks_are_nonspacing_and_in_range() -> None:
    niche = lab.niche_marks()
    assert niche
    for mark in niche:
        (cp,) = mark["codepoints"]
        value = int(cp[2:], 16)
        assert unicodedata.category(chr(value)) == "Mn"
        assert any(low <= value <= high for low, high in lab.NICHE_RANGES)


@pytest.mark.parametrize(
    ("form", "expected"),
    [
        ("isolated", [0x0628, 0x064E]),
        ("initial", [0x0628, 0x064E, 0x200D]),
        ("medial", [0x200D, 0x0628, 0x064E, 0x200D]),
        ("final", [0x200D, 0x0628, 0x064E]),
    ],
)
def test_zwj_forces_each_form(form: str, expected: list[int]) -> None:
    assert lab.cell_codepoints("ب", form, ["U+064E"]) == expected


def test_cells_cover_each_letter_form_and_mark() -> None:
    definition = lab.matrix()
    cells = lab.cells(definition)
    forms = sum(len(letter["forms"]) for letter in definition["letters"])
    sequences = 1 + len(definition["everyday"]) + len(definition["niche"])
    assert len(cells) == forms * sequences


def test_missing_codepoints_names_what_the_cmap_lacks(make_font: MakeFont) -> None:
    from fontTools.ttLib import TTFont

    font = TTFont(make_font())
    assert lab.missing_codepoints(font, {0x0627, 0x0628, 0x200D, 0x0629}) == [0x0629]


@pytest.mark.skipif(
    not (DOWNLOADS / "noto_sans_arabic").exists(),
    reason="needs the cached Noto sources (sawa build fonts)",
)
def test_lab_fonts_contain_every_listed_codepoint(tmp_path: Path) -> None:
    from fontTools.ttLib import TTFont

    written = lab.build_lab_fonts(
        out_dir=tmp_path,
        scale=1.15,
        manifest=Path("data/upstream.json"),
        families=Path("data/sawa.json"),
        cache_dir=DOWNLOADS,
    )
    required = lab.required_codepoints(written["matrix"])
    for name in ("calib.ttf", "noto-arabic.ttf"):
        assert lab.missing_codepoints(TTFont(tmp_path / name), required) == []
    saved = json.loads((tmp_path / "lab.json").read_text(encoding="utf-8"))
    assert saved["arabicScale"] == 1.15
    assert saved["metrics"]["unitsPerEm"] == 1000
    shaping = json.loads((tmp_path / "expected-shaping.json").read_text("utf-8"))
    assert len(shaping["cells"]) == len(lab.cells(written["matrix"]))
