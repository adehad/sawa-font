"""Builds the Sawa families described in data/sawa.json into fonts/.

A family is either `merge` (an Arabic and a Latin variable font merged under
one wght axis, see merge.py) or `rename` (one variable font renamed). Each
build writes a stamp next to its output; a later run whose inputs, config and
build code hash to the same stamp reuses the output.
"""

from __future__ import annotations

import hashlib
import io
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from collections.abc import Callable, Mapping

    from sawa_tools.build.merge import LineMetrics, WghtRange
    from sawa_tools.build.naming import Release

    ReadMember = Callable[[str, str | None], bytes]

DEFAULT_FAMILIES = Path("data/sawa.json")
DEFAULT_FONTS_DIR = Path("fonts")

_KINDS = {"merge": "shared", "rename": "source"}
_GENERICS = ("serif", "sans-serif", "monospace")
_CODE_MODULES = ("families.py", "merge.py", "naming.py")


class FamilyError(Exception):
    """Raised for a malformed family config or a build that breaks its config."""


@dataclass(frozen=True)
class Member:
    source: str
    path: str | None = None


@dataclass(frozen=True)
class Family:
    id: str
    name: str
    kind: str
    inputs: dict[str, Member]
    wght: WghtRange
    metrics: LineMetrics
    licence: list[Member]
    generic: str | None
    arabic_scale: float = 1.0
    pinned_axes: dict[str, float] = field(default_factory=dict)
    rename_from: str | None = None
    notice: str | None = None
    cell_width: int | None = None
    coverage_gaps: list[str] = field(default_factory=list)
    raw: dict[str, Any] = field(default_factory=dict)

    @property
    def ps_name(self) -> str:
        return self.name.replace(" ", "")

    @property
    def ttf_name(self) -> str:
        return f"{self.ps_name}[wght].ttf"

    @property
    def woff2_name(self) -> str:
        return f"{self.ps_name}.woff2"


@dataclass(frozen=True)
class FamilyConfig:
    release: Release
    reserved_names: list[str]
    families: list[Family]
    raw_release: dict[str, Any]


def _get(mapping: Any, key: str, context: str) -> Any:
    if not isinstance(mapping, dict) or key not in mapping:
        raise FamilyError(f"{context}: missing required key '{key}'")
    return mapping[key]


def _member(raw: Any, context: str) -> Member:
    return Member(_get(raw, "source", context), raw.get("path"))


def _parse_family(family_id: str, raw: Any) -> Family:
    from sawa_tools.build.merge import LineMetrics, WghtRange

    context = f"family '{family_id}'"
    kind = _get(raw, "kind", context)
    if kind not in _KINDS:
        raise FamilyError(f"{context}: 'kind' must be one of {sorted(_KINDS)}")
    metrics_raw = _get(raw, "metrics", context)
    policy = _get(metrics_raw, "policy", f"{context} metrics")
    if policy != _KINDS[kind]:
        raise FamilyError(
            f"{context}: a {kind} family's metrics policy must be '{_KINDS[kind]}'"
        )
    wght_raw = _get(raw, "wght", context)
    site = raw.get("site")
    generic = _get(site, "generic", f"{context} site") if site else None
    if generic is not None and generic not in _GENERICS:
        raise FamilyError(f"{context}: 'site.generic' must be one of {_GENERICS}")
    if kind == "merge":
        inputs = {
            role: _member(_get(raw, role, context), f"{context} {role}")
            for role in ("latin", "arabic")
        }
    else:
        inputs = {"input": _member(_get(raw, "input", context), f"{context} input")}
    return Family(
        id=family_id,
        name=_get(raw, "name", context),
        kind=kind,
        inputs=inputs,
        wght=WghtRange(
            float(_get(wght_raw, "min", context)),
            float(_get(wght_raw, "default", context)),
            float(_get(wght_raw, "max", context)),
        ),
        metrics=LineMetrics(
            ascender=_get(metrics_raw, "ascender", context),
            descender=_get(metrics_raw, "descender", context),
            line_gap=_get(metrics_raw, "lineGap", context),
            win_ascent=_get(metrics_raw, "winAscent", context),
            win_descent=_get(metrics_raw, "winDescent", context),
        ),
        licence=[
            _member(entry, f"{context} licence")
            for entry in _get(raw, "licence", context)
        ],
        generic=generic,
        arabic_scale=float(raw.get("arabicScale", 1.0)),
        pinned_axes={k: float(v) for k, v in raw.get("pinnedAxes", {}).items()},
        rename_from=_get(raw, "renameFrom", context) if kind == "rename" else None,
        notice=_get(raw, "notice", context) if kind == "rename" else None,
        cell_width=raw.get("cellWidth"),
        coverage_gaps=list(raw.get("coverageGaps", [])),
        raw=raw,
    )


def load_config(path: Path) -> FamilyConfig:
    from sawa_tools.build.naming import Release

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise FamilyError(f"cannot read {path}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise FamilyError(f"invalid JSON in {path}: {exc}") from exc
    release_raw = _get(data, "release", str(path))
    release = Release(
        version=_get(release_raw, "version", f"{path} release"),
        vendor=_get(release_raw, "vendor", f"{path} release"),
        copyright=_get(release_raw, "copyright", f"{path} release"),
    )
    families_raw = _get(data, "families", str(path))
    if not isinstance(families_raw, dict):
        raise FamilyError(f"{path}: 'families' must be an object")
    return FamilyConfig(
        release=release,
        reserved_names=list(data.get("reservedNames", [])),
        families=[_parse_family(fid, raw) for fid, raw in families_raw.items()],
        raw_release=release_raw,
    )


def code_version() -> str:
    """Hashes this build's own source and fontTools version into one string."""
    from fontTools import version as fonttools_version

    digest = hashlib.sha256(fonttools_version.encode())
    here = Path(__file__).parent
    for module in _CODE_MODULES:
        digest.update((here / module).read_bytes())
    return digest.hexdigest()


def stamp_digest(
    family_raw: Mapping[str, Any],
    release_raw: Mapping[str, Any],
    input_sha256s: Mapping[str, str],
    code: str,
) -> str:
    payload = {
        "family": family_raw,
        "release": release_raw,
        "inputs": dict(sorted(input_sha256s.items())),
        "code": code,
    }
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True).encode("utf-8")
    ).hexdigest()


def is_fresh(stamp_path: Path, digest: str, outputs: list[Path]) -> bool:
    if not stamp_path.exists() or not all(path.exists() for path in outputs):
        return False
    return stamp_path.read_text(encoding="utf-8").strip() == digest


@dataclass(frozen=True)
class BuiltFamily:
    family: Family
    ttf: Path
    woff2: Path | None
    rebuilt: bool


def _open(data: bytes) -> Any:
    from fontTools.ttLib import TTFont

    return TTFont(io.BytesIO(data), recalcTimestamp=False)


def _describe(
    sources: Mapping[str, Any], member: Member, name: str | None = None
) -> str:
    source = sources[member.source]
    label = name or source.get("name", member.source)
    return f"{label} {source.get('version', '')}".strip()


def _copyright(font: Any) -> str:
    return font["name"].getDebugName(0) or ""


def _build_merge(
    family: Family,
    release: Release,
    sources: Mapping[str, Any],
    read: ReadMember,
) -> Any:
    from sawa_tools.build.merge import axis_range, merge_family
    from sawa_tools.build.naming import finalize_merged

    latin_member, arabic_member = family.inputs["latin"], family.inputs["arabic"]
    latin = _open(read(latin_member.source, latin_member.path))
    arabic = _open(read(arabic_member.source, arabic_member.path))
    context = f"family '{family.id}'"
    if latin["head"].unitsPerEm != arabic["head"].unitsPerEm:
        raise FamilyError(f"{context}: Latin and Arabic inputs differ in unitsPerEm")
    for label, font in (("Latin", latin), ("Arabic", arabic)):
        axis = axis_range(font, "wght")
        if (
            not axis.minimum
            <= family.wght.minimum
            <= family.wght.maximum
            <= (axis.maximum)
        ):
            raise FamilyError(
                f"{context}: wght {family.wght} is outside the {label} input's "
                f"{axis.minimum:g}..{axis.maximum:g}"
            )
    result = merge_family(
        latin,
        arabic,
        scale=family.arabic_scale,
        wght=family.wght,
        pinned=family.pinned_axes,
        metrics=family.metrics,
    )
    if result.derived != family.metrics:
        raise FamilyError(
            f"{context}: configured metrics {family.metrics} differ from the "
            f"shared metrics the inputs imply, {result.derived}"
        )
    font: Any = result.font
    finalize_merged(
        font,
        family.name,
        family.wght,
        release=release,
        copyrights=[_copyright(latin), _copyright(arabic)],
        derived_from=(
            f"{_describe(sources, latin_member)} and "
            f"{_describe(sources, arabic_member)}"
        ),
    )
    font["head"].created = latin["head"].created
    font["head"].modified = latin["head"].modified
    font.recalcTimestamp = False
    return font


def _source_metrics(font: Any) -> LineMetrics:
    from sawa_tools.build.merge import LineMetrics

    os2 = font["OS/2"]
    return LineMetrics(
        ascender=os2.sTypoAscender,
        descender=os2.sTypoDescender,
        line_gap=os2.sTypoLineGap,
        win_ascent=os2.usWinAscent,
        win_descent=os2.usWinDescent,
    )


def _build_rename(
    family: Family,
    release: Release,
    sources: Mapping[str, Any],
    read: ReadMember,
) -> Any:
    from sawa_tools.build.merge import axis_range
    from sawa_tools.build.naming import rename_family

    member = family.inputs["input"]
    font = _open(read(member.source, member.path))
    context = f"family '{family.id}'"
    if axis_range(font, "wght") != family.wght:
        raise FamilyError(f"{context}: input wght axis differs from {family.wght}")
    if _source_metrics(font) != family.metrics:
        raise FamilyError(
            f"{context}: configured metrics {family.metrics} differ from the "
            f"input's {_source_metrics(font)}"
        )
    assert family.rename_from is not None and family.notice is not None
    rename_family(
        font,
        old_family=family.rename_from,
        new_family=family.name,
        release=release,
        notice=family.notice,
        derived_from=_describe(sources, member, family.rename_from),
    )
    # A digital signature over the upstream bytes no longer matches.
    if "DSIG" in font:
        del font["DSIG"]
    return font


def _save_atomic(font: Any, dest: Path) -> None:
    tmp = dest.with_name(dest.name + ".tmp")
    font.save(tmp)
    tmp.replace(dest)


def build_family(
    family: Family,
    config: FamilyConfig,
    *,
    sources: Mapping[str, Any],
    read: ReadMember,
    fonts_dir: Path,
    force: bool = False,
) -> BuiltFamily:
    """Builds one family into `fonts_dir`, or reuses a fresh earlier build."""
    for member in [*family.inputs.values(), *family.licence]:
        if member.source not in sources:
            raise FamilyError(f"family '{family.id}': unknown source '{member.source}'")
    ttf = fonts_dir / family.ttf_name
    woff2 = fonts_dir / family.woff2_name if family.generic else None
    outputs = [ttf] if woff2 is None else [ttf, woff2]
    stamp_path = fonts_dir / f"{family.id}.stamp"
    digest = stamp_digest(
        family.raw,
        config.raw_release,
        {m.source: sources[m.source]["sha256"] for m in family.inputs.values()},
        code_version(),
    )
    if not force and is_fresh(stamp_path, digest, outputs):
        return BuiltFamily(family, ttf, woff2, rebuilt=False)

    builder = _build_merge if family.kind == "merge" else _build_rename
    font = builder(family, config.release, sources, read)
    fonts_dir.mkdir(parents=True, exist_ok=True)
    stamp_path.unlink(missing_ok=True)
    _save_atomic(font, ttf)
    if woff2 is not None:
        font.flavor = "woff2"
        _save_atomic(font, woff2)
    tmp = stamp_path.with_name(stamp_path.name + ".tmp")
    tmp.write_text(digest + "\n", encoding="utf-8")
    tmp.replace(stamp_path)
    return BuiltFamily(family, ttf, woff2, rebuilt=True)
