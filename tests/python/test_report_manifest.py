from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from typing import TYPE_CHECKING, cast

from sawa_tools.report.catalogue import ReportTest
from sawa_tools.report.manifest import baseline_info, build_manifest, sha256_file

if TYPE_CHECKING:
    from sawa_tools.report.sources import ReportFamily


def test_manifest_lists_fonts_tests_tools_and_baseline(make_font) -> None:
    sawa, upstream = make_font("Sawa"), make_font("Up")
    family = SimpleNamespace(
        id="sawa-x",
        family=SimpleNamespace(name="Sawa X"),
        ttf=sawa,
        upstream_id="upstream-x",
        upstream=[upstream],
        upstream_names=["Up 1.0"],
    )
    manifest = build_manifest(
        version_name="v0.1",
        families=cast("list[ReportFamily]", [family]),
        tests=[ReportTest(id="ab", text="AB", purpose={"en": "", "ar": ""})],
        baseline=None,
        shaping={"pass": 1, "fail": 0, "missing": 0},
        fontbakery={"ran": False, "reason": "not requested"},
        date=datetime(2026, 9, 29, 12, 0, tzinfo=UTC),
    )
    assert manifest["version"] == "v0.1"
    assert manifest["date"] == "2026-09-29T12:00:00Z"
    assert manifest["tests"] == ["ab"]
    assert manifest["diffBaseline"] == {"kind": "upstream", "version": None}
    font = manifest["fonts"][0]
    assert font["family"] == "sawa-x" and font["sha256"] == sha256_file(sawa)
    assert font["upstream"]["fonts"][0]["file"] == "Up.ttf"
    assert {"python", "fonttools", "uharfbuzz", "harfbuzz"} <= set(manifest["tools"])
    json.dumps(manifest)


def test_previous_baseline_takes_its_version_from_its_manifest(tmp_path: Path) -> None:
    bundle = tmp_path / "bundle"
    bundle.mkdir()
    (bundle / "manifest.json").write_text('{"version": "v0.0.9"}', encoding="utf-8")
    assert baseline_info(bundle) == {"kind": "previous", "version": "v0.0.9"}
    bare = tmp_path / "v0.0.8"
    bare.mkdir()
    assert baseline_info(bare) == {"kind": "previous", "version": "v0.0.8"}


def test_fontbakery_index_links_each_family() -> None:
    from sawa_tools.report.fontbakery import STATUSES, index_html

    counts = dict.fromkeys(STATUSES, 0) | {"FAIL": 3}
    page = index_html({"sawa-serif": {"counts": counts}})
    assert '<a href="sawa-serif/index.html">sawa-serif</a>' in page
    assert "<td>3</td>" in page


def test_fontbakery_json_without_result_raises(monkeypatch, tmp_path: Path) -> None:
    import subprocess

    import pytest

    from sawa_tools.report import fontbakery

    def fake_run(args, **kwargs):
        Path(args[args.index("--json") + 1]).write_text("{}", encoding="utf-8")
        return subprocess.CompletedProcess(args, 1, "", "")

    monkeypatch.setattr(fontbakery.subprocess, "run", fake_run)
    with pytest.raises(fontbakery.FontbakeryError):
        fontbakery._run_one(tmp_path / "a.ttf", tmp_path / "out" / "index.html")
