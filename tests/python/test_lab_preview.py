import io
import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from sawa_tools import lab, lab_preview

DOWNLOADS = Path(".cache/downloads")
FIXTURE = Path("lab/tests/fixtures/overrides-sample.json")


def _reload(font: Any) -> tuple[Any, bytes]:
    from fontTools.ttLib import TTFont

    buffer = io.BytesIO()
    font.save(buffer)
    raw = buffer.getvalue()
    return TTFont(io.BytesIO(raw)), raw


def _placed(font: Any, raw: bytes, text: str) -> list[tuple[str, tuple[float, ...]]]:
    """Each glyph's name and ink box as HarfBuzz places it, in visual order."""
    from fontTools.pens.boundsPen import BoundsPen

    glyphs = font.getGlyphSet()
    names = font.getGlyphOrder()
    out = []
    pen_x = 0
    for gid, _cluster, advance, x_offset, y_offset in lab.shape(
        raw, [ord(c) for c in text]
    ):
        pen = BoundsPen(glyphs)
        glyphs[names[gid]].draw(pen)
        if pen.bounds is not None:
            x0, y0, x1, y1 = pen.bounds
            dx, dy = pen_x + x_offset, y_offset
            out.append((names[gid], (x0 + dx, y0 + dy, x1 + dx, y1 + dy)))
        pen_x += advance
    return out


def _moved(a: tuple[float, ...], b: tuple[float, ...]) -> tuple[float, float]:
    assert a[2] - a[0] == pytest.approx(b[2] - b[0])
    assert a[3] - a[1] == pytest.approx(b[3] - b[1])
    return b[0] - a[0], b[1] - a[1]


def _edit(mechanism: str, dx: int, dy: int, **target: Any) -> dict[str, Any]:
    return {"mechanism": mechanism, "target": target, "dx": dx, "dy": dy}


def _entry(
    glyph: str, body: tuple[int, int] = (0, 0), **dots: tuple[int, int]
) -> list[dict[str, Any]]:
    """Outline edits of a glyph's body and its dot groups."""
    parts = {"body": body, **dots}
    return [
        _edit("outline", x, y, glyph=glyph, part=part)
        for part, (x, y) in parts.items()
        if x or y
    ]


def _class(font: Any, lookup_type: str, mark: str) -> str:
    from sawa_tools import lab_gpos

    for entry in lab_gpos.lookups(font):
        for cls in entry["classes"]:
            if entry["type"] == lookup_type and mark in cls["marks"]:
                return cls["id"]
    raise AssertionError(f"no {lookup_type} class holds {mark}")


def _offsets(
    raw: bytes, names: list[str], text: str
) -> dict[str, list[tuple[int, int]]]:
    """Each glyph's offsets in visual order, by name."""
    out: dict[str, list[tuple[int, int]]] = {}
    for gid, _cluster, _advance, x, y in lab.shape(raw, [ord(c) for c in text]):
        out.setdefault(names[gid], []).append((x, y))
    return out


def _baked(
    master: Callable[..., Any], edits: list[dict[str, Any]], *texts: str, **options: Any
) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    """Each text's offsets before and after baking `edits`."""
    before, raw = _reload(master(**options))
    font = master(**options)
    _after, baked = _reload(lab_preview.bake(font, edits))
    names = before.getGlyphOrder()
    lab._HB_FONTS.clear()
    return [(_offsets(raw, names, t), _offsets(baked, names, t)) for t in texts]


def _delta(
    old: dict[str, Any], new: dict[str, Any], name: str, i: int = 0
) -> tuple[int, int]:
    (ox, oy), (nx, ny) = old[name][i], new[name][i]
    return nx - ox, ny - oy


def test_moving_a_body_moves_its_marks_with_it(
    arabic_master: Callable[..., Any],
) -> None:
    before, raw = _reload(arabic_master(extra=True))
    after, baked = _reload(
        lab_preview.bake(arabic_master(extra=True), _entry("beh", (25, 60)))
    )
    old = dict(_placed(before, raw, "بَ"))
    new = dict(_placed(after, baked, "بَ"))
    assert _moved(old["beh"], new["beh"]) == (25, 60)
    assert _moved(old["fatha"], new["fatha"]) == (25, 60)


def test_moving_a_split_off_dot_leaves_the_marks_on_it(
    arabic_master: Callable[..., Any],
) -> None:
    before, raw = _reload(arabic_master(extra=True))
    entry = _entry("beh", dotabove=(30, 40))
    after, baked = _reload(lab_preview.bake(arabic_master(extra=True), entry))
    text = "تَ"
    old = _placed(before, raw, text)
    new = _placed(after, baked, text)
    assert [n for n, _ in new] == ["fatha", "dotabove.lab.beh", "beh"]
    assert _moved(old[1][1], new[1][1]) == (30, 40)
    assert _moved(old[0][1], new[0][1]) == (0, 0)
    assert _moved(old[2][1], new[2][1]) == (0, 0)
    assert _placed(after, baked, "بَ") == _placed(before, raw, "بَ")


def test_a_dot_inside_the_glyph_moves_alone(arabic_master: Callable[..., Any]) -> None:
    from fontTools.pens.ttGlyphPen import TTGlyphPen

    font = arabic_master(extra=True)
    pen = TTGlyphPen(None)
    for x0, y0, x1, y1 in ((50, -150, 550, 150), (250, -300, 330, -220)):
        pen.moveTo((x0, y0))
        pen.lineTo((x0, y1))
        pen.lineTo((x1, y1))
        pen.lineTo((x1, y0))
        pen.closePath()
    font["glyf"]["beh"] = pen.glyph()
    lab_preview.bake(font, _entry("beh", **{"contours:1": (40, -10)}))
    coords, ends, _ = font["glyf"]["beh"].getCoordinates(font["glyf"])
    assert list(coords[: ends[0] + 1]) == [
        (50, -150),
        (50, 150),
        (550, 150),
        (550, -150),
    ]
    assert list(coords[ends[0] + 1 :]) == [
        (290, -310),
        (290, -230),
        (370, -230),
        (370, -310),
    ]


def test_composites_built_from_a_moved_glyph_stay_put(
    arabic_master: Callable[..., Any],
) -> None:
    from fontTools.ttLib.tables._g_l_y_f import Glyph, GlyphComponent

    font = arabic_master(extra=True)
    composite = Glyph()
    composite.numberOfContours = -1
    component = GlyphComponent()
    component.glyphName, component.x, component.y, component.flags = "beh", 0, 0, 0
    composite.components = [component]
    font["glyf"]["teh"] = composite
    lab_preview.bake(font, _entry("beh", (0, 60)))
    coords, _, _ = font["glyf"]["teh"].getCoordinates(font["glyf"])
    assert min(y for _, y in coords) == -150


def test_reads_v3_edits_and_migrates_v2_and_v1() -> None:
    edits, requests = lab_preview.edits_of(
        json.loads(FIXTURE.read_text(encoding="utf-8"))
    )
    assert {e["mechanism"] for e in edits} == set(lab_preview.MECHANISMS)
    assert requests[0]["mechanism"] == "substitution"
    v2 = {
        "schema": "sawa-lab/overrides",
        "version": 2,
        "glyphs": [_v2_glyph()],
        "marks": [
            {
                "key": {"letter": "U+0628", "form": "medial", "marks": ["U+064E"]},
                "marks": [{"index": 0, "glyph": "fatha", "dx": 0, "dy": -40}],
            }
        ],
    }
    edits, _ = lab_preview.edits_of(v2, lambda key: "beh.medi")
    assert edits == [
        _edit("outline", 0, 40, glyph="beh", part="body"),
        _edit("outline", 3, 0, glyph="beh", part="dotbelow"),
        _edit("pair", 0, -40, base="beh.medi", mark="fatha"),
    ]
    v1 = {"schema": "sawa-lab/overrides", "version": 1, "overrides": v2["marks"]}
    assert lab_preview.edits_of(v1)[0] == []
    with pytest.raises(lab_preview.BakeError):
        lab_preview.edits_of({"schema": "sawa-lab/annotations"})
    with pytest.raises(lab_preview.BakeError, match="mechanism"):
        lab_preview.edits_of({**v2, "version": 3, "edits": [{"mechanism": "kern"}]})


def _v2_glyph() -> dict[str, Any]:
    return {
        "glyph": "beh",
        "body": {"dx": 0, "dy": 40},
        "dots": [{"part": "dotbelow", "dx": 3, "dy": 0}],
    }


def test_an_anchor_move_moves_its_class_on_that_glyph(
    arabic_master: Callable[..., Any],
) -> None:
    top = _class(arabic_master(), "base", "fatha")
    edits = [_edit("anchor", 10, 40, glyph="beh", **{"class": top})]
    (beh_old, beh_new), (alef_old, alef_new) = _baked(arabic_master, edits, "بَِ", "اَ")
    assert _delta(beh_old, beh_new, "fatha") == (10, 40)
    assert _delta(beh_old, beh_new, "kasra") == (0, 0)
    assert _delta(alef_old, alef_new, "fatha") == (0, 0)


def test_a_split_class_moves_only_its_marks_on_that_glyph(
    arabic_master: Callable[..., Any],
) -> None:
    top = _class(arabic_master(extra=True), "base", "fatha")
    edits = [
        _edit("anchor", 0, 10, glyph="beh", **{"class": top}),
        _edit("split-class", 5, 20, glyph="beh", marks=["fatha"], **{"class": top}),
    ]
    (old, new), (sad_old, sad_new), (alef_old, alef_new) = _baked(
        arabic_master, edits, "بَ", "بۖ", "اَ", extra=True
    )
    assert _delta(old, new, "fatha") == (5, 30)
    assert _delta(sad_old, sad_new, "smallhighsad") == (0, 10)
    assert _delta(alef_old, alef_new, "fatha") == (0, 0)


def test_a_mark_to_mark_anchor_moves_what_stacks_on_it(
    arabic_master: Callable[..., Any],
) -> None:
    stack = _class(arabic_master(), "mark", "fatha")
    edits = [_edit("mkmk-anchor", -5, 30, glyph="fatha", **{"class": stack})]
    ((old, new),) = _baked(arabic_master, edits, "بََ")
    # Visual order: the second fatha comes first.
    assert _delta(old, new, "fatha", 1) == (0, 0)
    assert _delta(old, new, "fatha", 0) == (-5, 30)


def test_a_pair_rule_moves_one_mark_after_one_base(
    arabic_master: Callable[..., Any],
) -> None:
    edits = [
        _edit("pair", 0, -30, base="beh", mark="kasra"),
        _edit("pair", 20, 15, base="beh", mark="fatha"),
    ]
    (old, new), (alef_old, alef_new) = _baked(arabic_master, edits, "بََِ", "اِ")
    assert _delta(old, new, "kasra") == (0, -30)
    assert _delta(old, new, "fatha", 1) == (20, 15)
    # The fatha stacked on it takes the adjustment's x, not its y (HarfBuzz 14.5).
    assert _delta(old, new, "fatha", 0) == (20, 0)
    assert _delta(alef_old, alef_new, "kasra") == (0, 0)


def test_unknown_glyphs_and_parts_are_refused(
    arabic_master: Callable[..., Any],
) -> None:
    with pytest.raises(lab_preview.BakeError, match="no glyph"):
        lab_preview.bake(arabic_master(extra=True), _entry("nosuch", (0, 1)))
    with pytest.raises(lab_preview.BakeError, match="no dot glyph"):
        lab_preview.bake(arabic_master(extra=True), _entry("beh", nodot=(0, 1)))
    with pytest.raises(lab_preview.BakeError, match="no anchor"):
        lab_preview.bake(
            arabic_master(), [_edit("anchor", 0, 1, glyph="fatha", **{"class": "0.0"})]
        )
    with pytest.raises(lab_preview.BakeError, match="no lookup"):
        lab_preview.bake(
            arabic_master(),
            [_edit("mkmk-anchor", 0, 1, glyph="fatha", **{"class": "9.0"})],
        )


@pytest.mark.skipif(
    not (DOWNLOADS / "noto_sans_arabic").exists(),
    reason="needs the cached Noto sources (sawa build fonts)",
)
def test_baking_noto_moves_each_part_by_its_offset(tmp_path: Path) -> None:
    from fontTools.ttLib import TTFont

    lab.build_lab_fonts(
        out_dir=tmp_path,
        scale=1.15,
        quran=None,
        manifest=Path("data/upstream.json"),
        families=Path("data/sawa.json"),
        cache_dir=DOWNLOADS,
    )
    lab_preview.preview(FIXTURE, tmp_path)
    before = TTFont(tmp_path / "calib.ttf")
    after = TTFont(tmp_path / lab_preview.PREVIEW)
    raw, baked = (
        (tmp_path / "calib.ttf").read_bytes(),
        (tmp_path / lab_preview.PREVIEW).read_bytes(),
    )
    # Beh initial with kasra: the body rises 60, the dot moves (30, -40) more,
    # and kasra, which stacks under the dot, moves with the body only.
    text = "بِب"
    old = _placed(before, raw, text)
    new = _placed(after, baked, text)
    names = [n for n, _ in new]
    assert "dotbelowar.lab.uni066E.init" in names
    moves = {n: _moved(o[1], b) for (n, b), o in zip(new, old, strict=True)}
    assert moves["uni066E.init"] == (0, 60)
    assert moves["dotbelowar.lab.uni066E.init"] == (30, 20)
    assert moves["uni0650"] == (0, 60)
    # Meem isolated rises 120; beh final next to it does not move.
    old = dict(_placed(before, raw, "م"))
    new = dict(_placed(after, baked, "م"))
    assert _moved(old["uni0645"], new["uni0645"]) == (0, 120)
    # The GPOS mechanisms, each where the lab's overlay puts it, within a unit.
    lab._HB_FONTS.clear()
    names = before.getGlyphOrder()
    for text, glyph, index, expected in (
        ("هَ", "uni064E", 0, (-15, 40)),  # heh's top anchor
        ("بَ", "uni064E", 0, (15, 30)),  # fatha split from beh's top class
        ("بُ", "uni064F", 0, (0, 0)),  # damma stays in it
        ("لِـ", "uni0650", 0, (20, -25)),  # kasra after lam initial
        ("لِ", "uni0650", 0, (0, 0)),  # not after lam isolated
        ("جَّـ", "uni0651", 0, (0, 35)),  # shadda after hah initial
        ("جَّـ", "uni064E", 0, (0, 20)),  # fatha on shadda: the stack anchor only
        ("ـبَّـ", "uni064E", 0, (0, 20)),
    ):
        was = _offsets(raw, names, text)[glyph][index]
        now = _offsets(baked, names, text)[glyph][index]
        assert (now[0] - was[0], now[1] - was[1]) == pytest.approx(expected, abs=1), (
            text
        )
    baked_json = json.loads((tmp_path / lab_preview.BAKED).read_text(encoding="utf-8"))
    assert baked_json["source"] == FIXTURE.name
    assert {e["mechanism"] for e in baked_json["edits"]} == set(lab_preview.MECHANISMS)
    assert baked_json["requests"][0]["reason"]
