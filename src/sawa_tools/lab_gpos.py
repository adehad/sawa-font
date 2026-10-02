"""The mark positioning of a font as Sawa Lab shows it: every mark class of
the Arabic mark-to-base, mark-to-ligature and mark-to-mark lookups, each
glyph's anchors per class, and for a shaped run which lookup put each mark
where it is.

A class is named by its lookup and its index in that lookup's subtable,
"27.0", and labelled by where its marks sit: "top", "bottom" or "center".
HarfBuzz does not report which lookup attached a mark, so `attachments`
works it out from the result: a mark attached through an anchor pair lands
exactly where the two anchors meet, and the last lookup that can explain
the position is the one that set it.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from fontTools.ttLib import TTFont

MARK_TYPES = {4: "base", 5: "ligature", 6: "mark"}
POSITION_HINTS = (("above", "top"), ("below", "bottom"), ("center", "center"))


@dataclass(frozen=True)
class Anchor:
    lookup: int
    cls: int
    x: int
    y: int
    component: int | None = None

    def to_json(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "lookup": self.lookup,
            "class": f"{self.lookup}.{self.cls}",
            "x": self.x,
            "y": self.y,
        }
        if self.component is not None:
            out["component"] = self.component
        return out


@dataclass
class GlyphAnchors:
    """`attach`: where marks attach to the glyph as a base, ligature or
    first mark. `mark`: the glyph's own anchor in each lookup that attaches
    it, by kind of lookup.
    """

    base: list[Anchor]
    ligature: list[Anchor]
    mark2: list[Anchor]
    mark: list[Anchor]

    def to_json(self) -> dict[str, Any]:
        return {
            key: [a.to_json() for a in value]
            for key, value in (
                ("base", self.base),
                ("ligature", self.ligature),
                ("mark2", self.mark2),
                ("mark", self.mark),
            )
            if value
        }


def _subtables(table: Any) -> list[tuple[int, int, Any]]:
    out = []
    for index, lookup in enumerate(table.LookupList.Lookup):
        for subtable in lookup.SubTable:
            kind = lookup.LookupType
            if kind == 9:
                kind = subtable.ExtensionLookupType
                subtable = subtable.ExtSubTable
            out.append((index, kind, subtable))
    return out


def _features(table: Any) -> dict[int, str]:
    found: dict[int, str] = {}
    for record in table.FeatureList.FeatureRecord:
        for index in record.Feature.LookupListIndex:
            found.setdefault(index, record.FeatureTag)
    return found


def _mark_records(kind: int, subtable: Any) -> list[tuple[str, Any]]:
    if kind == 6:
        return list(
            zip(
                subtable.Mark1Coverage.glyphs,
                subtable.Mark1Array.MarkRecord,
                strict=True,
            )
        )
    return list(
        zip(subtable.MarkCoverage.glyphs, subtable.MarkArray.MarkRecord, strict=True)
    )


def _position(names: list[str], ys: list[int]) -> str:
    votes = Counter(
        where
        for name in names
        for hint, where in POSITION_HINTS
        if hint in name.lower() and "dotless" not in name.lower()
    )
    if votes:
        return votes.most_common(1)[0][0]
    if not ys:
        return "center"
    ys = sorted(ys)
    middle = ys[len(ys) // 2]
    return "top" if middle > 250 else "bottom" if middle < 0 else "center"


def lookups(font: TTFont) -> list[dict[str, Any]]:
    """Every mark-attachment lookup in GPOS, with its classes: their id,
    name, label and marks.
    """
    if "GPOS" not in font:
        return []
    gpos: Any = font["GPOS"].table
    features = _features(gpos)
    by_lookup: dict[int, dict[str, Any]] = {}
    for index, kind, subtable in _subtables(gpos):
        if kind not in MARK_TYPES:
            continue
        lookup = gpos.LookupList.Lookup[index]
        entry = by_lookup.setdefault(
            index,
            {
                "index": index,
                "type": MARK_TYPES[kind],
                "feature": features.get(index, ""),
                "flag": lookup.LookupFlag,
                "classes": {},
            },
        )
        if lookup.LookupFlag & 0x10:
            entry["markFilteringSet"] = lookup.MarkFilteringSet
        for name, record in _mark_records(kind, subtable):
            cls = entry["classes"].setdefault(record.Class, {"marks": [], "ys": []})
            if name not in cls["marks"]:
                cls["marks"].append(name)
        ys = _attach_ys(kind, subtable)
        for cls, values in ys.items():
            entry["classes"].setdefault(cls, {"marks": [], "ys": []})["ys"] += values
    out = []
    taken: Counter[str] = Counter()
    for index in sorted(by_lookup):
        entry = by_lookup[index]
        classes = []
        for cls in sorted(entry["classes"]):
            data = entry["classes"][cls]
            where = _position(data["marks"], data["ys"])
            prefix = "mkmk_" if entry["type"] == "mark" else ""
            name = f"{prefix}{where}_{index}" + (f"_{cls}" if cls else "")
            taken[where] += 1
            classes.append(
                {
                    "id": f"{index}.{cls}",
                    "name": name,
                    "position": where,
                    "label": f"{where} marks, lookup {index}"
                    + (f" class {cls}" if cls else ""),
                    "marks": sorted(data["marks"]),
                }
            )
        out.append(
            {k: v for k, v in entry.items() if k != "classes"} | {"classes": classes}
        )
    return out


def _attach_ys(kind: int, subtable: Any) -> dict[int, list[int]]:
    """The y of every attachment anchor per class, for naming the class."""
    out: dict[int, list[int]] = {}

    def add(anchors: list[Any]) -> None:
        for cls, anchor in enumerate(anchors):
            if anchor is not None:
                out.setdefault(cls, []).append(anchor.YCoordinate)

    if kind == 4:
        for record in subtable.BaseArray.BaseRecord:
            add(record.BaseAnchor)
    elif kind == 5:
        for attach in subtable.LigatureArray.LigatureAttach:
            for component in attach.ComponentRecord:
                add(component.LigatureAnchor)
    elif kind == 6:
        for record in subtable.Mark2Array.Mark2Record:
            add(record.Mark2Anchor)
    return out


def anchors(font: TTFont) -> dict[str, GlyphAnchors]:
    """Every glyph's anchors in the mark-attachment lookups, by glyph name."""
    if "GPOS" not in font:
        return {}
    found: dict[str, GlyphAnchors] = {}

    def entry(name: str) -> GlyphAnchors:
        return found.setdefault(name, GlyphAnchors([], [], [], []))

    for index, kind, subtable in _subtables(font["GPOS"].table):
        if kind not in MARK_TYPES:
            continue
        for name, record in _mark_records(kind, subtable):
            anchor = record.MarkAnchor
            entry(name).mark.append(
                Anchor(index, record.Class, anchor.XCoordinate, anchor.YCoordinate)
            )
        if kind == 4:
            for name, record in zip(
                subtable.BaseCoverage.glyphs, subtable.BaseArray.BaseRecord, strict=True
            ):
                for cls, anchor in enumerate(record.BaseAnchor):
                    if anchor is not None:
                        entry(name).base.append(
                            Anchor(index, cls, anchor.XCoordinate, anchor.YCoordinate)
                        )
        elif kind == 5:
            for name, attach in zip(
                subtable.LigatureCoverage.glyphs,
                subtable.LigatureArray.LigatureAttach,
                strict=True,
            ):
                for component, record in enumerate(attach.ComponentRecord):
                    for cls, anchor in enumerate(record.LigatureAnchor):
                        if anchor is not None:
                            entry(name).ligature.append(
                                Anchor(
                                    index,
                                    cls,
                                    anchor.XCoordinate,
                                    anchor.YCoordinate,
                                    component,
                                )
                            )
        elif kind == 6:
            for name, record in zip(
                subtable.Mark2Coverage.glyphs,
                subtable.Mark2Array.Mark2Record,
                strict=True,
            ):
                for cls, anchor in enumerate(record.Mark2Anchor):
                    if anchor is not None:
                        entry(name).mark2.append(
                            Anchor(index, cls, anchor.XCoordinate, anchor.YCoordinate)
                        )
    return found


def attachments(
    shaped: list[list[int]],
    names: list[str],
    table: dict[str, GlyphAnchors],
    is_mark: set[str],
) -> list[dict[str, Any] | None]:
    """For each glyph of a right-to-left run as HarfBuzz returns it (visual
    order, [gid, cluster, advance, x offset, y offset]), what it is attached
    to: the index of the glyph it hangs on, the lookup and class, and the
    kind of attachment. None for a glyph that is not a mark or that no
    anchor pair explains.
    """
    pen = 0
    at: list[tuple[int, int]] = []
    for _gid, _cluster, advance, x_offset, y_offset in shaped:
        at.append((pen + x_offset, y_offset))
        pen += advance
    glyphs = [names[g[0]] for g in shaped]
    out: list[dict[str, Any] | None] = [None] * len(shaped)
    # Logical order runs from the right: the last glyph in visual order first.
    for j in range(len(shaped) - 1, -1, -1):
        name = glyphs[j]
        if name not in is_mark or name not in table:
            continue
        best: tuple[int, int, dict[str, Any]] | None = None
        for own in table[name].mark:
            for i in range(j + 1, len(shaped)):
                parent = table.get(glyphs[i])
                if parent is None:
                    continue
                for kind, pool in (
                    ("base", parent.base),
                    ("ligature", parent.ligature),
                    ("mark", parent.mark2),
                ):
                    for anchor in pool:
                        if anchor.lookup != own.lookup or anchor.cls != own.cls:
                            continue
                        if (
                            at[i][0] + anchor.x - own.x != at[j][0]
                            or at[i][1] + anchor.y - own.y != at[j][1]
                        ):
                            continue
                        rank = (own.lookup, -(i - j))
                        if best is None or rank > (best[0], best[1]):
                            found: dict[str, Any] = {
                                "parent": i,
                                "lookup": own.lookup,
                                "class": f"{own.lookup}.{own.cls}",
                                "kind": kind,
                            }
                            if anchor.component is not None:
                                found["component"] = anchor.component
                            best = (rank[0], rank[1], found)
        out[j] = best[2] if best else None
    return out
