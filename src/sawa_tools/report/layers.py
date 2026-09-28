"""tests/<test-id>/: test.json and one SVG layer per font.

Layers: sawa-serif, sawa-sans, sawa-mono and their upstream counterparts
(upstream-serif, upstream-sans, upstream-mono), all on one viewBox. Each
Sawa layer is diffed against the previous bundle's same file when a
baseline bundle has it, else against its upstream layer.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

from sawa_tools.report.diff import DEFAULT_DILATE, DEFAULT_SCALE, diff_regions
from sawa_tools.report.render import layout, shared_viewbox, svg_document
from sawa_tools.report.shape import FontStack

if TYPE_CHECKING:
    from pathlib import Path

    from sawa_tools.report.catalogue import ReportTest
    from sawa_tools.report.render import Layout
    from sawa_tools.report.sources import ReportFamily

FONT_SIZE = 64
MARGIN = 16


class Stacks:
    """Loads each layer's fonts once for the whole run."""

    def __init__(self, families: list[ReportFamily]) -> None:
        self.families = families
        self.stacks: dict[str, FontStack] = {}
        self.titles: dict[str, str] = {}
        for family in families:
            default = {"wght": family.family.wght.default}
            self.stacks[family.id] = FontStack([family.ttf], default)
            self.titles[family.id] = family.family.name
            self.stacks[family.upstream_id] = FontStack(
                family.upstream, family.upstream_variations
            )
            self.titles[family.upstream_id] = " + ".join(family.upstream_names)


def write_test(
    test: ReportTest,
    stacks: Stacks,
    out_dir: Path,
    baseline: Path | None,
) -> dict[str, Any]:
    """Writes one test's directory and returns its test.json content."""
    layouts: dict[str, Layout] = {
        layer: layout(stack, test.text, FONT_SIZE, test.feature_settings)
        for layer, stack in stacks.stacks.items()
    }
    viewbox = shared_viewbox(list(layouts.values()), MARGIN)
    test_dir = out_dir / "tests" / test.id
    test_dir.mkdir(parents=True, exist_ok=True)
    svgs: dict[str, str] = {}
    for layer, item in layouts.items():
        svgs[layer] = svg_document(item, viewbox, stacks.titles[layer])
        (test_dir / f"{layer}.svg").write_text(svgs[layer], encoding="utf-8")

    regions: dict[str, Any] = {}
    against: dict[str, str] = {}
    for family in stacks.families:
        previous = (
            baseline / "tests" / test.id / f"{family.id}.svg" if baseline else None
        )
        if previous is not None and previous.exists():
            other, against[family.id] = previous.read_text(encoding="utf-8"), "previous"
        else:
            other, against[family.id] = svgs[family.upstream_id], "upstream"
        regions[family.id] = [r.as_dict() for r in diff_regions(svgs[family.id], other)]

    data = {
        "id": test.id,
        "purpose": test.purpose,
        "text": test.text,
        "codepoints": [f"U+{ord(ch):04X}" for ch in test.text],
        "features": test.features,
        "fontSize": FONT_SIZE,
        "viewBox": viewbox.as_list(),
        "layers": [
            {"id": layer, "file": f"{layer}.svg", "name": stacks.titles[layer]}
            for layer in layouts
        ],
        "guides": {layer: item.guides() for layer, item in layouts.items()},
        "diffBaseline": (
            "previous" if set(against.values()) == {"previous"} else "upstream"
        ),
        "diffAgainst": against,
        "diffMethod": {"pxPerUnit": DEFAULT_SCALE, "dilatePx": DEFAULT_DILATE},
        "diffRegions": regions,
    }
    (test_dir / "test.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return data
