from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from typing import TYPE_CHECKING, cast

from sawa_tools.report.catalogue import ReportTest, load_tests
from sawa_tools.report.layers import Stacks, write_test
from sawa_tools.report.shape import FontStack

if TYPE_CHECKING:
    from sawa_tools.report.sources import ReportFamily


def _stacks(sawa: Path, upstream: Path) -> Stacks:
    stacks = Stacks([])
    family = SimpleNamespace(id="sawa-x", upstream_id="upstream-x")
    stacks.families = cast("list[ReportFamily]", [family])
    stacks.stacks = {"sawa-x": FontStack([sawa]), "upstream-x": FontStack([upstream])}
    stacks.titles = {"sawa-x": "Sawa X", "upstream-x": "Upstream X"}
    return stacks


TEST = ReportTest(id="ab", text="AB", purpose={"en": "e", "ar": "a"})


def test_writes_every_layer_on_one_viewbox(make_font, tmp_path: Path) -> None:
    stacks = _stacks(make_font("S"), make_font("U", shift=40))
    data = write_test(TEST, stacks, tmp_path / "out", baseline=None)
    test_dir = tmp_path / "out" / "tests" / "ab"
    assert sorted(p.name for p in test_dir.iterdir()) == [
        "sawa-x.svg",
        "test.json",
        "upstream-x.svg",
    ]
    box = " ".join(f"{v:g}" for v in data["viewBox"])
    for layer in ("sawa-x", "upstream-x"):
        assert f'viewBox="{box}"' in (test_dir / f"{layer}.svg").read_text("utf-8")
    assert data["diffBaseline"] == "upstream"
    assert data["diffRegions"]["sawa-x"]
    assert data["codepoints"] == ["U+0041", "U+0042"]
    assert json.loads((test_dir / "test.json").read_text("utf-8")) == data


def test_an_unchanged_rebuild_has_no_regions_against_its_baseline(
    make_font, tmp_path: Path
) -> None:
    stacks = _stacks(make_font("S"), make_font("U", shift=40))
    write_test(TEST, stacks, tmp_path / "v1", baseline=None)
    data = write_test(TEST, stacks, tmp_path / "v2", baseline=tmp_path / "v1")
    assert data["diffBaseline"] == "previous"
    assert data["diffRegions"] == {"sawa-x": []}


def test_catalogue_holds_stress_mixed_and_fatiha() -> None:
    ids = [test.id for test in load_tests()]
    assert "shadda-kasra-ss01" in ids
    assert "mixed-sahara-etymology" in ids
    assert ids[-1] == "fatiha-1"


def test_extraction_is_keyed_on_the_pinned_archive_sha(tmp_path: Path) -> None:
    import hashlib
    import zipfile

    from sawa_tools.report.sources import _extract

    cache, out = tmp_path / "cache", tmp_path / "out"
    cache.mkdir()

    def pin(payload: bytes) -> dict:
        with zipfile.ZipFile(cache / "src", "w") as zf:
            zf.writestr("fonts/A.ttf", payload)
        sha = hashlib.sha256((cache / "src").read_bytes()).hexdigest()
        return {"sources": {"src": {"sha256": sha}}}

    first = _extract("src", "fonts/A.ttf", pin(b"old"), cache, out)
    second = _extract("src", "fonts/A.ttf", pin(b"new"), cache, out)
    assert first != second
    assert first.read_bytes() == b"old" and second.read_bytes() == b"new"
