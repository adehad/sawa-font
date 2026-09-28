"""Fetches the pinned roster fonts from data/upstream.json and converts to woff2."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from collections.abc import Mapping

DEFAULT_OUT = Path("site/public/fonts")
DEFAULT_CACHE = Path(".cache/downloads")
DEFAULT_MANIFEST = Path("data/upstream.json")

_UNSAFE_PATH_SUBSTRINGS = ("/", "\\", "..")


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
    parser.set_defaults(handler=run)


def run(args: argparse.Namespace) -> int:
    try:
        build_fonts(manifest=args.manifest, out_dir=args.out, cache_dir=args.cache)
    except BuildError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


def build_fonts(*, manifest: Path, out_dir: Path, cache_dir: Path) -> None:
    """Downloads, verifies and converts every font listed in `manifest`.

    Downloads are cached in `cache_dir` by source name and reused when their
    sha256 still matches the manifest. Writes `<out_dir>/<font-id>/<to>.woff2`
    and `<out_dir>/<font-id>/OFL.txt` for every font id, printing the id once
    it is done. Raises BuildError on any failure, including a malformed
    manifest.
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

    for font_id, font in fonts.items():
        _validate_path_component(font_id, what="font id")
        context = f"font '{font_id}'"

        font_out = out_dir / font_id
        if font_out.exists():
            shutil.rmtree(font_out)
        font_out.mkdir(parents=True)

        for file_entry in _require(font, "files", context):
            source_name = _require(file_entry, "source", f"{context} file entry")
            member = _require(file_entry, "from", f"{context} file entry")
            to_name = _require(file_entry, "to", f"{context} file entry")
            _validate_path_component(to_name, what=f"{context} output name")
            dest = font_out / f"{to_name}.woff2"
            _convert_member(
                source_name, member, dest, sources, cached_paths, context=context
            )

        licence_texts = [
            _read_source_bytes(
                _require(entry, "source", f"{context} licence entry"),
                entry.get("path"),
                sources,
                cached_paths,
                context=f"{context} licence",
            )
            .decode("utf-8")
            .rstrip("\n")
            for entry in _require(font, "licence", context)
        ]
        (font_out / "OFL.txt").write_text(
            "\n\n".join(licence_texts) + "\n", encoding="utf-8"
        )
        print(font_id)


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
) -> None:
    # fontTools' woff2 flavor needs the `build` dependency group (brotli); a
    # plain checkout of this package must stay importable without it.
    from fontTools.ttLib import TTFont

    data = _read_source_bytes(
        source_name, member, sources, cached_paths, context=context
    )
    # recalcTimestamp=False keeps head.modified from being restamped to the
    # build time, so re-running produces byte-identical woff2 output.
    font = TTFont(io.BytesIO(data), recalcTimestamp=False)
    font.flavor = "woff2"
    dest.parent.mkdir(parents=True, exist_ok=True)
    font.save(dest)
