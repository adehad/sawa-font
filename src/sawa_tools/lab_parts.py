"""Splits the Arabic letters of a font into the parts Sawa Lab lets the
owner move: each letter form's body and its dot groups.

A dot group is either a glyph of its own, which is how Noto Sans Arabic
draws dots once `ccmp` has decomposed a letter into a dotless body and a
dot mark, or part of the body glyph: a component named like a dot, or a
small outer contour of a simple glyph.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from fontTools.pens.basePen import BasePen
from fontTools.pens.transformPen import TransformPen

if TYPE_CHECKING:
    from collections.abc import Callable, Iterable

    from fontTools.ttLib import TTFont

Box = tuple[float, float, float, float]
Point = tuple[float, float]

# A dot is a contour smaller than this, in em, on both axes.
DOT_SIZE = 0.2
# Dots closer than this, in em, belong to one group.
GROUP_GAP = 0.12
# How far beside a dot, in em, the body's ink still counts as over or under it.
SIDE_MARGIN = 0.05

POSITION_HINTS = (("below", "below"), ("above", "above"), ("center", "inside"))


@dataclass(frozen=True)
class Part:
    """One movable part of a glyph or letter form.

    `id` is what overrides name the part by: "body", a dot glyph's name, or
    "component:N" / "contours:A,B" for a dot drawn inside the body glyph.
    """

    id: str
    kind: str  # "body", "dots" or "mark"
    glyph: str
    position: str | None = None  # "above", "below" or "inside"
    count: int = 0
    contours: tuple[int, ...] = ()
    component: int | None = None

    @property
    def label(self) -> str:
        if self.kind == "body":
            return "body"
        if self.kind == "dots":
            dots = f"{self.count} dot{'s' if self.count != 1 else ''}"
            return f"{dots} {self.position}" if self.position else dots
        return f"{self.glyph} {self.position}" if self.position else self.glyph

    def to_json(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "id": self.id,
            "kind": self.kind,
            "glyph": self.glyph,
            "label": self.label,
        }
        if self.position:
            out["position"] = self.position
        if self.kind == "dots":
            out["count"] = self.count
        if self.contours:
            out["contours"] = list(self.contours)
        if self.component is not None:
            out["component"] = self.component
        return out


class SvgPen(BasePen):
    """Absolute M, L, Q, C and Z commands, the subset the lab parses."""

    def __init__(self, glyph_set: Any) -> None:
        super().__init__(glyph_set)
        self.commands: list[str] = []

    @staticmethod
    def _n(value: float) -> str:
        rounded = round(value, 1)
        return str(int(rounded)) if rounded == int(rounded) else str(rounded)

    def _points(self, *points: Point) -> str:
        return " ".join(f"{self._n(x)} {self._n(y)}" for x, y in points)

    def _moveTo(self, pt: Point) -> None:
        self.commands.append(f"M{self._points(pt)}")

    def _lineTo(self, pt: Point) -> None:
        self.commands.append(f"L{self._points(pt)}")

    def _qCurveToOne(self, pt1: Point, pt2: Point) -> None:
        self.commands.append(f"Q{self._points(pt1, pt2)}")

    def _curveToOne(self, pt1: Point, pt2: Point, pt3: Point) -> None:
        self.commands.append(f"C{self._points(pt1, pt2, pt3)}")

    def _closePath(self) -> None:
        self.commands.append("Z")

    def _endPath(self) -> None:
        self.commands.append("Z")

    @property
    def d(self) -> str:
        return "".join(self.commands)


def _contours(font: TTFont, name: str) -> list[list[Point]]:
    """A glyph's contours, components decomposed, as point lists with the
    off-curve points included, which is close enough for areas, boxes and
    containment.
    """
    glyf: Any = font["glyf"]
    glyph = glyf[name]
    if not glyph.isComposite() and glyph.numberOfContours <= 0:
        return []
    coords, ends, _flags = glyph.getCoordinates(glyf)
    out, start = [], 0
    for end in ends:
        out.append([(float(x), float(y)) for x, y in coords[start : end + 1]])
        start = end + 1
    return out


def _box(points: Iterable[Point]) -> Box:
    xs, ys = zip(*points, strict=True)
    return min(xs), min(ys), max(xs), max(ys)


def _union(a: Box | None, b: Box) -> Box:
    if a is None:
        return b
    return min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])


def _box_gap(a: Box, b: Box) -> float:
    dx = max(0.0, b[0] - a[2], a[0] - b[2])
    dy = max(0.0, b[1] - a[3], a[1] - b[3])
    return math.hypot(dx, dy)


def _overlaps(a: list[Point], b: list[Point]) -> bool:
    return any(_inside(point, b) for point in a) or any(
        _inside(point, a) for point in b
    )


def _signed_area(polygon: list[Point]) -> float:
    return sum(
        x0 * y1 - x1 * y0
        for (x0, y0), (x1, y1) in zip(polygon, polygon[1:] + polygon[:1], strict=True)
    )


def _inside(point: Point, polygon: list[Point]) -> bool:
    """Even-odd containment of `point` in one closed polygon."""
    x, y = point
    hit = False
    for i, (x0, y0) in enumerate(polygon):
        x1, y1 = polygon[i - 1]
        if (y0 > y) != (y1 > y) and x < (x1 - x0) * (y - y0) / (y1 - y0) + x0:
            hit = not hit
    return hit


def position(dot: Box, body: list[list[Point]], upm: int) -> str:
    """Where a dot group sits against the body: "above" when the body's ink
    beside it lies only below it, "below" for the reverse, else "inside".
    """
    margin = SIDE_MARGIN * upm
    near = [
        (x, y)
        for contour in body
        for x, y in contour
        if dot[0] - margin <= x <= dot[2] + margin
    ]
    if not near:
        ys = [y for contour in body for _, y in contour]
        middle = (min(ys) + max(ys)) / 2 if ys else 0
        return "above" if (dot[1] + dot[3]) / 2 > middle else "below"
    over = any(y > dot[3] for _, y in near)
    under = any(y < dot[1] for _, y in near)
    if under and not over:
        return "above"
    if over and not under:
        return "below"
    return "inside"


def _hinted(name: str) -> str | None:
    lower = name.lower()
    for hint, where in POSITION_HINTS:
        if hint in lower:
            return where
    return None


def _is_dot_name(name: str) -> bool:
    return "dot" in name.lower() and "dotless" not in name.lower()


def _groups(boxes: list[Box], gap: float) -> list[list[int]]:
    """Indices of `boxes` grouped by chains of neighbours closer than `gap`."""
    parent = list(range(len(boxes)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i in range(len(boxes)):
        for j in range(i + 1, len(boxes)):
            if _box_gap(boxes[i], boxes[j]) < gap:
                parent[find(i)] = find(j)
    groups: dict[int, list[int]] = {}
    for i in range(len(boxes)):
        groups.setdefault(find(i), []).append(i)
    return sorted(groups.values(), key=lambda g: g[0])


def dot_contours(contours: list[list[Point]], upm: int) -> list[int]:
    """The contours of a simple glyph that are dots: small, wound the same
    way as the largest contour, and outside every other contour. The last
    two tell a dot from a counter, and a dot never overlaps the body the
    way a joining stroke drawn as its own contour does.
    """
    if not contours:
        return []
    limit = DOT_SIZE * upm
    outer = max(contours, key=lambda c: abs(_signed_area(c)))
    direction = _signed_area(outer) > 0
    found = []
    for i, contour in enumerate(contours):
        x0, y0, x1, y1 = _box(contour)
        if x1 - x0 > limit or y1 - y0 > limit:
            continue
        if (_signed_area(contour) > 0) != direction:
            continue
        others = [c for j, c in enumerate(contours) if j != i]
        if any(_overlaps(contour, other) for other in others):
            continue
        found.append(i)
    return found if len(found) < len(contours) else []


def glyph_parts(font: TTFont, name: str) -> list[Part]:
    """A glyph's body and the dot groups drawn inside it."""
    upm = font["head"].unitsPerEm  # ty: ignore[unresolved-attribute]
    glyf: Any = font["glyf"]
    glyph = glyf[name]
    parts: list[Part] = []
    if glyph.isComposite():
        components = glyph.components
        dots = [i for i, c in enumerate(components) if _is_dot_name(c.glyphName)]
        if dots and len(dots) < len(components):
            body_contours = [
                contour
                for i, c in enumerate(components)
                if i not in dots
                for contour in _shifted(font, c)
            ]
            for i in dots:
                component = components[i]
                shape = _shifted(font, component)
                box = _box(p for contour in shape for p in contour)
                parts.append(
                    Part(
                        id=f"component:{i}",
                        kind="dots",
                        glyph=name,
                        position=_hinted(component.glyphName)
                        or position(box, body_contours, upm),
                        count=_count(font, component.glyphName),
                        component=i,
                    )
                )
    else:
        contours = _contours(font, name)
        dots = dot_contours(contours, upm)
        if dots:
            body_contours = [c for i, c in enumerate(contours) if i not in dots]
            boxes = [_box(contours[i]) for i in dots]
            for group in _groups(boxes, GROUP_GAP * upm):
                indices = tuple(dots[i] for i in group)
                box = None
                for i in group:
                    box = _union(box, boxes[i])
                assert box is not None
                parts.append(
                    Part(
                        id="contours:" + ",".join(str(i) for i in indices),
                        kind="dots",
                        glyph=name,
                        position=position(box, body_contours, upm),
                        count=len(indices),
                        contours=indices,
                    )
                )
    return [Part(id="body", kind="body", glyph=name), *parts]


def _shifted(font: TTFont, component: Any) -> list[list[Point]]:
    dx, dy = component.x, component.y
    return [
        [(x + dx, y + dy) for x, y in contour]
        for contour in _contours(font, component.glyphName)
    ]


def _count(font: TTFont, name: str) -> int:
    """The dots in a dot glyph: its outer contours."""
    contours = _contours(font, name)
    if not contours:
        return 0
    return sum(
        1
        for i, contour in enumerate(contours)
        if not any(_inside(contour[0], c) for j, c in enumerate(contours) if j != i)
    )


def glyph_class(font: TTFont, name: str) -> str:
    gdef: Any = font["GDEF"].table if "GDEF" in font else None
    classes = gdef.GlyphClassDef.classDefs if gdef and gdef.GlyphClassDef else {}
    return {1: "base", 2: "ligature", 3: "mark", 4: "component"}.get(
        classes.get(name, 0), "unclassified"
    )


def letter_form_parts(
    font: TTFont,
    shaped: list[list[int]],
    *,
    glyph_name: Callable[[int], str],
) -> dict[str, Any]:
    """The parts of one letter form, from HarfBuzz's output for the bare
    letter: the body glyph, then each glyph `ccmp` split off it and each dot
    group inside the body.
    """
    upm = font["head"].unitsPerEm  # ty: ignore[unresolved-attribute]
    glyf: Any = font["glyf"]
    names = [glyph_name(g[0]) for g in reversed(shaped)]
    offsets: dict[str, tuple[int, int]] = {}
    pen = 0
    for gid, _cluster, advance, x_offset, y_offset in shaped:
        offsets.setdefault(glyph_name(gid), (pen + x_offset, y_offset))
        pen += advance
    inked = [n for n in names if _has_ink(glyf, n)]
    body = next((n for n in inked if glyph_class(font, n) != "mark"), None)
    if body is None:
        return {"glyphs": inked, "body": None, "parts": []}
    parts = glyph_parts(font, body)
    body_ink = _contours(font, body)
    bx, by = offsets[body]
    body_ink = [[(x + bx, y + by) for x, y in contour] for contour in body_ink]
    for name in inked:
        if name == body:
            continue
        dx, dy = offsets[name]
        shape = [[(x + dx, y + dy) for x, y in c] for c in _contours(font, name)]
        box = _box(p for contour in shape for p in contour)
        dots = _is_dot_name(name)
        parts.append(
            Part(
                id=name,
                kind="dots" if dots else "mark",
                glyph=name,
                position=_hinted(name) or position(box, body_ink, upm),
                count=_count(font, name) if dots else 0,
            )
        )
    return {
        "glyphs": inked,
        "body": body,
        "parts": [p.to_json() for p in parts],
    }


def _has_ink(glyf: Any, name: str) -> bool:
    glyph = glyf[name]
    return glyph.isComposite() or glyph.numberOfContours > 0


def part_path(font: TTFont, part: Part) -> str:
    """The SVG path of one part in font units, components decomposed."""
    glyph_set = font.getGlyphSet()
    pen = SvgPen(glyph_set)
    glyf: Any = font["glyf"]
    glyph = glyf[part.glyph]
    siblings = glyph_parts(font, part.glyph)
    if part.kind != "body" and part.component is not None:
        component = glyph.components[part.component]
        glyph_set[component.glyphName].draw(
            TransformPen(pen, (1, 0, 0, 1, component.x, component.y))
        )
    elif part.contours:
        _draw_contours(font, part.glyph, set(part.contours), pen)
    elif part.kind == "body" and glyph.isComposite():
        taken = {p.component for p in siblings if p.component is not None}
        for i, component in enumerate(glyph.components):
            if i in taken:
                continue
            glyph_set[component.glyphName].draw(
                TransformPen(pen, (1, 0, 0, 1, component.x, component.y))
            )
    elif part.kind == "body":
        taken_contours = {i for p in siblings for i in p.contours}
        keep = set(range(len(_contours(font, part.glyph)))) - taken_contours
        _draw_contours(font, part.glyph, keep, pen)
    else:
        glyph_set[part.glyph].draw(pen)
    return pen.d


def _draw_contours(font: TTFont, name: str, keep: set[int], pen: Any) -> None:
    from fontTools.pens.recordingPen import RecordingPen

    recording = RecordingPen()
    font.getGlyphSet()[name].draw(recording)
    index = 0
    for operator, operands in recording.value:
        if index in keep:
            getattr(pen, operator)(*operands)
        if operator in ("closePath", "endPath"):
            index += 1


def anchors(font: TTFont) -> dict[str, list[dict[str, Any]]]:
    """Every glyph's GPOS attachment anchors, by glyph name: where marks
    attach to it as a base or ligature, and where it attaches as a mark.
    """
    if "GPOS" not in font:
        return {}
    gpos: Any = font["GPOS"].table
    features: dict[int, str] = {}
    for record in gpos.FeatureList.FeatureRecord:
        for index in record.Feature.LookupListIndex:
            features.setdefault(index, record.FeatureTag)
    found: dict[str, dict[tuple[str, int, int], dict[str, Any]]] = {}

    def add(name: str, kind: str, anchor: Any, lookup: int) -> None:
        if anchor is None:
            return
        x, y = anchor.XCoordinate, anchor.YCoordinate
        entry = found.setdefault(name, {}).setdefault(
            (kind, x, y), {"kind": kind, "x": x, "y": y, "lookups": []}
        )
        tag = features.get(lookup, "")
        label = f"{tag} {lookup}".strip()
        if label not in entry["lookups"]:
            entry["lookups"].append(label)

    for index, lookup in enumerate(gpos.LookupList.Lookup):
        for subtable in lookup.SubTable:
            kind = lookup.LookupType
            if kind == 9:
                kind = subtable.ExtensionLookupType
                subtable = subtable.ExtSubTable
            if kind == 4:
                for name, record in zip(
                    subtable.MarkCoverage.glyphs,
                    subtable.MarkArray.MarkRecord,
                    strict=True,
                ):
                    add(name, "mark", record.MarkAnchor, index)
                for name, record in zip(
                    subtable.BaseCoverage.glyphs,
                    subtable.BaseArray.BaseRecord,
                    strict=True,
                ):
                    for anchor in record.BaseAnchor:
                        add(name, "base", anchor, index)
            elif kind == 5:
                for name, record in zip(
                    subtable.MarkCoverage.glyphs,
                    subtable.MarkArray.MarkRecord,
                    strict=True,
                ):
                    add(name, "mark", record.MarkAnchor, index)
                for name, attach in zip(
                    subtable.LigatureCoverage.glyphs,
                    subtable.LigatureArray.LigatureAttach,
                    strict=True,
                ):
                    for component in attach.ComponentRecord:
                        for anchor in component.LigatureAnchor:
                            add(name, "ligature", anchor, index)
            elif kind == 6:
                for name, record in zip(
                    subtable.Mark1Coverage.glyphs,
                    subtable.Mark1Array.MarkRecord,
                    strict=True,
                ):
                    add(name, "mark", record.MarkAnchor, index)
                for name, record in zip(
                    subtable.Mark2Coverage.glyphs,
                    subtable.Mark2Array.Mark2Record,
                    strict=True,
                ):
                    for anchor in record.Mark2Anchor:
                        add(name, "mark2", anchor, index)
    return {name: list(entries.values()) for name, entries in found.items()}


def glyph_entry(
    font: TTFont, name: str, all_anchors: dict[str, list[dict[str, Any]]]
) -> dict[str, Any]:
    """What lab.json holds for one glyph: its advance, GDEF class, parts
    with their outlines, and anchors.
    """
    hmtx: Any = font["hmtx"]
    return {
        "advance": hmtx[name][0],
        "class": glyph_class(font, name),
        "parts": [
            p.to_json() | {"d": part_path(font, p)} for p in glyph_parts(font, name)
        ],
        "anchors": all_anchors.get(name, []),
    }
