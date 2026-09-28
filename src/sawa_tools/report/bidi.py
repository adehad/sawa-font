"""The Unicode Bidirectional Algorithm (UAX #9) for one line without
explicit formatting characters.

Covers the paragraph level (P2, P3), X9's removal of boundary neutrals,
weak types (W1 to W7), bracket pairs (N0, with BD16 pairing), neutrals (N1,
N2), implicit levels (I1, I2), L1 and run reordering (L2). Explicit
embeddings, overrides and isolates (X1 to X8, X10) are not implemented:
`levels` rejects their formatting characters, so a string using them fails
loudly instead of rendering in the wrong order. Bidi classes come from the
stdlib `unicodedata`; bracket pairs from data/unicode/BidiBrackets.txt,
which must be the same Unicode version.
"""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass
from functools import cache
from pathlib import Path

DEFAULT_BRACKETS = Path("data/unicode/BidiBrackets.txt")

_EXPLICIT = {"LRE", "RLE", "LRO", "RLO", "PDF", "LRI", "RLI", "FSI", "PDI"}
_NEUTRAL = {"B", "S", "WS", "ON"}
_MAX_BRACKET_DEPTH = 63


class BidiError(Exception):
    """Raised for text this implementation cannot order."""


@dataclass(frozen=True)
class Run:
    start: int
    end: int
    level: int

    @property
    def rtl(self) -> bool:
        return self.level % 2 == 1


@cache
def brackets(path: Path = DEFAULT_BRACKETS) -> dict[int, tuple[int, str]]:
    """Codepoint -> (paired bracket, "o" or "c") from BidiBrackets.txt."""
    table: dict[int, tuple[int, str]] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        data = line.split("#", 1)[0].strip()
        if not data:
            continue
        cp, pair, kind = (field.strip() for field in data.split(";"))
        table[int(cp, 16)] = (int(pair, 16), kind)
    return table


def _canonical(cp: int) -> int:
    """BD16 matches brackets by canonical equivalence (U+2329 is U+3008)."""
    decomposed = unicodedata.normalize("NFD", chr(cp))
    return ord(decomposed) if len(decomposed) == 1 else cp


def paragraph_level(text: str) -> int:
    for ch in text:
        kind = unicodedata.bidirectional(ch)
        if kind == "L":
            return 0
        if kind in ("R", "AL"):
            return 1
    return 0


def _resolve_weak(types: list[str], sos: str) -> list[str]:
    out = list(types)
    prev = sos
    for i, kind in enumerate(out):
        if kind == "NSM":
            out[i] = prev
        prev = out[i]
    strong = sos
    for i, kind in enumerate(out):
        if kind in ("L", "R", "AL"):
            strong = kind
        elif kind == "EN" and strong == "AL":
            out[i] = "AN"
    out = ["R" if kind == "AL" else kind for kind in out]
    for i in range(1, len(out) - 1):
        before, kind, after = out[i - 1], out[i], out[i + 1]
        if kind == "ES" and before == after == "EN":
            out[i] = "EN"
        elif kind == "CS" and before == after and before in ("EN", "AN"):
            out[i] = before
    i = 0
    while i < len(out):
        if out[i] != "ET":
            i += 1
            continue
        j = i
        while j < len(out) and out[j] == "ET":
            j += 1
        touches_en = (i > 0 and out[i - 1] == "EN") or (j < len(out) and out[j] == "EN")
        if touches_en:
            out[i:j] = ["EN"] * (j - i)
        i = j
    out = ["ON" if kind in ("ES", "ET", "CS") else kind for kind in out]
    strong = sos
    for i, kind in enumerate(out):
        if kind in ("L", "R"):
            strong = kind
        elif kind == "EN" and strong == "L":
            out[i] = "L"
    return out


def _strong_of(kind: str) -> str | None:
    """N0 and N1 treat European and Arabic numbers as R."""
    if kind == "L":
        return "L"
    if kind in ("R", "EN", "AN"):
        return "R"
    return None


def _bracket_pairs(cps: list[int], types: list[str]) -> list[tuple[int, int]]:
    """BD16: matched (opening, closing) positions, sorted by opening."""
    table = brackets()
    stack: list[tuple[int, int]] = []
    pairs: list[tuple[int, int]] = []
    for i, cp in enumerate(cps):
        if types[i] != "ON" or cp not in table:
            continue
        pair, kind = table[cp]
        if kind == "o":
            if len(stack) == _MAX_BRACKET_DEPTH:
                break
            stack.append((_canonical(pair), i))
            continue
        closing = _canonical(cp)
        for depth in range(len(stack) - 1, -1, -1):
            if stack[depth][0] == closing:
                pairs.append((stack[depth][1], i))
                del stack[depth:]
                break
    return sorted(pairs)


def _resolve_brackets(
    cps: list[int], types: list[str], original: list[str], base: str
) -> list[str]:
    out = list(types)
    for open_i, close_i in _bracket_pairs(cps, types):
        inside = {_strong_of(kind) for kind in out[open_i + 1 : close_i]} - {None}
        if not inside:
            continue
        if base in inside:
            direction = base
        else:
            before = next(
                (
                    strong
                    for kind in reversed(out[:open_i])
                    if (strong := _strong_of(kind)) is not None
                ),
                base,
            )
            direction = before
        for i in (open_i, close_i):
            out[i] = direction
            j = i + 1
            while j < len(out) and original[j] == "NSM":
                out[j] = direction
                j += 1
    return out


def _resolve_neutrals(types: list[str], base: str) -> list[str]:
    out = list(types)
    i = 0
    while i < len(out):
        if out[i] not in _NEUTRAL:
            i += 1
            continue
        j = i
        while j < len(out) and out[j] in _NEUTRAL:
            j += 1
        before = _strong_of(out[i - 1]) if i > 0 else base
        after = _strong_of(out[j]) if j < len(out) else base
        fill = before if before == after and before is not None else base
        out[i:j] = [fill] * (j - i)
        i = j
    return out


def levels(text: str, base_level: int | None = None) -> list[int]:
    """Resolved embedding level of each character of one line. Characters
    X9 removes (class BN) take the level of the character before them.
    """
    raw = [unicodedata.bidirectional(ch) or "L" for ch in text]
    explicit = sorted({kind for kind in raw if kind in _EXPLICIT})
    if explicit:
        raise BidiError(f"explicit bidi controls are not supported: {explicit}")
    base = paragraph_level(text) if base_level is None else base_level
    base_type = "R" if base % 2 else "L"

    kept = [i for i, kind in enumerate(raw) if kind != "BN"]
    original = [raw[i] for i in kept]
    cps = [ord(text[i]) for i in kept]
    types = _resolve_weak(original, base_type)
    types = _resolve_brackets(cps, types, original, base_type)
    types = _resolve_neutrals(types, base_type)

    resolved = []
    for kind in types:
        if base % 2 == 0:
            resolved.append(base + {"R": 1, "AN": 2, "EN": 2}.get(kind, 0))
        else:
            resolved.append(base + (1 if kind in ("L", "EN", "AN") else 0))
    # L1: separators, and whitespace before them or at the line end.
    trailing = True
    for k in range(len(kept) - 1, -1, -1):
        kind = original[k]
        if kind in ("S", "B"):
            resolved[k] = base
            trailing = True
        elif kind == "WS" and trailing:
            resolved[k] = base
        else:
            trailing = False

    result = [base] * len(text)
    level_at = dict(zip(kept, resolved, strict=True))
    current = base
    for i in range(len(text)):
        current = level_at.get(i, current)
        result[i] = current
    return result


def split_runs(text: str, keys: list[object] | None = None) -> list[Run]:
    """Logical-order runs of equal level (and equal `keys`, when given)."""
    lv = levels(text)
    runs: list[Run] = []
    start = 0
    for i in range(1, len(text) + 1):
        if i == len(text) or lv[i] != lv[start] or (keys and keys[i] != keys[start]):
            runs.append(Run(start, i, lv[start]))
            start = i
    return runs


def visual_order(runs: list[Run]) -> list[Run]:
    """Rule L2: reverses every maximal sequence of runs at or above each odd level."""
    if not runs:
        return []
    order = list(runs)
    highest = max(run.level for run in order)
    lowest_odd = min((run.level for run in order if run.rtl), default=highest + 1)
    for level in range(highest, lowest_odd - 1, -1):
        i = 0
        while i < len(order):
            if order[i].level < level:
                i += 1
                continue
            j = i
            while j < len(order) and order[j].level >= level:
                j += 1
            order[i:j] = order[i:j][::-1]
            i = j
    return order
