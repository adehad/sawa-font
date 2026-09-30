from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

pytest.importorskip("fontTools")
pytest.importorskip("uharfbuzz")
pytest.importorskip("numpy")

from conftest import compact_params

from sawa_tools.build import anchors, compact, fitted

Master = Callable[..., Any]

# Fatha on lam starts inside lam's ink, and the pause mark sits after alef.
LINES = ["لَ", "اَؕ", "بَ لَ", "تَ ۖ"]


def _masters(arabic_master: Master) -> dict[float, Any]:
    masters = {400.0: arabic_master(extra=True), 700.0: arabic_master(extra=True)}
    anchors.anchor_masters(masters, 400.0, 0.03)
    return masters


def test_a_written_fit_applied_gives_the_fitted_masters(
    arabic_master: Master,
) -> None:
    masters = _masters(arabic_master)
    params = compact_params(pause=_pause())
    result, fit, _ = compact.compact_masters(masters, 400.0, params, LINES, jobs=1)
    assert any(fit.anchors.values())
    text = fitted.dumps(fit, "fixture", "k1")
    key, loaded = fitted.loads(text)
    assert key == "k1"
    assert fitted.dumps(loaded, "fixture", "k1") == text
    applied = fitted.apply_fit(masters, 400.0, params, LINES, loaded)
    for w, font in result.items():
        assert fitted._tables(applied[w]) == fitted._tables(font)


def _pause() -> dict[str, Any]:
    return {
        "codepoints": ["U+06D6"],
        "sideBearing": 0.04,
        "mark": "U+064E",
        "on": "U+0628",
    }


def test_a_fit_of_other_inputs_asks_for_a_refit(tmp_path: Path) -> None:
    path = tmp_path / "fam.json"
    fit = compact.Fit({400.0: {}}, {400.0: {}}, {})
    fitted.FittedFile("fam", path, "old").write(fit)
    assert fitted.FittedFile("fam", path, "old").read() == fit
    with pytest.raises(fitted.FitError, match="--refit fam"):
        fitted.FittedFile("fam", path, "new").read()
    with pytest.raises(fitted.FitError, match="missing"):
        fitted.FittedFile("fam", tmp_path / "none.json", "old").read()
