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


def _entry(glyph: str, body: tuple[int, int] = (0, 0), **dots: tuple[int, int]) -> Any:
    return {
        "glyph": glyph,
        "body": {"dx": body[0], "dy": body[1]},
        "dots": [{"part": p, "dx": x, "dy": y} for p, (x, y) in dots.items()],
    }


def test_moving_a_body_moves_its_marks_with_it(
    arabic_master: Callable[..., Any],
) -> None:
    before, raw = _reload(arabic_master(extra=True))
    after, baked = _reload(
        lab_preview.bake(arabic_master(extra=True), [_entry("beh", (25, 60))])
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
    after, baked = _reload(lab_preview.bake(arabic_master(extra=True), [entry]))
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
    lab_preview.bake(font, [_entry("beh", **{"contours:1": (40, -10)})])
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
    lab_preview.bake(font, [_entry("beh", (0, 60))])
    coords, _, _ = font["glyf"]["teh"].getCoordinates(font["glyf"])
    assert min(y for _, y in coords) == -150


def test_reads_v2_glyph_entries_and_nothing_from_v1() -> None:
    v1 = {"schema": "sawa-lab/overrides", "version": 1, "overrides": []}
    assert lab_preview.glyph_overrides(v1) == []
    entries = lab_preview.glyph_overrides(
        json.loads(FIXTURE.read_text(encoding="utf-8"))
    )
    assert {e["glyph"] for e in entries} >= {"uni066E.init", "uni0645"}
    with pytest.raises(lab_preview.BakeError):
        lab_preview.glyph_overrides({"schema": "sawa-lab/annotations"})


def test_unknown_glyphs_and_parts_are_refused(
    arabic_master: Callable[..., Any],
) -> None:
    with pytest.raises(lab_preview.BakeError, match="no glyph"):
        lab_preview.bake(arabic_master(extra=True), [_entry("nosuch", (0, 1))])
    with pytest.raises(lab_preview.BakeError, match="no dot glyph"):
        lab_preview.bake(arabic_master(extra=True), [_entry("beh", nodot=(0, 1))])


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
    baked_json = json.loads((tmp_path / lab_preview.BAKED).read_text(encoding="utf-8"))
    assert baked_json["source"] == FIXTURE.name
