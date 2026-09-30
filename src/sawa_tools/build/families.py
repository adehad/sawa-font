"""Builds the Sawa families described in data/sawa.json into fonts/.

A family is either `merge` (an Arabic and a Latin variable font merged under
one wght axis, see merge.py) or `rename` (one variable font renamed). Either
way its anchored static masters are finished here before varLib builds them,
compacted by the family's fitted compaction (fitted.py), given U+A7DC
(lambda_stroke.py), and the masters and the variable font are fixed where
Fontbakery fails them (polish.py). Each
build writes a
stamp next to its output; a later run whose inputs, config, fitted
compaction and build code hash to the same stamp reuses the output.
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

    from fontTools.ttLib import TTFont

    from sawa_tools.build.compact import Compaction
    from sawa_tools.build.fitted import FittedFile
    from sawa_tools.build.masters import MastersCache
    from sawa_tools.build.merge import Finish, LineMetrics, WghtRange
    from sawa_tools.build.naming import Release

    ReadMember = Callable[[str, str | None], bytes]

DEFAULT_FAMILIES = Path("data/sawa.json")
# Beside the family config: <dir>/<family id>.json per compacted family.
COMPACTION_DIR = "compaction"
DEFAULT_FONTS_DIR = Path("fonts")

_KINDS = {"merge": "shared", "rename": "box"}
_GENERICS = ("serif", "sans-serif", "monospace")
_CODE_MODULES = (
    "anchors.py",
    "borrow.py",
    "clearance.py",
    "compact.py",
    "families.py",
    "fitted.py",
    "harfbuzz.py",
    "ink.py",
    "lambda_stroke.py",
    "lines.py",
    "masters.py",
    "merge.py",
    "naming.py",
    "pause.py",
    "polish.py",
)


class FamilyError(Exception):
    """Raised for a malformed family config or a build that breaks its config."""


@dataclass(frozen=True)
class Member:
    source: str
    path: str | None = None


@dataclass(frozen=True)
class Borrow:
    """Glyphs a rename family takes from another variable font (borrow.py)."""

    member: Member
    codepoints: list[int]
    scale_from: list[int]
    pinned_axes: dict[str, float] = field(default_factory=dict)


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
    mark_clearance: float | None = None
    rename_from: str | None = None
    notice: str | None = None
    cell_width: int | None = None
    coverage_gaps: list[str] = field(default_factory=list)
    leading_quran: bool = True
    # The corpus parts whose lines size the line box; None for all.
    box_parts: tuple[str, ...] | None = None
    compaction: dict[str, Any] | None = None
    borrow: list[Borrow] = field(default_factory=list)
    # Whether the family has a Harakat twin (harakat.py).
    harakat: bool = False
    raw: dict[str, Any] = field(default_factory=dict)

    @property
    def spacing_marks(self) -> set[int]:
        """The combining marks the build makes spacing glyphs (pause.py)."""
        from sawa_tools.checks.marks import _parse_codepoints

        pause = (self.compaction or {}).get("pauseMarks")
        if not pause:
            return set()
        return {cp for spec in pause["codepoints"] for cp in _parse_codepoints(spec)}

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


def _codepoint_list(specs: Any, context: str) -> list[int]:
    from sawa_tools.checks.marks import MarksError, _parse_codepoints

    try:
        return [cp for spec in specs for cp in _parse_codepoints(spec)]
    except MarksError as exc:
        raise FamilyError(f"{context}: {exc}") from exc


def _parse_borrow(raw: Any, context: str) -> Borrow:
    return Borrow(
        member=_member(raw, context),
        codepoints=_codepoint_list(_get(raw, "codepoints", context), context),
        scale_from=_codepoint_list(_get(raw, "scaleFrom", context), context),
        pinned_axes={k: float(v) for k, v in raw.get("pinnedAxes", {}).items()},
    )


def _parse_family(
    family_id: str, raw: Any, compaction: dict[str, Any] | None = None
) -> Family:
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
    borrow = [
        _parse_borrow(entry, f"{context} borrow") for entry in raw.get("borrow", [])
    ]
    for entry in borrow:
        inputs[f"borrow:{entry.member.source}"] = entry.member
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
        mark_clearance=(
            float(raw["markClearance"]) if "markClearance" in raw else None
        ),
        rename_from=_get(raw, "renameFrom", context) if kind == "rename" else None,
        notice=_get(raw, "notice", context) if kind == "rename" else None,
        cell_width=raw.get("cellWidth"),
        coverage_gaps=list(raw.get("coverageGaps", [])),
        leading_quran=bool(raw.get("leading", {}).get("quran", True)),
        box_parts=(
            tuple(raw["leading"]["boxParts"])
            if "boxParts" in raw.get("leading", {})
            else None
        ),
        compaction=_compaction_config(compaction, raw),
        borrow=borrow,
        harakat=bool(raw.get("harakat", False)),
        raw=raw,
    )


def _compaction_config(
    defaults: dict[str, Any] | None, raw: Any
) -> dict[str, Any] | None:
    """The shared compaction defaults updated by the family's own
    `compaction`; None without defaults or when the family's is null.
    """
    from sawa_tools.build.compact import merged

    own = raw.get("compaction", {})
    if defaults is None or own is None:
        return None
    return merged(defaults, own)


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
        families=[
            _parse_family(fid, raw, data.get("compaction"))
            for fid, raw in families_raw.items()
        ],
        raw_release=release_raw,
    )


def code_version() -> str:
    """Hashes this build's own source and fontTools version into one string."""
    from fontTools import version as fonttools_version

    from sawa_tools.build.masters import code_bytes

    digest = hashlib.sha256(fonttools_version.encode())
    here = Path(__file__).parent
    for module in _CODE_MODULES:
        digest.update(code_bytes(here / module))
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


def _clearance(family: Family) -> float:
    """The mark clearance every family that anchors marks needs."""
    if family.mark_clearance is None:
        raise FamilyError(f"family '{family.id}': missing required key 'markClearance'")
    return family.mark_clearance


def _compaction(family: Family) -> Compaction | None:
    """The compaction stage's parameters and corpus: the Quran text, unless
    `leading.quran` is false, then the stress strings and mixed sentences,
    and the mark samples `sawa check fonts` shapes.
    """
    if family.compaction is None:
        return None
    from sawa_tools.build.compact import Compaction, parse_params
    from sawa_tools.corpus import CorpusError, corpus, mark_samples, texts
    from sawa_tools.tanzil import DEFAULT_UTHMANI

    quran = DEFAULT_UTHMANI if family.leading_quran else None
    try:
        lines = texts(corpus(quran)) + mark_samples()
        params = parse_params(family.compaction, _clearance(family), family.cell_width)
    except (CorpusError, KeyError, ValueError) as exc:
        raise FamilyError(f"family '{family.id}' compaction: {exc}") from exc
    return Compaction(family.id, params, lines)


def _build_merge(
    family: Family,
    release: Release,
    sources: Mapping[str, Any],
    read: ReadMember,
    masters_cache: MastersCache | None = None,
    finish: Finish | None = None,
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
        clearance_em=_clearance(family),
        masters_cache=masters_cache,
        finish=finish,
    )
    from sawa_tools.build.merge import win_errors

    errors = win_errors(family.metrics, result.extent)
    if errors:
        raise FamilyError(f"{context}: " + "; ".join(errors))
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


def _instances_extent(font: Any, wght: WghtRange) -> tuple[float, float]:
    """The lowest and highest glyph ink of `font` at the wght minimum,
    default and maximum.
    """
    from fontTools.varLib import instancer

    from sawa_tools.build.merge import y_extent

    extents = [
        y_extent(instancer.instantiateVariableFont(font, {"wght": w}, inplace=False))
        for w in sorted({wght.minimum, wght.default, wght.maximum})
    ]
    return min(e[0] for e in extents), max(e[1] for e in extents)


def _limited(font: Any, family: Family) -> Any:
    """`font` with its wght axis cut to the family's range, which must lie
    inside it and share its default.
    """
    from fontTools.varLib import instancer

    from sawa_tools.build.merge import axis_range

    axis, wght = axis_range(font, "wght"), family.wght
    if axis == wght:
        return font
    if not axis.minimum <= wght.minimum <= wght.maximum <= axis.maximum or (
        axis.default != wght.default
    ):
        raise FamilyError(
            f"family '{family.id}': wght {wght} is not inside the input's "
            f"{axis.minimum:g}..{axis.maximum:g} with its default {axis.default:g}"
        )
    return instancer.instantiateVariableFont(
        font, {"wght": (wght.minimum, wght.default, wght.maximum)}
    )


def _build_rename(
    family: Family,
    release: Release,
    sources: Mapping[str, Any],
    read: ReadMember,
    masters_cache: MastersCache | None = None,
    finish: Finish | None = None,
) -> Any:
    from sawa_tools.build.naming import rename_family, set_named_weights

    member = family.inputs["input"]
    font = _limited(_open(read(member.source, member.path)), family)
    assert family.rename_from is not None and family.notice is not None
    derived_from = _describe(sources, member, family.rename_from)
    lenders = []
    if family.borrow:
        from sawa_tools.build.borrow import Borrowed, borrow_glyphs

        borrowed = []
        for entry in family.borrow:
            lender = _open(read(entry.member.source, entry.member.path))
            lenders.append(lender)
            borrowed.append(
                Borrowed(lender, entry.codepoints, entry.scale_from, entry.pinned_axes)
            )
        font = borrow_glyphs(
            font,
            borrowed,
            family.wght,
            family.cell_width,
            _clearance(family),
            masters_cache,
            finish,
        )
        derived_from += ", with marks from " + " and ".join(
            _describe(sources, entry.member) for entry in family.borrow
        )
    rename_family(
        font,
        old_family=family.rename_from,
        new_family=family.name,
        release=release,
        notice=family.notice,
        derived_from=derived_from,
        borrowed_copyrights=[_copyright(lender) for lender in lenders],
    )
    set_named_weights(font, family.name, family.wght)
    font["name"].removeUnusedNames(font)
    # A digital signature over the upstream bytes no longer matches.
    if "DSIG" in font:
        del font["DSIG"]
    from sawa_tools.build.merge import apply_metrics, win_errors

    errors = win_errors(family.metrics, _instances_extent(font, family.wght))
    if errors:
        raise FamilyError(f"family '{family.id}': " + "; ".join(errors))
    apply_metrics(font, family.metrics, font["OS/2"])
    return font


def _save_atomic(font: Any, dest: Path) -> None:
    tmp = dest.with_name(dest.name + ".tmp")
    font.save(tmp)
    tmp.replace(dest)


def _finish(
    family: Family,
    compaction: Compaction | None,
    fitted: FittedFile | None,
    refit: bool,
) -> Finish:
    def finish(masters: dict[float, TTFont]) -> dict[float, TTFont]:
        from sawa_tools.build.fitted import compacted
        from sawa_tools.build.lambda_stroke import add_capital_lambda_with_stroke
        from sawa_tools.build.polish import finish_masters

        if compaction is not None and fitted is not None:
            masters = compacted(masters, family.wght.default, compaction, fitted, refit)
        add_capital_lambda_with_stroke(masters, family.wght.default)
        finish_masters(masters)
        return masters

    return finish


def build_family(
    family: Family,
    config: FamilyConfig,
    *,
    sources: Mapping[str, Any],
    read: ReadMember,
    fonts_dir: Path,
    force: bool = False,
    masters_dir: Path | None = None,
    compaction_dir: Path | None = None,
    refit: bool = False,
) -> BuiltFamily:
    """Builds one family into `fonts_dir`, or reuses a fresh earlier build.

    With `masters_dir`, keeps the family's anchored masters there and reuses
    them while their inputs, config and code stay the same (masters.py). A
    family with compaction applies `compaction_dir`/<id>.json, or with
    `refit` fits it again and writes it there first (fitted.py); a file
    fitted against other inputs stops the build before it starts.
    """
    from sawa_tools.build.fitted import FitError, FittedFile, fit_key
    from sawa_tools.build.masters import MastersCache, masters_key

    for member in [*family.inputs.values(), *family.licence]:
        if member.source not in sources:
            raise FamilyError(f"family '{family.id}': unknown source '{member.source}'")
    ttf = fonts_dir / family.ttf_name
    woff2 = fonts_dir / family.woff2_name if family.generic else None
    outputs = [ttf] if woff2 is None else [ttf, woff2]
    stamp_path = fonts_dir / f"{family.id}.stamp"
    shas = {m.source: sources[m.source]["sha256"] for m in family.inputs.values()}
    anchored_key = masters_key(family.raw, shas)
    compaction = _compaction(family)
    fitted = None
    if compaction is not None:
        if compaction_dir is None:
            raise FamilyError(f"family '{family.id}': no compaction directory given")
        fitted = FittedFile(
            family.id,
            compaction_dir / f"{family.id}.json",
            fit_key(anchored_key, compaction),
        )
        if not refit:
            try:
                fitted.read()
            except FitError as exc:
                raise FamilyError(f"family '{family.id}': {exc}") from exc

    def digest() -> str:
        inputs = dict(shas)
        if fitted is not None:
            inputs["compaction"] = fitted.key
            inputs["compactionData"] = fitted.digest()
        return stamp_digest(family.raw, config.raw_release, inputs, code_version())

    if not force and not refit and is_fresh(stamp_path, digest(), outputs):
        return BuiltFamily(family, ttf, woff2, rebuilt=False)

    builder = _build_merge if family.kind == "merge" else _build_rename
    cache = None
    if masters_dir is not None:
        cache = MastersCache(masters_dir / family.id, anchored_key)
    from sawa_tools.build.lambda_stroke import StrokeError
    from sawa_tools.build.polish import PolishError, finish_font

    finish = _finish(family, compaction, fitted, refit)
    try:
        font = builder(family, config.release, sources, read, cache, finish)
        finish_font(font)
    except (FitError, PolishError, StrokeError) as exc:
        raise FamilyError(f"family '{family.id}': {exc}") from exc
    fonts_dir.mkdir(parents=True, exist_ok=True)
    stamp_path.unlink(missing_ok=True)
    _save_atomic(font, ttf)
    if woff2 is not None:
        font.flavor = "woff2"
        _save_atomic(font, woff2)
    tmp = stamp_path.with_name(stamp_path.name + ".tmp")
    tmp.write_text(digest() + "\n", encoding="utf-8")
    tmp.replace(stamp_path)
    return BuiltFamily(family, ttf, woff2, rebuilt=True)
