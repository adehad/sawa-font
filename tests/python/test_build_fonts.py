import hashlib
import io
import json
import zipfile
from pathlib import Path

import pytest

pytest.importorskip("fontTools")

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

from sawa_tools.build import fonts

LICENCE_TEXT = (
    "Copyright Test Authors.\nThis Font Software is licensed under the SIL OFL 1.1.\n"
)
OTHER_LICENCE_TEXT = "Copyright Other Authors.\nAlso the SIL OFL 1.1.\n"


def _make_test_font_bytes(family: str = "Test Font") -> bytes:
    """Builds a minimal real TTF with a couple of glyphs, in memory."""
    builder = FontBuilder(unitsPerEm=1000, isTTF=True)
    builder.setupGlyphOrder([".notdef", "A"])
    builder.setupCharacterMap({65: "A"})

    pen = TTGlyphPen(None)
    pen.moveTo((0, 0))
    pen.lineTo((0, 500))
    pen.lineTo((500, 500))
    pen.lineTo((500, 0))
    pen.closePath()
    a_glyph = pen.glyph()
    notdef_glyph = TTGlyphPen(None).glyph()

    builder.setupGlyf({".notdef": notdef_glyph, "A": a_glyph})
    builder.setupHorizontalMetrics({".notdef": (500, 0), "A": (500, 0)})
    builder.setupHorizontalHeader(ascent=800, descent=-200)
    builder.setupNameTable({"familyName": family, "styleName": "Regular"})
    builder.setupOS2()
    builder.setupPost()

    buf = io.BytesIO()
    builder.font.save(buf)
    return buf.getvalue()


def _make_fixture_zip(
    tmp_path: Path, name: str = "fixture-source.zip"
) -> tuple[Path, str]:
    """Builds a small archive with a real font and a licence file.

    Returns (path, sha256).
    """
    archive_path = tmp_path / name
    with zipfile.ZipFile(archive_path, "w") as archive:
        archive.writestr("TestFont/TestFont-Regular.ttf", _make_test_font_bytes())
        archive.writestr("TestFont/OFL.txt", LICENCE_TEXT)
    sha256 = hashlib.sha256(archive_path.read_bytes()).hexdigest()
    return archive_path, sha256


def _write_manifest(
    tmp_path: Path, sha256: str, *, from_member: str = "TestFont/TestFont-Regular.ttf"
) -> Path:
    manifest = {
        "sources": {
            "testsrc": {
                "kind": "zip",
                "url": "https://example.invalid/fixture-source.zip",
                "sha256": sha256,
            }
        },
        "fonts": {
            "test": {
                "name": "Test Font",
                "licence": [{"source": "testsrc", "path": "TestFont/OFL.txt"}],
                "files": [
                    {"source": "testsrc", "from": from_member, "to": "TestFont-Regular"}
                ],
            }
        },
    }
    manifest_path = tmp_path / "upstream.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    return manifest_path


def test_happy_path_writes_woff2_and_licence(tmp_path: Path) -> None:
    archive_path, sha256 = _make_fixture_zip(tmp_path)
    cache_dir = tmp_path / "cache"
    cache_dir.mkdir()
    (cache_dir / "testsrc").write_bytes(archive_path.read_bytes())
    manifest_path = _write_manifest(tmp_path, sha256)
    out_dir = tmp_path / "out"

    fonts.build_fonts(manifest=manifest_path, out_dir=out_dir, cache_dir=cache_dir)

    woff2_path = out_dir / "test" / "TestFont-Regular.woff2"
    assert woff2_path.exists()
    written = TTFont(woff2_path)
    assert written.flavor == "woff2"

    licence_path = out_dir / "test" / "OFL.txt"
    assert licence_path.read_text(encoding="utf-8").strip() == LICENCE_TEXT.strip()


def test_rebuild_is_byte_identical(tmp_path: Path) -> None:
    archive_path, sha256 = _make_fixture_zip(tmp_path)
    cache_dir = tmp_path / "cache"
    cache_dir.mkdir()
    (cache_dir / "testsrc").write_bytes(archive_path.read_bytes())
    manifest_path = _write_manifest(tmp_path, sha256)
    out_dir = tmp_path / "out"

    fonts.build_fonts(manifest=manifest_path, out_dir=out_dir, cache_dir=cache_dir)
    first = (out_dir / "test" / "TestFont-Regular.woff2").read_bytes()

    fonts.build_fonts(manifest=manifest_path, out_dir=out_dir, cache_dir=cache_dir)
    second = (out_dir / "test" / "TestFont-Regular.woff2").read_bytes()

    assert first == second


def test_two_font_ids_from_the_same_bytes_are_byte_identical(tmp_path: Path) -> None:
    archive_path, sha256 = _make_fixture_zip(tmp_path)
    cache_dir = tmp_path / "cache"
    cache_dir.mkdir()
    (cache_dir / "testsrc").write_bytes(archive_path.read_bytes())

    manifest = {
        "sources": {
            "testsrc": {
                "kind": "zip",
                "url": "https://example.invalid/fixture-source.zip",
                "sha256": sha256,
            }
        },
        "fonts": {
            "one": {
                "name": "One",
                "licence": [{"source": "testsrc", "path": "TestFont/OFL.txt"}],
                "files": [
                    {
                        "source": "testsrc",
                        "from": "TestFont/TestFont-Regular.ttf",
                        "to": "One-Regular",
                    }
                ],
            },
            "two": {
                "name": "Two",
                "licence": [{"source": "testsrc", "path": "TestFont/OFL.txt"}],
                "files": [
                    {
                        "source": "testsrc",
                        "from": "TestFont/TestFont-Regular.ttf",
                        "to": "Two-Regular",
                    }
                ],
            },
        },
    }
    manifest_path = tmp_path / "upstream.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    out_dir = tmp_path / "out"

    fonts.build_fonts(manifest=manifest_path, out_dir=out_dir, cache_dir=cache_dir)

    one = (out_dir / "one" / "One-Regular.woff2").read_bytes()
    two = (out_dir / "two" / "Two-Regular.woff2").read_bytes()
    assert one == two


def test_sha256_mismatch_fails_and_removes_bad_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    archive_path, _real_sha256 = _make_fixture_zip(tmp_path)
    cache_dir = tmp_path / "cache"
    cache_dir.mkdir()
    manifest_path = _write_manifest(tmp_path, sha256="0" * 64)

    def fake_download(_url: str, dest: Path) -> None:
        dest.write_bytes(archive_path.read_bytes())

    monkeypatch.setattr(fonts, "_download", fake_download)

    with pytest.raises(fonts.BuildError, match="sha256 mismatch"):
        fonts.build_fonts(
            manifest=manifest_path, out_dir=tmp_path / "out", cache_dir=cache_dir
        )

    assert not (cache_dir / "testsrc").exists()
    assert not (cache_dir / "testsrc.tmp").exists()


def test_cached_file_reused_skips_download(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    archive_path, sha256 = _make_fixture_zip(tmp_path)
    cache_dir = tmp_path / "cache"
    cache_dir.mkdir()
    (cache_dir / "testsrc").write_bytes(archive_path.read_bytes())
    manifest_path = _write_manifest(tmp_path, sha256)

    calls = []

    def fake_download(url: str, dest: Path) -> None:
        calls.append(url)

    monkeypatch.setattr(fonts, "_download", fake_download)

    fonts.build_fonts(
        manifest=manifest_path, out_dir=tmp_path / "out", cache_dir=cache_dir
    )

    assert calls == []
    assert (tmp_path / "out" / "test" / "TestFont-Regular.woff2").exists()


def test_stale_cached_file_is_redownloaded(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    archive_path, sha256 = _make_fixture_zip(tmp_path)
    cache_dir = tmp_path / "cache"
    cache_dir.mkdir()
    # A stale cache entry with the wrong content (and thus the wrong sha256).
    (cache_dir / "testsrc").write_bytes(b"stale, wrong content")
    manifest_path = _write_manifest(tmp_path, sha256)

    calls = []

    def fake_download(_url: str, dest: Path) -> None:
        calls.append(_url)
        dest.write_bytes(archive_path.read_bytes())

    monkeypatch.setattr(fonts, "_download", fake_download)

    fonts.build_fonts(
        manifest=manifest_path, out_dir=tmp_path / "out", cache_dir=cache_dir
    )

    assert len(calls) == 1
    assert hashlib.sha256((cache_dir / "testsrc").read_bytes()).hexdigest() == sha256
    assert (tmp_path / "out" / "test" / "TestFont-Regular.woff2").exists()


def test_missing_archive_member_fails_with_clear_message(tmp_path: Path) -> None:
    archive_path, sha256 = _make_fixture_zip(tmp_path)
    cache_dir = tmp_path / "cache"
    cache_dir.mkdir()
    (cache_dir / "testsrc").write_bytes(archive_path.read_bytes())
    manifest_path = _write_manifest(
        tmp_path, sha256, from_member="TestFont/DoesNotExist.ttf"
    )

    with pytest.raises(fonts.BuildError, match=r"DoesNotExist\.ttf"):
        fonts.build_fonts(
            manifest=manifest_path, out_dir=tmp_path / "out", cache_dir=cache_dir
        )


def test_malformed_manifest_names_the_missing_key(tmp_path: Path) -> None:
    manifest_path = tmp_path / "upstream.json"
    manifest_path.write_text(
        json.dumps({"sources": {}, "fonts": {"test": {"files": []}}}),
        encoding="utf-8",
    )

    with pytest.raises(fonts.BuildError, match="licence"):
        fonts.build_fonts(
            manifest=manifest_path,
            out_dir=tmp_path / "out",
            cache_dir=tmp_path / "cache",
        )


@pytest.mark.parametrize("bad_id", ["../evil", "a/b", "a\\b"])
def test_unsafe_font_id_is_rejected(tmp_path: Path, bad_id: str) -> None:
    manifest_path = tmp_path / "upstream.json"
    manifest_path.write_text(
        json.dumps(
            {
                "sources": {},
                "fonts": {bad_id: {"licence": [], "files": []}},
            }
        ),
        encoding="utf-8",
    )

    with pytest.raises(fonts.BuildError, match="font id"):
        fonts.build_fonts(
            manifest=manifest_path,
            out_dir=tmp_path / "out",
            cache_dir=tmp_path / "cache",
        )


def test_plain_file_licence_source(tmp_path: Path) -> None:
    archive_path, archive_sha256 = _make_fixture_zip(tmp_path)
    licence_path = tmp_path / "LICENSE.md"
    # write_bytes avoids Windows' text-mode "\n" -> "\r\n" translation, which
    # would otherwise make the cached copy's sha256 differ across platforms.
    licence_path.write_bytes(OTHER_LICENCE_TEXT.encode("utf-8"))
    licence_sha256 = hashlib.sha256(licence_path.read_bytes()).hexdigest()

    cache_dir = tmp_path / "cache"
    cache_dir.mkdir()
    (cache_dir / "testsrc").write_bytes(archive_path.read_bytes())
    (cache_dir / "licencesrc").write_bytes(licence_path.read_bytes())

    manifest = {
        "sources": {
            "testsrc": {
                "kind": "zip",
                "url": "https://example.invalid/fixture-source.zip",
                "sha256": archive_sha256,
            },
            "licencesrc": {
                "kind": "file",
                "url": "https://example.invalid/LICENSE.md",
                "sha256": licence_sha256,
            },
        },
        "fonts": {
            "test": {
                "name": "Test Font",
                "licence": [{"source": "licencesrc"}],
                "files": [
                    {
                        "source": "testsrc",
                        "from": "TestFont/TestFont-Regular.ttf",
                        "to": "TestFont-Regular",
                    }
                ],
            }
        },
    }
    manifest_path = tmp_path / "upstream.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    out_dir = tmp_path / "out"

    fonts.build_fonts(manifest=manifest_path, out_dir=out_dir, cache_dir=cache_dir)

    licence_out = (out_dir / "test" / "OFL.txt").read_text(encoding="utf-8")
    assert licence_out.strip() == OTHER_LICENCE_TEXT.strip()


def test_licence_combines_two_sources(tmp_path: Path) -> None:
    archive_a, sha_a = _make_fixture_zip(tmp_path, name="a.zip")
    archive_b_path = tmp_path / "b.zip"
    with zipfile.ZipFile(archive_b_path, "w") as archive:
        archive.writestr("Other/Other-Regular.ttf", _make_test_font_bytes("Other"))
        archive.writestr("Other/OFL.txt", OTHER_LICENCE_TEXT)
    sha_b = hashlib.sha256(archive_b_path.read_bytes()).hexdigest()

    cache_dir = tmp_path / "cache"
    cache_dir.mkdir()
    (cache_dir / "a").write_bytes(archive_a.read_bytes())
    (cache_dir / "b").write_bytes(archive_b_path.read_bytes())

    manifest = {
        "sources": {
            "a": {
                "kind": "zip",
                "url": "https://example.invalid/a.zip",
                "sha256": sha_a,
            },
            "b": {
                "kind": "zip",
                "url": "https://example.invalid/b.zip",
                "sha256": sha_b,
            },
        },
        "fonts": {
            "combined": {
                "name": "Combined",
                "licence": [
                    {"source": "a", "path": "TestFont/OFL.txt"},
                    {"source": "b", "path": "Other/OFL.txt"},
                ],
                "files": [
                    {
                        "source": "a",
                        "from": "TestFont/TestFont-Regular.ttf",
                        "to": "Combined-Regular",
                    },
                    {
                        "source": "b",
                        "from": "Other/Other-Regular.ttf",
                        "to": "Combined-Other",
                    },
                ],
            }
        },
    }
    manifest_path = tmp_path / "upstream.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    out_dir = tmp_path / "out"

    fonts.build_fonts(manifest=manifest_path, out_dir=out_dir, cache_dir=cache_dir)

    licence_out = (out_dir / "combined" / "OFL.txt").read_text(encoding="utf-8")
    assert LICENCE_TEXT.strip() in licence_out
    assert OTHER_LICENCE_TEXT.strip() in licence_out


def test_output_directory_is_cleared_between_builds(tmp_path: Path) -> None:
    archive_path, sha256 = _make_fixture_zip(tmp_path)
    cache_dir = tmp_path / "cache"
    cache_dir.mkdir()
    (cache_dir / "testsrc").write_bytes(archive_path.read_bytes())
    manifest_path = _write_manifest(tmp_path, sha256)
    out_dir = tmp_path / "out"

    stale = out_dir / "test" / "Stale-Old.woff2"
    stale.parent.mkdir(parents=True)
    stale.write_bytes(b"stale")

    fonts.build_fonts(manifest=manifest_path, out_dir=out_dir, cache_dir=cache_dir)

    assert not stale.exists()
    assert (out_dir / "test" / "TestFont-Regular.woff2").exists()
