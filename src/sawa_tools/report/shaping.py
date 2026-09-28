"""HarfBuzz shaping snapshots: tests/shaping/<family>.json.

A snapshot holds, per test and per weight (the family's wght minimum,
default and maximum), every glyph HarfBuzz produces in visual order.
`sawa report shaping --update` rewrites them; the report compares a fresh
shaping run against them.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

from sawa_tools.report.shape import FontStack

if TYPE_CHECKING:
    from pathlib import Path

    from sawa_tools.report.catalogue import ReportTest
    from sawa_tools.report.sources import ReportFamily

GLYPH_FIELDS = ["name", "cluster", "xAdvance", "yAdvance", "xOffset", "yOffset"]

GlyphRow = list[Any]
Snapshot = dict[str, dict[str, list[GlyphRow]]]


def weight_key(weight: float) -> str:
    return f"wght={weight:g}"


def shape_family(family: ReportFamily, tests: list[ReportTest]) -> Snapshot:
    snapshot: Snapshot = {test.id: {} for test in tests}
    for weight in family.weights:
        stack = FontStack([family.ttf], {"wght": weight})
        for test in tests:
            snapshot[test.id][weight_key(weight)] = [
                [g.name, g.cluster, g.x_advance, g.y_advance, g.x_offset, g.y_offset]
                for g in stack.shape(test.text, test.feature_settings)
            ]
    return snapshot


def dump_snapshot(family_id: str, snapshot: Snapshot) -> str:
    """One glyph per line, so a snapshot's git diff shows what moved."""
    lines = [
        "{",
        f'  "family": {json.dumps(family_id)},',
        f'  "glyphFields": {json.dumps(GLYPH_FIELDS)},',
        '  "tests": {',
    ]
    for t_index, (test_id, weights) in enumerate(snapshot.items()):
        lines.append(f"    {json.dumps(test_id)}: {{")
        for w_index, (key, rows) in enumerate(weights.items()):
            lines.append(f"      {json.dumps(key)}: [")
            lines += [
                f"        {json.dumps(row, ensure_ascii=False)}"
                + ("," if i < len(rows) - 1 else "")
                for i, row in enumerate(rows)
            ]
            lines.append("      ]" + ("," if w_index < len(weights) - 1 else ""))
        lines.append("    }" + ("," if t_index < len(snapshot) - 1 else ""))
    lines += ["  }", "}", ""]
    return "\n".join(lines)


def load_snapshot(path: Path) -> Snapshot | None:
    if not path.exists():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("glyphFields") != GLYPH_FIELDS:
        return None
    return data["tests"]


def compare(expected: list[GlyphRow] | None, actual: list[GlyphRow]) -> dict[str, Any]:
    """Pass/fail for one test at one weight, with the first differing glyph."""
    if expected is None:
        return {"status": "missing", "glyphs": len(actual)}
    for index in range(max(len(expected), len(actual))):
        want = expected[index] if index < len(expected) else None
        got = actual[index] if index < len(actual) else None
        if want != got:
            return {
                "status": "fail",
                "glyphs": len(actual),
                "firstDiff": {"index": index, "expected": want, "actual": got},
                "expected": expected,
                "actual": actual,
            }
    return {"status": "pass", "glyphs": len(actual)}


def compare_family(expected: Snapshot | None, actual: Snapshot) -> dict[str, Any]:
    results: dict[str, Any] = {}
    for test_id, weights in actual.items():
        want = (expected or {}).get(test_id, {})
        results[test_id] = {
            key: compare(want.get(key), rows) for key, rows in weights.items()
        }
    return results


def summarise(results: dict[str, dict[str, Any]]) -> dict[str, int]:
    """Counts of pass/fail/missing over families, tests and weights."""
    counts = {"pass": 0, "fail": 0, "missing": 0}
    for tests in results.values():
        for weights in tests.values():
            for result in weights.values():
                counts[result["status"]] += 1
    return counts


def write_snapshots(
    families: list[ReportFamily], tests: list[ReportTest], out_dir: Path
) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    written = []
    for family in families:
        path = out_dir / f"{family.id}.json"
        text = dump_snapshot(family.id, shape_family(family, tests))
        path.write_text(text, encoding="utf-8", newline="\n")
        written.append(path)
    return written


def run_shaping(
    families: list[ReportFamily], tests: list[ReportTest], snapshot_dir: Path
) -> dict[str, Any]:
    """shaping.json's content: per family, test and weight results."""
    results = {
        family.id: compare_family(
            load_snapshot(snapshot_dir / f"{family.id}.json"),
            shape_family(family, tests),
        )
        for family in families
    }
    return {
        "glyphFields": GLYPH_FIELDS,
        "summary": summarise(results),
        "families": results,
    }
