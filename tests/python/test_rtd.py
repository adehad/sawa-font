from __future__ import annotations

import argparse
import json
import zipfile
from collections.abc import Iterator
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from pathlib import Path
from threading import Thread

import pytest

from sawa_tools.rtd import RtdError, base_path, copy_tree, fetch_bundle, run_copy_tree

Routes = dict[str, tuple[int, bytes, str, dict[str, str]]]


@pytest.fixture(autouse=True)
def _no_real_sleep(monkeypatch: pytest.MonkeyPatch) -> None:
    """The retry backoff is real (1s, 2s); tests only check attempt counts."""
    monkeypatch.setattr("sawa_tools.rtd.time.sleep", lambda _seconds: None)


def _zip_bytes(files: dict[str, bytes]) -> bytes:
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, data in files.items():
            archive.writestr(name, data)
    return buffer.getvalue()


_BUNDLE = _zip_bytes(
    {
        "manifest.json": b'{"version": "v0.2.0"}',
        "tests/fatiha-1/test.json": b"{}",
    }
)


def _route(
    status: int, body: bytes, content_type: str, headers: dict[str, str] | None = None
) -> tuple[int, bytes, str, dict[str, str]]:
    return (status, body, content_type, headers or {})


@contextmanager
def _fixture_server(routes: Routes) -> Iterator[str]:
    """A local HTTP server serving `routes` (path -> (status, body, type, headers)).

    `routes` is read live on each request, so a route referring to the
    server's own origin can be added after the server (and its ephemeral
    port) already exists.
    """

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            route = routes.get(self.path)
            if route is None:
                self.send_response(404)
                self.end_headers()
                self.wfile.write(b"{}")
                return
            status, body, content_type, headers = route
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            for name, value in headers.items():
                self.send_header(name, value)
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format: str, *args: object) -> None:
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}"
    finally:
        server.shutdown()
        thread.join()


def _release_json(tag: str, asset_name: str | None, download_url: str) -> bytes:
    assets = (
        [{"name": asset_name, "browser_download_url": download_url}]
        if asset_name
        else []
    )
    return json.dumps({"tag_name": tag, "assets": assets}).encode("utf-8")


def test_base_path_from_canonical_url() -> None:
    assert base_path("https://sawa-font.readthedocs.io/en/v0.1.0/") == "/en/v0.1.0/"
    assert base_path("https://sawa-font.readthedocs.io/en/latest") == "/en/latest/"
    assert base_path(None) == "/"
    assert base_path("") == "/"


def test_copy_tree_replaces_existing_content(tmp_path: Path) -> None:
    src = tmp_path / "src"
    (src / "nested").mkdir(parents=True)
    (src / "a.txt").write_text("a", encoding="utf-8")
    (src / "nested" / "b.txt").write_text("b", encoding="utf-8")

    dst = tmp_path / "dst"
    dst.mkdir()
    (dst / "stale.txt").write_text("stale", encoding="utf-8")

    copy_tree(src, dst)

    assert (dst / "a.txt").read_text(encoding="utf-8") == "a"
    assert (dst / "nested" / "b.txt").read_text(encoding="utf-8") == "b"
    assert not (dst / "stale.txt").exists()


def test_copy_tree_refuses_the_same_path(tmp_path: Path) -> None:
    same = tmp_path / "same"
    same.mkdir()
    with pytest.raises(RtdError):
        copy_tree(same, same)


def test_copy_tree_refuses_when_dst_is_inside_src(tmp_path: Path) -> None:
    src = tmp_path / "src"
    src.mkdir()
    with pytest.raises(RtdError):
        copy_tree(src, src / "nested")


def test_copy_tree_refuses_when_src_is_inside_dst(tmp_path: Path) -> None:
    dst = tmp_path / "dst"
    dst.mkdir()
    with pytest.raises(RtdError):
        copy_tree(dst / "nested", dst)


def test_run_copy_tree_returns_1_and_prints_on_refusal(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    same = tmp_path / "same"
    same.mkdir()
    args = argparse.Namespace(src=same, dst=same)

    assert run_copy_tree(args) == 1
    assert "error:" in capsys.readouterr().err


def test_fetch_bundle_downloads_a_tagged_release(tmp_path: Path) -> None:
    routes: Routes = {}
    with _fixture_server(routes) as origin:
        routes["/tags/v0.2.0"] = _route(
            200,
            _release_json(
                "v0.2.0", "sawa-report-v0.2.0.zip", f"{origin}/download/bundle.zip"
            ),
            "application/json",
        )
        routes["/download/bundle.zip"] = _route(200, _BUNDLE, "application/zip")

        out = tmp_path / "current"
        found = fetch_bundle("v0.2.0", out, api_root=origin)

    assert found is True
    assert (out / "manifest.json").read_text(
        encoding="utf-8"
    ) == '{"version": "v0.2.0"}'
    assert (out / "tests" / "fatiha-1" / "test.json").exists()


@pytest.mark.parametrize("version", ["latest", "stable"])
def test_fetch_bundle_latest_and_stable_use_the_releases_latest_endpoint(
    tmp_path: Path, version: str
) -> None:
    routes: Routes = {}
    with _fixture_server(routes) as origin:
        routes["/latest"] = _route(
            200,
            _release_json(
                "v0.3.0", "sawa-report-v0.3.0.zip", f"{origin}/download/bundle.zip"
            ),
            "application/json",
        )
        routes["/download/bundle.zip"] = _route(200, _BUNDLE, "application/zip")

        out = tmp_path / "current"
        found = fetch_bundle(version, out, api_root=origin)

    assert found is True
    assert (out / "manifest.json").exists()


def test_fetch_bundle_with_no_matching_release_writes_nothing(tmp_path: Path) -> None:
    with _fixture_server({}) as origin:
        out = tmp_path / "current"
        found = fetch_bundle("v9.9.9", out, api_root=origin)

    assert found is False
    assert not out.exists()


def test_fetch_bundle_with_no_asset_on_the_release_writes_nothing(
    tmp_path: Path,
) -> None:
    routes: Routes = {
        "/tags/v0.4.0": _route(
            200, _release_json("v0.4.0", None, ""), "application/json"
        ),
    }
    with _fixture_server(routes) as origin:
        out = tmp_path / "current"
        found = fetch_bundle("v0.4.0", out, api_root=origin)

    assert found is False
    assert not out.exists()


def test_fetch_bundle_rejects_a_zip_with_a_path_traversal_entry(tmp_path: Path) -> None:
    malicious = _zip_bytes({"../evil.txt": b"pwned"})
    routes: Routes = {}
    with _fixture_server(routes) as origin:
        routes["/tags/v0.5.0"] = _route(
            200,
            _release_json(
                "v0.5.0", "sawa-report-v0.5.0.zip", f"{origin}/download/evil.zip"
            ),
            "application/json",
        )
        routes["/download/evil.zip"] = _route(200, malicious, "application/zip")

        out = tmp_path / "current"
        with pytest.raises(RtdError):
            fetch_bundle("v0.5.0", out, api_root=origin)

    assert not out.exists()


@pytest.mark.parametrize(
    ("label", "member"),
    [("an absolute path", "/abs.txt"), ("a Windows drive-relative path", "C:evil.txt")],
)
def test_fetch_bundle_rejects_other_unsafe_zip_members(
    tmp_path: Path, label: str, member: str
) -> None:
    malicious = _zip_bytes({member: b"pwned"})
    routes: Routes = {}
    with _fixture_server(routes) as origin:
        routes["/tags/v0.5.1"] = _route(
            200,
            _release_json(
                "v0.5.1", "sawa-report-v0.5.1.zip", f"{origin}/download/evil.zip"
            ),
            "application/json",
        )
        routes["/download/evil.zip"] = _route(200, malicious, "application/zip")

        out = tmp_path / "current"
        with pytest.raises(RtdError):
            fetch_bundle("v0.5.1", out, api_root=origin)

    assert not out.exists(), label


def test_fetch_bundle_retries_a_transient_server_error(tmp_path: Path) -> None:
    routes: Routes = {}
    attempts = {"tags": 0}

    class FlakyHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            if self.path == "/tags/v0.6.0":
                attempts["tags"] += 1
                if attempts["tags"] < 2:
                    self.send_response(500)
                    self.end_headers()
                    return
            route = routes.get(self.path)
            if route is None:
                self.send_response(404)
                self.end_headers()
                return
            status, body, content_type, headers = route
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            for name, value in headers.items():
                self.send_header(name, value)
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format: str, *args: object) -> None:
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), FlakyHandler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = f"http://127.0.0.1:{server.server_port}"
    routes["/tags/v0.6.0"] = _route(
        200,
        _release_json(
            "v0.6.0", "sawa-report-v0.6.0.zip", f"{origin}/download/bundle.zip"
        ),
        "application/json",
    )
    routes["/download/bundle.zip"] = _route(200, _BUNDLE, "application/zip")
    try:
        out = tmp_path / "current"
        found = fetch_bundle("v0.6.0", out, api_root=origin, retries=2, timeout=2.0)
    finally:
        server.shutdown()
        thread.join()

    assert found is True
    assert attempts["tags"] == 2
    assert (out / "manifest.json").exists()


def test_fetch_bundle_gives_up_after_retries_are_exhausted(tmp_path: Path) -> None:
    class AlwaysFailingHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            self.send_response(500)
            self.end_headers()

        def log_message(self, format: str, *args: object) -> None:
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), AlwaysFailingHandler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = f"http://127.0.0.1:{server.server_port}"
    try:
        out = tmp_path / "current"
        with pytest.raises(RtdError):
            fetch_bundle("v0.7.0", out, api_root=origin, retries=1, timeout=2.0)
    finally:
        server.shutdown()
        thread.join()

    assert not out.exists()


def test_fetch_bundle_fails_fast_on_an_exhausted_rate_limit(tmp_path: Path) -> None:
    attempts = {"tags": 0}

    class RateLimitedHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            attempts["tags"] += 1
            self.send_response(403)
            self.send_header("Content-Type", "application/json")
            self.send_header("X-RateLimit-Remaining", "0")
            self.send_header("X-RateLimit-Reset", "1700000000")
            self.end_headers()
            self.wfile.write(b"{}")

        def log_message(self, format: str, *args: object) -> None:
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), RateLimitedHandler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = f"http://127.0.0.1:{server.server_port}"
    try:
        out = tmp_path / "current"
        with pytest.raises(RtdError, match="rate limit") as exc_info:
            fetch_bundle("v0.8.0", out, api_root=origin, retries=2, timeout=2.0)
    finally:
        server.shutdown()
        thread.join()

    # No retries burned on a request that cannot succeed sooner.
    assert attempts["tags"] == 1
    assert "2023-11-14" in str(exc_info.value)
    assert not out.exists()


def test_fetch_bundle_refuses_to_remove_the_working_directory(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    routes: Routes = {}
    with _fixture_server(routes) as origin:
        routes["/tags/v0.9.0"] = _route(
            200,
            _release_json(
                "v0.9.0", "sawa-report-v0.9.0.zip", f"{origin}/download/bundle.zip"
            ),
            "application/json",
        )
        routes["/download/bundle.zip"] = _route(200, _BUNDLE, "application/zip")

        marker = tmp_path / "marker.txt"
        marker.write_text("keep me", encoding="utf-8")
        monkeypatch.chdir(tmp_path)

        with pytest.raises(RtdError):
            fetch_bundle("v0.9.0", tmp_path, api_root=origin)

    assert marker.exists()


def test_fetch_bundle_refuses_to_remove_an_ancestor_of_the_working_directory(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    routes: Routes = {}
    with _fixture_server(routes) as origin:
        routes["/tags/v0.10.0"] = _route(
            200,
            _release_json(
                "v0.10.0", "sawa-report-v0.10.0.zip", f"{origin}/download/bundle.zip"
            ),
            "application/json",
        )
        routes["/download/bundle.zip"] = _route(200, _BUNDLE, "application/zip")

        marker = tmp_path / "marker.txt"
        marker.write_text("keep me", encoding="utf-8")
        sub = tmp_path / "sub"
        sub.mkdir()
        monkeypatch.chdir(sub)

        with pytest.raises(RtdError):
            fetch_bundle("v0.10.0", tmp_path, api_root=origin)

    assert marker.exists()
