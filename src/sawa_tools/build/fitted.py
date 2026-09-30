"""Each family's fitted compaction, kept in data/compaction/<family>.json.

Fitting compaction (compact.py) takes up to an hour and a half per family on
16 cores, so `sawa build fonts --refit` fits it and writes down what it
found, and every other build applies that: the anchors steps 3 to 5 moved,
at their new positions, and step 6's contextual rules with each master's
offsets and their layers. The pause marks and steps 1 and 2 fit nothing and
run again. The file records the key of the inputs it was fitted against:
the source fonts, the anchoring stage's config and code (masters.py), and
the compaction parameters, corpus and code (compact.py). A build whose key
differs stops and asks for a refit.
"""

from __future__ import annotations

import copy
import hashlib
import io
import json
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from fontTools.ttLib import TTFont

from sawa_tools.build.compact import (
    Fit,
    Master,
    add_contexts,
    anchor_lists,
    compact_masters,
    prepared,
    structure,
)
from sawa_tools.build.masters import code_bytes

if TYPE_CHECKING:
    from collections.abc import Mapping, Sequence
    from pathlib import Path

    from sawa_tools.build.compact import (
        AnchorPlace,
        Compaction,
        Context,
        Params,
        Rules,
    )


class FitError(Exception):
    """Raised when a family's fitted compaction is missing, stale or does
    not fit its masters.
    """


def fit_key(masters_key: str, compaction: Compaction) -> str:
    """The key of everything a fit depends on: the anchored masters' key
    (masters.py) and the compaction's (compact.py).
    """
    return hashlib.sha256(f"{masters_key}\n{compaction.key()}".encode()).hexdigest()


def _number(value: float) -> float | int:
    return int(value) if float(value).is_integer() else value


def _entries(name: str, entries: Sequence[Any], last: bool = False) -> list[str]:
    end = "" if last else ","
    if not entries:
        return [f'  "{name}": []{end}']
    rows = [json.dumps(e, ensure_ascii=False, separators=(",", ":")) for e in entries]
    body = [f"    {r}," for r in rows[:-1]] + [f"    {rows[-1]}"]
    return [f'  "{name}": [', *body, f"  ]{end}"]


def dumps(fit: Fit, family: str, key: str) -> str:
    """`fit` as JSON: one anchor or context per line, sorted, so that a
    refit's diff shows what moved. An anchor lists its position per master,
    null where that master left it; a context lists its layer, its glyphs
    and each moved position's offset per master.
    """
    locations = sorted(fit.anchors)
    places = sorted({p for own in fit.anchors.values() for p in own})
    anchors = [
        [*place, [_xy(fit.anchors[w].get(place)) for w in locations]]
        for place in places
    ]
    contexts = []
    for context in sorted(fit.layers):
        own = [fit.rules[w].get(context, {}) for w in locations]
        moves = [
            [p, [list(mine.get(p, (0, 0))) for mine in own]]
            for p in sorted({p for mine in own for p in mine})
        ]
        contexts.append([fit.layers[context], list(context), moves])
    lines = [
        "{",
        f'  "family": {json.dumps(family)},',
        f'  "fittedAgainst": "{key}",',
        f'  "masters": {json.dumps([_number(w) for w in locations])},',
        *_entries("anchors", anchors),
        *_entries("contexts", contexts, last=True),
        "}",
    ]
    return "\n".join(lines) + "\n"


def _xy(value: tuple[int, int] | None) -> list[int] | None:
    return None if value is None else list(value)


def loads(text: str) -> tuple[str, Fit]:
    """The key and the fit of a file `dumps` wrote."""
    data = json.loads(text)
    locations = [float(w) for w in data["masters"]]
    anchors: dict[float, dict[AnchorPlace, tuple[int, int]]] = {
        w: {} for w in locations
    }
    for li, si, glyph, component, cls, values in data["anchors"]:
        for w, value in zip(locations, values, strict=True):
            if value is not None:
                anchors[w][li, si, glyph, component, cls] = (value[0], value[1])
    rules: dict[float, Rules] = {w: {} for w in locations}
    layers: dict[Context, int] = {}
    for layer, glyphs, moves in data["contexts"]:
        context = tuple(glyphs)
        layers[context] = layer
        for w in locations:
            rules[w][context] = {}
        for p, offsets in moves:
            for w, (dx, dy) in zip(locations, offsets, strict=True):
                rules[w][context][p] = (dx, dy)
    return data["fittedAgainst"], Fit(anchors, rules, layers)


def _set_anchors(font: TTFont, values: Mapping[AnchorPlace, tuple[int, int]]) -> None:
    remaining = dict(values)
    for li, si, glyph, component, anchors in anchor_lists(font):
        for cls, anchor in enumerate(anchors):
            place = (li, si, glyph, component, cls)
            if place not in remaining or anchor is None:
                continue
            anchors[cls] = anchor = copy.deepcopy(anchor)
            anchor.XCoordinate, anchor.YCoordinate = remaining.pop(place)
    if remaining:
        raise FitError(
            f"{len(remaining)} fitted anchors are not in the master, such as "
            f"{min(remaining)}"
        )


def _reloaded(font: TTFont) -> TTFont:
    buffer = io.BytesIO()
    copy.deepcopy(font).save(buffer)
    return TTFont(io.BytesIO(buffer.getvalue()))


def apply_fit(
    masters: Mapping[float, TTFont],
    default: float,
    params: Params,
    lines: Sequence[str],
    fit: Fit,
) -> dict[float, TTFont]:
    """`masters` compacted as `fit` says, in the order compact_masters
    compacts them, so that the result is the fit's own.
    """
    fonts, decided, _ = prepared(masters, default, params, lines)
    if sorted(fonts) != sorted(fit.anchors):
        raise FitError(f"fitted on masters {sorted(fit.anchors)}, not {sorted(fonts)}")
    for w in sorted(fonts):
        master = Master(_reloaded(fonts[w]), params, decided)
        structure(master)
        _set_anchors(master.font, fit.anchors[w])
        fonts[w] = _reloaded(master.font)
    locations = sorted(fonts)
    add_contexts(
        [fonts[w] for w in locations], [fit.rules[w] for w in locations], fit.layers
    )
    return {w: _reloaded(fonts[w]) for w in locations}


def _tables(font: TTFont) -> dict[str, bytes]:
    """The font's table data but head, whose timestamps each save sets."""
    reader: Any = font.reader
    return {tag: reader[tag] for tag in reader.tables if tag != "head"}


@dataclass(frozen=True)
class FittedFile:
    """A family's fitted compaction file, valid while `key` matches."""

    family: str
    path: Path
    key: str

    def _refit(self) -> str:
        return (
            f"run `uv run --group build sawa build fonts --refit {self.family}` "
            "(about an hour per family on 16 cores) and commit the result"
        )

    def read(self) -> Fit:
        try:
            text = self.path.read_text(encoding="utf-8")
        except FileNotFoundError:
            raise FitError(
                f"{self.path.as_posix()} is missing; {self._refit()}"
            ) from None
        key, fit = loads(text)
        if key != self.key:
            raise FitError(
                f"{self.path.as_posix()} was fitted against other inputs (the "
                "source fonts, the anchoring stage, the compaction parameters, "
                f"the corpus or the build code changed); {self._refit()}"
            )
        return fit

    def digest(self) -> str:
        return hashlib.sha256(code_bytes(self.path)).hexdigest()

    def write(self, fit: Fit) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_name(self.path.name + ".tmp")
        tmp.write_bytes(dumps(fit, self.family, self.key).encode("utf-8"))
        tmp.replace(self.path)


def compacted(
    masters: Mapping[float, TTFont],
    default: float,
    compaction: Compaction,
    fitted: FittedFile,
    refit: bool = False,
) -> dict[float, TTFont]:
    """The masters compacted by the fit in `fitted`; with `refit`, fitted
    first and written there, and checked to come out the same applied.
    """
    params, lines = compaction.params, compaction.lines
    if not refit:
        return apply_fit(masters, default, params, lines, fitted.read())
    started = time.perf_counter()
    result, fit, report = compact_masters(masters, default, params, lines)
    print(
        f"{compaction.family}: compaction fitted in "
        f"{time.perf_counter() - started:.0f} s, {report.rules} contextual "
        f"rules in {report.lookups} lookups; lines with contacts per joint "
        "pass, under the clearance and in all: "
        + " ".join(
            f"{u}/{n}" for u, n in zip(report.under, report.contacts, strict=True)
        )
    )
    if min(report.under, default=0):
        print(
            f"{compaction.family}: {min(report.under)} lines keep a contact "
            f"under the clearance ({len(report.stuck)} contacts no move clears); "
            "`sawa check leading` fails any in its corpus"
        )
    fitted.write(fit)
    applied = apply_fit(masters, default, params, lines, fitted.read())
    for w, font in result.items():
        if _tables(applied[w]) != _tables(font):
            raise FitError(
                f"{fitted.path.as_posix()} applied does not reproduce the fit "
                f"at wght {w:g}"
            )
    return applied
