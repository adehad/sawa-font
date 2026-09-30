"""Name, fvar-instance, STAT and OS/2 identity for the built Sawa families."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import TYPE_CHECKING

from fontTools.otlLib.builder import buildStatTable
from fontTools.ttLib.tables._f_v_a_r import NamedInstance

from sawa_tools.build.merge import table

if TYPE_CHECKING:
    from collections.abc import Iterable

    from fontTools.ttLib import TTFont

    from sawa_tools.build.merge import WghtRange

WINDOWS_ENGLISH = (3, 1, 0x409)

OFL_DESCRIPTION = (
    "This Font Software is licensed under the SIL Open Font License, Version 1.1. "
    "This license is available with a FAQ at: https://openfontlicense.org"
)
OFL_URL = "https://openfontlicense.org"

WEIGHT_NAMES = {
    100: "Thin",
    200: "ExtraLight",
    300: "Light",
    400: "Regular",
    500: "Medium",
    600: "SemiBold",
    700: "Bold",
    800: "ExtraBold",
    900: "Black",
}

# Name IDs that carry the family name: family, subfamily, unique ID, full,
# PostScript, typographic family/subfamily, variations PostScript prefix.
FAMILY_NAME_IDS = (1, 2, 3, 4, 6, 16, 17, 21, 22, 25)

_TRADEMARK_ID = 7
_REGULAR_SUBFAMILY_ID = 2
_ELIDABLE = 0x2

_ATTRIBUTED_RE = re.compile(r"^(?P<holder>.+?) \((?P<source>[^()]+)\)\.?$")


@dataclass(frozen=True)
class Release:
    version: str
    vendor: str
    copyright: str


def ps_name(family: str) -> str:
    return family.replace(" ", "")


def named_weights(minimum: float, maximum: float) -> list[int]:
    return [w for w in WEIGHT_NAMES if minimum <= w <= maximum]


def merge_copyrights(lines: Iterable[str]) -> list[str]:
    """Collapses notices from the same holder into one, listing each source.

    "Copyright X (a)" and "Copyright X (b)" become "Copyright X (a, b)".
    """
    merged: dict[str, list[str]] = {}
    for line in lines:
        match = _ATTRIBUTED_RE.match(line.strip())
        holder, source = (
            (match["holder"], match["source"]) if match else (line.strip(), None)
        )
        sources = merged.setdefault(holder, [])
        if source is not None and source not in sources:
            sources.append(source)
    return [
        f"{holder} ({', '.join(sources)})" if sources else holder
        for holder, sources in merged.items()
    ]


def merged_names(
    family: str, *, release: Release, copyrights: Iterable[str], derived_from: str
) -> dict[int, str]:
    """The Windows English name records for a merged family's default instance."""
    ps = ps_name(family)
    return {
        0: f"{'; '.join(merge_copyrights(copyrights))}. {release.copyright}",
        1: family,
        2: "Regular",
        3: f"{release.version};{release.vendor};{ps}-Regular",
        4: f"{family} Regular",
        5: f"Version {release.version}; derived from {derived_from}",
        6: f"{ps}-Regular",
        13: OFL_DESCRIPTION,
        14: OFL_URL,
        16: family,
        17: "Regular",
        25: ps,
    }


def rename_text(text: str, old_family: str, new_family: str) -> str:
    """Replaces a family name in both its spaced and PostScript spellings."""
    return text.replace(old_family, new_family).replace(
        ps_name(old_family), ps_name(new_family)
    )


def reserved_name_hits(
    names: Iterable[tuple[int, str]], reserved: Iterable[str]
) -> list[str]:
    """Lists every (name ID, text) whose text contains a reserved word."""
    words = list(reserved)
    return [
        f"name ID {name_id}: {text!r}"
        for name_id, text in names
        if any(word.lower() in text.lower() for word in words)
    ]


def family_name_records(font: TTFont) -> list[tuple[int, str]]:
    """Every name record that names the family or one of its instances."""
    name_ids = set(FAMILY_NAME_IDS)
    if "fvar" in font:
        for inst in font["fvar"].instances:
            name_ids.add(inst.subfamilyNameID)
            name_ids.add(inst.postscriptNameID)
    return [
        (record.nameID, record.toUnicode())
        for record in font["name"].names
        if record.nameID in name_ids
    ]


def _set_release(font: TTFont, release: Release) -> None:
    table(font, "OS/2").achVendID = release.vendor
    table(font, "head").fontRevision = float(release.version)


def finalize_merged(
    font: TTFont,
    family: str,
    wght: WghtRange,
    *,
    release: Release,
    copyrights: Iterable[str],
    derived_from: str,
) -> None:
    """Rewrites the name table, fvar instances, STAT and OS/2 of a merged font."""
    name = font["name"]
    name.names = []
    for name_id, text in merged_names(
        family, release=release, copyrights=copyrights, derived_from=derived_from
    ).items():
        name.setName(text, name_id, *WINDOWS_ENGLISH)

    font["fvar"].axes[0].axisNameID = name.addName(
        "Weight", platforms=(WINDOWS_ENGLISH,)
    )
    set_named_weights(font, family, wght)
    _set_release(font, release)
    os2 = table(font, "OS/2")
    os2.usWeightClass = int(wght.default)
    # REGULAR and USE_TYPO_METRICS on; ITALIC, BOLD and OBLIQUE off.
    os2.fsSelection = (os2.fsSelection & ~0b1000100001) | (1 << 6) | (1 << 7)
    table(font, "head").macStyle = 0
    os2.recalcUnicodeRanges(font)
    os2.recalcCodePageRanges(font)


def set_named_weights(font: TTFont, family: str, wght: WghtRange) -> None:
    """Rewrites the fvar instances and STAT: one named weight per hundred
    in `wght`, Regular elidable and linked to Bold.
    """
    name = font["name"]
    platforms = (WINDOWS_ENGLISH,)
    fvar = font["fvar"]
    weights = named_weights(wght.minimum, wght.maximum)
    fvar.instances = []
    for weight in weights:
        inst = NamedInstance()
        inst.coordinates = {"wght": float(weight)}
        inst.subfamilyNameID = (
            _REGULAR_SUBFAMILY_ID
            if weight == 400
            else name.addName(WEIGHT_NAMES[weight], platforms=platforms)
        )
        inst.postscriptNameID = name.addName(
            f"{ps_name(family)}-{WEIGHT_NAMES[weight]}", platforms=platforms
        )
        fvar.instances.append(inst)

    values: list[dict[str, object]] = []
    for weight in weights:
        value: dict[str, object] = {"value": weight, "name": WEIGHT_NAMES[weight]}
        if weight == 400:
            value["flags"] = _ELIDABLE
            if 700 in weights:
                value["linkedValue"] = 700
        values.append(value)
    buildStatTable(
        font,
        [{"tag": "wght", "name": "Weight", "values": values}],
        elidedFallbackName=_REGULAR_SUBFAMILY_ID,
        windowsNames=True,
        macNames=False,
    )


def rename_family(
    font: TTFont,
    *,
    old_family: str,
    new_family: str,
    release: Release,
    notice: str,
    derived_from: str,
    borrowed_copyrights: Iterable[str] = (),
) -> None:
    """Renames a single-source family, keeping its fvar instances and STAT.

    `borrowed_copyrights` are the notices of fonts it took glyphs from.
    """
    name = font["name"]
    for record in list(name.names):
        if record.nameID in FAMILY_NAME_IDS:
            record.string = rename_text(record.toUnicode(), old_family, new_family)
    copyrights = [r.toUnicode() for r in name.names if r.nameID == 0][:1]
    copyrights += [f"{line}." for line in merge_copyrights(borrowed_copyrights)]
    name.removeNames(nameID=0)
    # The upstream trademark notice names the upstream family, which this
    # font no longer carries.
    name.removeNames(nameID=_TRADEMARK_ID)
    ps = ps_name(new_family)
    for name_id, text in {
        0: " ".join([*copyrights, notice, release.copyright]),
        3: f"{release.version};{release.vendor};{ps}-Regular",
        5: f"Version {release.version}; derived from {derived_from}",
        13: OFL_DESCRIPTION,
        14: OFL_URL,
    }.items():
        name.removeNames(nameID=name_id)
        name.setName(text, name_id, *WINDOWS_ENGLISH)
    _set_release(font, release)
