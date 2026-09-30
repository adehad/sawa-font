"""Fetches the pinned roster fonts, builds the Sawa families and writes woff2.

Reference fonts come from data/upstream.json; the Sawa families are built
from its sources as data/sawa.json describes (see families.py).
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path
from typing import TYPE_CHECKING, Any

from sawa_tools.build.families import (
    COMPACTION_DIR,
    DEFAULT_FAMILIES,
    DEFAULT_FONTS_DIR,
    BuiltFamily,
    FamilyError,
    build_family,
    load_config,
)

if TYPE_CHECKING:
    from collections.abc import Collection, Mapping

DEFAULT_OUT = Path("site/public/fonts")
DEFAULT_CACHE = Path(".cache/downloads")
DEFAULT_MANIFEST = Path("data/upstream.json")

_UNSAFE_PATH_SUBSTRINGS = ("/", "\\", "..")

# The site only ever loads Regular/Bold and their italics; anything else has
# no CSS font-weight/font-style mapping to load it against.
_VALID_WEIGHTS = (400, 700)
_VALID_STYLES = ("normal", "italic")
_VALID_GENERICS = ("serif", "sans-serif")

# A family key is written straight into a <style> block as a CSS identifier
# and a quoted font-family value; this rules out characters that would need
# escaping there.
_FAMILY_RE = re.compile(r"^[a-z0-9-]+$")

# OpenType CPAL v1 palette type flags (spec section "CPAL (Color Palette
# Table)"): bit 0 marks a palette usable on a light background, bit 1 on dark.
_CPAL_USABLE_ON_LIGHT = 0x0001
_CPAL_USABLE_ON_DARK = 0x0002


class BuildError(Exception):
    """Raised for any failure that should stop the build with a clear message."""


def add_parser(subparsers: argparse._SubParsersAction) -> None:
    parser = subparsers.add_parser(
        "fonts", help="Fetch the pinned roster fonts and convert them to woff2"
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=DEFAULT_OUT,
        help="Directory to write <font-id>/<style>.woff2 and OFL.txt into, "
        "relative to the cwd (default: %(default)s)",
    )
    parser.add_argument(
        "--cache",
        type=Path,
        default=DEFAULT_CACHE,
        help="Directory to cache downloaded source files in, relative to "
        "the cwd (default: %(default)s)",
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=DEFAULT_MANIFEST,
        help="Path to the upstream font manifest, relative to the cwd "
        "(default: %(default)s)",
    )
    parser.add_argument(
        "--families",
        type=Path,
        default=DEFAULT_FAMILIES,
        help="Path to the Sawa family config, relative to the cwd "
        "(default: %(default)s)",
    )
    parser.add_argument(
        "--fonts-dir",
        type=Path,
        default=DEFAULT_FONTS_DIR,
        help="Directory to write the built Sawa TTFs and build stamps into, "
        "relative to the cwd (default: %(default)s)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Rebuild every Sawa family even when its build stamp matches",
    )
    parser.add_argument(
        "--refit",
        nargs="*",
        metavar="FAMILY",
        help="Fit the compaction of these Sawa families again and build only "
        "them, or of every family with none named, writing it to "
        "compaction/<family>.json beside the family config; about an hour "
        "per family on 16 cores",
    )
    parser.set_defaults(handler=run)


def run(args: argparse.Namespace) -> int:
    try:
        build_fonts(
            manifest=args.manifest,
            out_dir=args.out,
            cache_dir=args.cache,
            families=args.families,
            fonts_dir=args.fonts_dir,
            force=args.force,
            refit=args.refit,
        )
    except (BuildError, FamilyError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


def build_fonts(
    *,
    manifest: Path,
    out_dir: Path,
    cache_dir: Path,
    families: Path | None = None,
    fonts_dir: Path = DEFAULT_FONTS_DIR,
    force: bool = False,
    refit: Collection[str] | None = None,
) -> None:
    """Downloads, verifies and converts every font listed in `manifest`.

    Downloads are cached in `cache_dir` by source name and reused when their
    sha256 still matches the manifest. Writes `<out_dir>/<font-id>/<to>.woff2`
    and `<out_dir>/<font-id>/OFL.txt` for every font id, printing the id once
    it is done. With `families`, first builds each Sawa family into
    `fonts_dir` and adds the ones shown on the site to `out_dir` the same way;
    `refit` names the families to fit the compaction of again and builds only
    those, or with none named refits every family and builds as usual.
    Raises BuildError on any failure, including a malformed manifest.
    """
    try:
        data = json.loads(manifest.read_text(encoding="utf-8"))
    except OSError as exc:
        raise BuildError(f"cannot read manifest {manifest}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise BuildError(f"invalid JSON in manifest {manifest}: {exc}") from exc

    sources = _require(data, "sources", "manifest")
    if not isinstance(sources, dict):
        raise BuildError("manifest: 'sources' must be an object")
    fonts = _require(data, "fonts", "manifest")
    if not isinstance(fonts, dict):
        raise BuildError("manifest: 'fonts' must be an object")

    cache_dir.mkdir(parents=True, exist_ok=True)
    out_dir.mkdir(parents=True, exist_ok=True)

    cached_paths = {
        name: _ensure_cached(name, source, cache_dir)
        for name, source in sources.items()
    }

    fonts_manifest: dict[str, Any] = {}

    def read(name: str, path: str | None) -> bytes:
        return _read_source_bytes(
            name, path, sources, cached_paths, context=f"source '{name}'"
        )

    if families is not None:
        config = load_config(families)
        unknown = set(refit or ()) - {f.id for f in config.families}
        if unknown:
            raise BuildError(f"--refit: no such family {', '.join(sorted(unknown))}")
        for family in config.families:
            if family.id in fonts:
                raise BuildError(
                    f"family '{family.id}' is also a font id in {manifest}"
                )
            if refit and family.id not in refit:
                continue
            built = build_family(
                family,
                config,
                sources=sources,
                read=read,
                fonts_dir=fonts_dir,
                force=force,
                masters_dir=cache_dir.parent / "masters",
                compaction_dir=families.parent / COMPACTION_DIR,
                refit=refit is not None,
            )
            state = "built" if built.rebuilt else "up to date"
            print(f"{family.id}: {state}")
            if built.woff2 is not None:
                fonts_manifest[family.id] = _publish_family(
                    built, out_dir, sources, cached_paths
                )
        if refit:
            print("refitted only the named families; run `sawa build fonts` next")
            return

    for font_id, font in fonts.items():
        _validate_path_component(font_id, what="font id")
        context = f"font '{font_id}'"

        font_out = out_dir / font_id
        if font_out.exists():
            shutil.rmtree(font_out)
        font_out.mkdir(parents=True)

        faces: list[dict[str, Any]] = []
        face_infos: dict[tuple[str, int, str], dict[str, Any]] = {}
        seen_faces: set[tuple[str, int, str]] = set()
        for file_entry in _require(font, "files", context):
            entry_context = f"{context} file entry"
            source_name = _require(file_entry, "source", entry_context)
            member = _require(file_entry, "from", entry_context)
            to_name = _require(file_entry, "to", entry_context)
            family = _require(file_entry, "family", entry_context)
            weight = _require(file_entry, "weight", entry_context)
            style = _require(file_entry, "style", entry_context)
            _validate_face(family, weight, style, context=entry_context)
            _validate_path_component(to_name, what=f"{context} output name")

            face_key = (family, weight, style)
            if face_key in seen_faces:
                raise BuildError(
                    f"{context}: duplicate face family={family!r} weight={weight!r} "
                    f"style={style!r}"
                )
            seen_faces.add(face_key)

            dest = font_out / f"{to_name}.woff2"
            info = _convert_member(
                source_name, member, dest, sources, cached_paths, context=context
            )
            faces.append(
                {
                    "family": family,
                    "weight": weight,
                    "style": style,
                    "file": f"{font_id}/{to_name}.woff2",
                }
            )
            face_infos[face_key] = info

        _write_licence(
            font_out / "OFL.txt",
            [
                (
                    _require(entry, "source", f"{context} licence entry"),
                    entry.get("path"),
                )
                for entry in _require(font, "licence", context)
            ],
            sources,
            cached_paths,
            context=f"{context} licence",
        )

        stack = _require(font, "stack", context)
        _validate_stack(stack, faces, context=context)

        generic = _require(font, "generic", context)
        if generic not in _VALID_GENERICS:
            raise BuildError(f"{context}: 'generic' must be one of {_VALID_GENERICS}")

        fonts_manifest[font_id] = {
            "name": _require(font, "name", context),
            "stack": stack,
            "generic": generic,
            "faces": faces,
            "families": _build_families(faces, face_infos),
        }

        print(font_id)

    (out_dir / "fonts.json").write_text(
        json.dumps({"fonts": fonts_manifest}, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _publish_family(
    built: BuiltFamily,
    out_dir: Path,
    sources: Mapping[str, Any],
    cached_paths: Mapping[str, Path],
) -> dict[str, Any]:
    """Copies a built family's woff2 and licence into `out_dir`; returns its
    fonts.json entry, with one face spanning the family's whole wght range.
    """
    from fontTools.ttLib import TTFont

    family = built.family
    if built.woff2 is None:
        raise BuildError(f"family '{family.id}' has no woff2 to publish")
    font_out = out_dir / family.id
    if font_out.exists():
        shutil.rmtree(font_out)
    font_out.mkdir(parents=True)
    shutil.copyfile(built.woff2, font_out / family.woff2_name)
    _write_licence(
        font_out / "OFL.txt",
        [(member.source, member.path) for member in family.licence],
        sources,
        cached_paths,
        context=f"family '{family.id}' licence",
    )
    info = extract_font_info(TTFont(built.ttf, lazy=True))
    return {
        "name": family.name,
        "stack": [family.id],
        "generic": family.generic,
        "faces": [
            {
                "family": family.id,
                "weight": [int(family.wght.minimum), int(family.wght.maximum)],
                "style": "normal",
                "file": f"{family.id}/{family.woff2_name}",
            }
        ],
        "families": {family.id: info},
    }


def _write_licence(
    dest: Path,
    entries: list[tuple[str, str | None]],
    sources: Mapping[str, Any],
    cached_paths: Mapping[str, Path],
    *,
    context: str,
) -> None:
    texts = [
        _read_source_bytes(source, path, sources, cached_paths, context=context)
        .decode("utf-8")
        .rstrip("\n")
        for source, path in entries
    ]
    dest.write_text("\n\n".join(texts) + "\n", encoding="utf-8")


def _validate_face(family: Any, weight: Any, style: Any, *, context: str) -> None:
    if not isinstance(family, str) or not _FAMILY_RE.match(family):
        raise BuildError(
            f"{context}: 'family' must match {_FAMILY_RE.pattern!r}, got {family!r}"
        )
    if weight not in _VALID_WEIGHTS:
        raise BuildError(f"{context}: 'weight' must be one of {_VALID_WEIGHTS}")
    if style not in _VALID_STYLES:
        raise BuildError(f"{context}: 'style' must be one of {_VALID_STYLES}")


def _validate_stack(stack: Any, faces: list[dict[str, Any]], *, context: str) -> None:
    if (
        not isinstance(stack, list)
        or not stack
        or not all(isinstance(family, str) for family in stack)
    ):
        raise BuildError(f"{context}: 'stack' must be a non-empty list of strings")
    if len(set(stack)) != len(stack):
        raise BuildError(f"{context}: 'stack' must not repeat a family")
    face_families = {face["family"] for face in faces}
    if set(stack) != face_families:
        raise BuildError(
            f"{context}: 'stack' {stack} must list exactly the families used by "
            f"its files ({sorted(face_families)})"
        )


def _build_families(
    faces: list[dict[str, Any]],
    face_infos: dict[tuple[str, int, str], dict[str, Any]],
) -> dict[str, Any]:
    """Picks each family's weight-400 normal face, falling back to its first face."""
    families: dict[str, Any] = {}
    for family in dict.fromkeys(face["family"] for face in faces):
        candidates = [face for face in faces if face["family"] == family]
        chosen = next(
            (
                face
                for face in candidates
                if face["weight"] == 400 and face["style"] == "normal"
            ),
            candidates[0],
        )
        families[family] = face_infos[
            (chosen["family"], chosen["weight"], chosen["style"])
        ]
    return families


def _require(mapping: Mapping[str, Any], key: str, context: str) -> Any:
    try:
        return mapping[key]
    except KeyError as exc:
        raise BuildError(f"{context}: missing required key '{key}'") from exc
    except TypeError as exc:
        raise BuildError(f"{context}: expected an object, got {mapping!r}") from exc


def _validate_path_component(value: str, *, what: str) -> None:
    if any(bad in value for bad in _UNSAFE_PATH_SUBSTRINGS):
        raise BuildError(f"{what} {value!r} must not contain '/', '\\' or '..'")


def _ensure_cached(name: str, source: Mapping[str, Any], cache_dir: Path) -> Path:
    context = f"source '{name}'"
    url = _require(source, "url", context)
    expected_sha256 = _require(source, "sha256", context)
    dest = cache_dir / name
    if dest.exists() and _sha256(dest) == expected_sha256:
        return dest

    tmp = dest.parent / f"{dest.name}.tmp"
    try:
        _download(url, tmp)
    except OSError as exc:
        tmp.unlink(missing_ok=True)
        raise BuildError(f"{context}: failed to download {url}: {exc}") from exc

    actual_sha256 = _sha256(tmp)
    if actual_sha256 != expected_sha256:
        tmp.unlink(missing_ok=True)
        raise BuildError(
            f"{context}: sha256 mismatch for {url} "
            f"(expected {expected_sha256}, got {actual_sha256})"
        )
    tmp.replace(dest)
    return dest


def _download(url: str, dest: Path) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": "sawa-tools"})
    with urllib.request.urlopen(request, timeout=60) as response, dest.open("wb") as fh:
        shutil.copyfileobj(response, fh)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _read_source_bytes(
    source_name: str,
    path: str | None,
    sources: Mapping[str, Any],
    cached_paths: Mapping[str, Path],
    *,
    context: str,
) -> bytes:
    source = _require(sources, source_name, context)
    cached_path = cached_paths[source_name]
    if source.get("kind", "zip") == "file":
        return cached_path.read_bytes()

    if path is None:
        raise BuildError(
            f"{context}: source '{source_name}' is a zip source and needs a path"
        )
    with zipfile.ZipFile(cached_path) as archive:
        try:
            return archive.read(path)
        except KeyError as exc:
            raise BuildError(
                f"{context}: missing archive member '{path}' in {cached_path} "
                f"(source '{source_name}')"
            ) from exc


def _convert_member(
    source_name: str,
    member: str,
    dest: Path,
    sources: Mapping[str, Any],
    cached_paths: Mapping[str, Path],
    *,
    context: str,
) -> dict[str, Any]:
    # fontTools' woff2 flavor needs the `build` dependency group (brotli); a
    # plain checkout of this package must stay importable without it.
    from fontTools.ttLib import TTFont

    data = _read_source_bytes(
        source_name, member, sources, cached_paths, context=context
    )
    # recalcTimestamp=False keeps head.modified from being restamped to the
    # build time, so re-running produces byte-identical woff2 output.
    font = TTFont(io.BytesIO(data), recalcTimestamp=False)
    # Metrics/features/palette info must come from the TTF tables; converting
    # to woff2 first would mean re-parsing compressed table data for no gain.
    info = extract_font_info(font)
    font.flavor = "woff2"
    dest.parent.mkdir(parents=True, exist_ok=True)
    font.save(dest)
    return info


def extract_font_info(font: Any) -> dict[str, Any]:
    head = font["head"]
    hhea = font["hhea"]
    os2 = font["OS/2"]

    features: set[str] = set()
    scripts: set[str] = set()
    for tag in ("GSUB", "GPOS"):
        if tag not in font:
            continue
        table = font[tag].table
        if table.FeatureList:
            features.update(
                record.FeatureTag for record in table.FeatureList.FeatureRecord
            )
        if table.ScriptList:
            scripts.update(record.ScriptTag for record in table.ScriptList.ScriptRecord)

    colr = {"version": font["COLR"].version} if "COLR" in font else None
    axes, instances = _extract_axes(font)
    cpal = _extract_cpal(font["CPAL"]) if "CPAL" in font else None

    return {
        "unitsPerEm": head.unitsPerEm,
        "hhea": {
            "ascender": hhea.ascent,
            "descender": hhea.descent,
            "lineGap": hhea.lineGap,
        },
        "typo": {
            "ascender": os2.sTypoAscender,
            "descender": os2.sTypoDescender,
            "lineGap": os2.sTypoLineGap,
            "useTypoMetrics": bool(os2.fsSelection & 0x80),
        },
        "win": {
            "ascent": os2.usWinAscent,
            "descent": os2.usWinDescent,
        },
        "xHeight": getattr(os2, "sxHeight", None),
        "capHeight": getattr(os2, "sCapHeight", None),
        "features": sorted(features),
        "scripts": sorted(scripts),
        "colr": colr,
        "cpal": cpal,
        "axes": axes,
        "instances": instances,
    }


def _extract_axes(font: Any) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if "fvar" not in font:
        return [], []
    fvar = font["fvar"]
    axes = [
        {
            "tag": axis.axisTag,
            "min": axis.minValue,
            "default": axis.defaultValue,
            "max": axis.maxValue,
        }
        for axis in fvar.axes
    ]
    instances = [
        {
            "name": font["name"].getDebugName(inst.subfamilyNameID),
            "coords": dict(inst.coordinates),
        }
        for inst in fvar.instances
    ]
    return axes, instances


def _extract_cpal(cpal_table: Any) -> dict[str, Any]:
    palette_count = len(cpal_table.palettes)
    if cpal_table.version == 1:
        types = [_cpal_palette_type(flags) for flags in cpal_table.paletteTypes]
    else:
        types = [None] * palette_count
    return {"palettes": palette_count, "types": types}


def _cpal_palette_type(flags: int) -> str | None:
    light = bool(flags & _CPAL_USABLE_ON_LIGHT)
    dark = bool(flags & _CPAL_USABLE_ON_DARK)
    if light and not dark:
        return "light"
    if dark and not light:
        return "dark"
    return None
