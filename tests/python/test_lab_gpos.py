import io
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from sawa_tools import lab, lab_gpos, lab_linebox

DOWNLOADS = Path(".cache/downloads")
needs_noto = pytest.mark.skipif(
    not (DOWNLOADS / "noto_sans_arabic").exists(),
    reason="needs the cached Noto sources (sawa build fonts)",
)


def _raw(font: Any) -> bytes:
    buffer = io.BytesIO()
    font.save(buffer)
    return buffer.getvalue()


def _class_of(font: Any, lookup_type: str, mark: str) -> dict[str, Any]:
    for entry in lab_gpos.lookups(font):
        if entry["type"] != lookup_type:
            continue
        for cls in entry["classes"]:
            if mark in cls["marks"]:
                return entry | {"class": cls}
    raise AssertionError(f"no {lookup_type} class holds {mark}")


def test_lookups_list_each_class_with_its_marks_and_position(
    arabic_master: Callable[..., Any],
) -> None:
    font = arabic_master()
    top = _class_of(font, "base", "fatha")
    bottom = _class_of(font, "base", "kasra")
    assert top["index"] == bottom["index"]
    assert top["feature"] == "mark"
    assert top["class"]["position"] == "top"
    assert bottom["class"]["position"] == "bottom"
    assert top["class"]["marks"] == ["fatha"]
    assert top["class"]["id"] != bottom["class"]["id"]
    stack = _class_of(font, "mark", "fatha")
    assert stack["feature"] == "mkmk"
    assert stack["class"]["name"].startswith("mkmk_top_")


def test_anchors_carry_their_lookup_and_class(
    arabic_master: Callable[..., Any],
) -> None:
    font = arabic_master()
    table = lab_gpos.anchors(font)
    top = _class_of(font, "base", "fatha")["class"]["id"]
    beh = {a.to_json()["class"]: (a.x, a.y) for a in table["beh"].base}
    assert beh[top] == (300, 200)
    fatha = table["fatha"]
    assert {(a.to_json()["class"], a.x, a.y) for a in fatha.mark} >= {(top, 100, 780)}
    stack = _class_of(font, "mark", "fatha")["class"]["id"]
    assert [(a.to_json()["class"], a.x, a.y) for a in fatha.mark2] == [
        (stack, 100, 880)
    ]
    assert table["beh"].to_json()["base"][0]["lookup"] == int(top.split(".")[0])


def test_attachments_name_the_glyph_and_lookup_each_mark_hangs_on(
    arabic_master: Callable[..., Any],
) -> None:
    font = arabic_master()
    raw = _raw(font)
    names = font.getGlyphOrder()
    marks = {"fatha", "kasra", "smallhightah"}
    table = lab_gpos.anchors(font)
    shaped = lab.shape(raw, [0x0628, 0x064E, 0x064E, 0x0650, 0x0615])
    glyphs = [names[g[0]] for g in shaped]
    found = lab_gpos.attachments(shaped, names, table, marks)

    def at(i: int) -> dict[str, Any]:
        attach = found[i]
        assert attach is not None, f"nothing places {glyphs[i]}"
        return attach

    beh = glyphs.index("beh")
    first, second = sorted(
        (i for i, n in enumerate(glyphs) if n == "fatha"), reverse=True
    )
    assert found[beh] is None
    assert (at(first)["parent"], at(first)["kind"]) == (beh, "base")
    assert (at(second)["parent"], at(second)["kind"]) == (first, "mark")
    assert at(second)["lookup"] > at(first)["lookup"]
    assert at(glyphs.index("kasra"))["parent"] == beh
    assert found[glyphs.index("smallhightah")] is None


def test_everyday_text_drops_only_niche_marks() -> None:
    everyday = set(lab.EVERYDAY_CODEPOINTS)
    assert lab_linebox.everyday_text("بِسْمِ۟", everyday) == "بِسْمِ"
    assert lab_linebox.everyday_text("ٱللَّهِٰ", everyday) == "ٱللَّهِٰ"


def test_coverage_box_holds_the_share_and_splits_in_proportion() -> None:
    extents = [(1000.0, -300.0)] * 990 + [(1800.0, -300.0)] * 5 + [(1000.0, -900.0)] * 5
    box = lab_linebox.coverage_box(extents, 0.99)
    assert (box["top"], box["bottom"]) == (1000, -300)
    assert box["held"] == pytest.approx(0.99)
    wide = lab_linebox.coverage_box(extents, 1.0)
    assert (wide["top"], wide["bottom"]) == (1800, -900)
    placed = lab_linebox.split(2.0, 1000, box, (900, -250), extents)
    assert placed["top"] - placed["bottom"] == 2000
    assert placed["top"] / -placed["bottom"] == pytest.approx(1000 / 300, rel=0.01)
    assert placed["held"] == pytest.approx(0.99)
    latin = lab_linebox.split(2.0, 1000, box, (900, -500), extents)
    assert latin["top"] / -latin["bottom"] == pytest.approx(1000 / 500, rel=0.01)


@needs_noto
def test_noto_positioning_explains_every_everyday_mark(tmp_path: Path) -> None:
    import json

    written = lab.build_lab_fonts(
        out_dir=tmp_path,
        scale=1.15,
        quran=None,
        manifest=Path("data/upstream.json"),
        families=Path("data/sawa.json"),
        cache_dir=DOWNLOADS,
    )
    data = json.loads((tmp_path / "positioning.json").read_text(encoding="utf-8"))
    everyday = {m["id"] for m in written["matrix"]["everyday"]}
    marks = {
        name
        for entry in data["lookups"]
        for cls in entry["classes"]
        for name in cls["marks"]
    }
    for key, cell in data["cells"].items():
        if key.split("|")[2] not in everyday:
            continue
        for glyph, attach in zip(cell["glyphs"], cell["attach"], strict=True):
            if glyph in marks and glyph in data["anchors"]:
                assert attach is not None, f"{key}: nothing places {glyph}"
    cell = data["cells"]["U+0628|medial|shadda-fatha"]
    glyphs, attach = cell["glyphs"], cell["attach"]
    fatha, shadda = attach[glyphs.index("uni064E")], attach[glyphs.index("uni0651")]
    assert glyphs[fatha[0]] == "uni0651" and fatha[2] == "mark"
    assert glyphs[shadda[0]] == "uni066E.medi" and shadda[2] == "base"
    lookups = {entry["index"]: entry for entry in data["lookups"]}
    assert lookups[int(fatha[1].split(".")[0])]["feature"] == "mkmk"
    assert data["alternates"]["uni066E.medi"]["feature"] == "medi"
    assert "uni0644.init.rlig" in data["alternates"]
    box = written["approvedLineBox"]
    assert box["height"] == 2.06
    assert box["top"] - box["bottom"] == 2060
    assert box["coverage"]["held"] >= 0.995
