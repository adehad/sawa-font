"""Locates the Sawa TTFs and the upstream fonts each family is built from.

Upstream fonts are the exact members data/sawa.json names, extracted from
the archives `sawa build fonts` downloads into .cache/downloads and checked
against data/upstream.json's sha256.
"""

from __future__ import annotations

import hashlib
import json
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

from sawa_tools.build.families import DEFAULT_FAMILIES, load_config
from sawa_tools.build.fonts import DEFAULT_CACHE, DEFAULT_MANIFEST
from sawa_tools.build.harakat import twin_family

if TYPE_CHECKING:
    from sawa_tools.build.families import Family

DEFAULT_EXTRACT = Path(".cache/report-upstream")


class SourcesError(Exception):
    """Raised when a Sawa or upstream font cannot be found."""


@dataclass(frozen=True)
class ReportFamily:
    family: Family
    ttf: Path
    upstream: list[Path]
    upstream_names: list[str]
    # The id of the plain family a Harakat twin colours. A twin shares that
    # family's upstream fonts and has no test layers or shaping results of its
    # own: its shapes and positions are the plain family's, which
    # `sawa check fonts` holds it to.
    twin_of: str | None = None

    @property
    def id(self) -> str:
        return self.family.id

    @property
    def upstream_id(self) -> str:
        return "upstream-" + (self.twin_of or self.id).removeprefix("sawa-")

    @property
    def upstream_variations(self) -> dict[str, float]:
        return {"wght": self.family.wght.default, **self.family.pinned_axes}

    @property
    def weights(self) -> list[float]:
        wght = self.family.wght
        return sorted({wght.minimum, wght.default, wght.maximum})


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _extract(source: str, member: str, manifest: dict, cache: Path, out: Path) -> Path:
    """Extracts one archive member, cached under the archive's pinned sha256
    so a new pin never reuses a font extracted from the old archive.
    """
    expected = manifest["sources"][source]["sha256"]
    dest = out / source / expected / Path(member).name
    if dest.exists():
        return dest
    archive = cache / source
    if not archive.exists():
        raise SourcesError(f"{archive} not found; run `sawa build fonts` first")
    if _sha256(archive) != expected:
        raise SourcesError(f"{archive} does not match data/upstream.json's sha256")
    with zipfile.ZipFile(archive) as zf:
        data = zf.read(member)
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(dest.name + ".tmp")
    tmp.write_bytes(data)
    tmp.replace(dest)
    return dest


def layered_families(families: list[ReportFamily]) -> list[ReportFamily]:
    """The families with test layers and shaping results, which are not twins."""
    return [family for family in families if family.twin_of is None]


def report_families(
    fonts_dir: Path,
    families: Path = DEFAULT_FAMILIES,
    manifest: Path = DEFAULT_MANIFEST,
    cache: Path = DEFAULT_CACHE,
    extract_dir: Path = DEFAULT_EXTRACT,
) -> list[ReportFamily]:
    """The Sawa families shown on the site, with their upstream fonts, then
    the Harakat twin of each that has one.
    """
    config = load_config(families)
    upstream = json.loads(manifest.read_text(encoding="utf-8"))
    result = []
    twins = []
    for family in config.families:
        if family.generic is None:
            continue
        ttf = fonts_dir / family.ttf_name
        if not ttf.exists():
            raise SourcesError(f"{ttf} not found; run `sawa build fonts` first")
        roles = ("latin", "arabic") if family.kind == "merge" else ("input",)
        members = [family.inputs[role] for role in roles]
        paths = []
        for member in members:
            if member.path is None:
                raise SourcesError(f"family '{family.id}': input has no path")
            paths.append(
                _extract(member.source, member.path, upstream, cache, extract_dir)
            )
        names = [
            f"{upstream['sources'][m.source]['name']} "
            f"{upstream['sources'][m.source]['version']}"
            for m in members
        ]
        result.append(ReportFamily(family, ttf, paths, names))
        if family.harakat:
            twin = twin_family(family)
            twin_ttf = fonts_dir / twin.ttf_name
            if not twin_ttf.exists():
                raise SourcesError(
                    f"{twin_ttf} not found; run `sawa build fonts` first"
                )
            twins.append(ReportFamily(twin, twin_ttf, paths, names, family.id))
    return result + twins
