"""metrics.json: each Sawa family's vertical metrics and axes."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from sawa_tools.build.fonts import extract_font_info

if TYPE_CHECKING:
    from pathlib import Path


def _em(value: int, upem: int) -> float:
    return round(value / upem, 4)


def family_metrics(ttf: Path) -> dict[str, Any]:
    from fontTools.ttLib import TTFont

    info = extract_font_info(TTFont(ttf, lazy=True))
    upem = info["unitsPerEm"]
    typo, hhea, win = info["typo"], info["hhea"], info["win"]
    line = typo if typo["useTypoMetrics"] else hhea
    return {
        "unitsPerEm": upem,
        "hhea": hhea,
        "typo": {k: v for k, v in typo.items() if k != "useTypoMetrics"},
        "win": win,
        "useTypoMetrics": typo["useTypoMetrics"],
        "xHeight": info["xHeight"],
        "capHeight": info["capHeight"],
        "lineBox": {
            "source": "typo" if typo["useTypoMetrics"] else "hhea",
            "ascender": _em(line["ascender"], upem),
            "descender": _em(line["descender"], upem),
            "lineGap": _em(line["lineGap"], upem),
            "height": _em(line["ascender"] - line["descender"] + line["lineGap"], upem),
            "winHeight": _em(win["ascent"] + win["descent"], upem),
        },
        "axes": info["axes"],
    }


def build_metrics(families: dict[str, Path]) -> dict[str, Any]:
    return {"families": {fid: family_metrics(path) for fid, path in families.items()}}
