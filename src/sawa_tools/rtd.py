"""`sawa rtd`: the Read the Docs report-only build steps (SAWA_PLAN.md §8.3).

Read the Docs has no `gh` CLI or token, so fetch_bundle reads the public,
unauthenticated GitHub REST API and release asset URLs directly.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import time
import zipfile
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

REPO = "adehad/sawa-font"
API_ROOT = f"https://api.github.com/repos/{REPO}/releases"
ASSET_NAME = "sawa-report-{tag}.zip"
USER_AGENT = "sawa-rtd-tools"
DEFAULT_TIMEOUT = 10.0
DEFAULT_RETRIES = 2

# Read the Docs' own names for the default-branch and stable-branch builds;
# both take the newest GitHub release's bundle.
LATEST_ALIASES = ("latest", "stable")

# A 403/429 with no rate-limit quota left is not worth retrying; anything
# else transient gets a short, increasing pause between attempts.
RATE_LIMIT_STATUSES = (403, 429)
RETRY_BACKOFF_SECONDS = (1.0, 2.0)


class RtdError(Exception):
    """Raised for a Read the Docs helper failure that should stop the build."""


def add_parsers(subparsers: argparse._SubParsersAction) -> None:
    fetch = subparsers.add_parser(
        "fetch-bundle",
        help="Download a release's report bundle from GitHub Releases",
    )
    fetch.add_argument(
        "--version",
        required=True,
        help="A release tag (e.g. v0.1.0), or 'latest'/'stable' for the newest release",
    )
    fetch.add_argument(
        "--out",
        type=Path,
        default=Path("report/current"),
        help="Directory to extract the bundle into (default: %(default)s)",
    )
    fetch.set_defaults(handler=run_fetch_bundle)

    base_path_cmd = subparsers.add_parser(
        "base-path",
        help="Print BASE_PATH from READTHEDOCS_CANONICAL_URL",
    )
    base_path_cmd.set_defaults(handler=run_base_path)

    copy = subparsers.add_parser(
        "copy-tree", help="Recursively copy a directory, replacing its destination"
    )
    copy.add_argument("src", type=Path)
    copy.add_argument("dst", type=Path)
    copy.set_defaults(handler=run_copy_tree)


def run_fetch_bundle(args: argparse.Namespace) -> int:
    try:
        found = fetch_bundle(args.version, args.out)
    except RtdError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    if found:
        print(f"wrote {args.out}")
    else:
        print(
            f"no report bundle for version {args.version!r}; "
            "the report page will say so"
        )
    return 0


def run_base_path(_args: argparse.Namespace) -> int:
    print(base_path(os.environ.get("READTHEDOCS_CANONICAL_URL")))
    return 0


def run_copy_tree(args: argparse.Namespace) -> int:
    try:
        copy_tree(args.src, args.dst)
    except RtdError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(f"copied {args.src} to {args.dst}")
    return 0


def base_path(canonical_url: str | None) -> str:
    """BASE_PATH from READTHEDOCS_CANONICAL_URL's path, e.g.

    https://sawa-font.readthedocs.io/en/v0.1.0/ -> /en/v0.1.0/. Falls back to
    '/' when the variable is unset, so a local build without it still works.
    """
    if not canonical_url:
        return "/"
    path = urlsplit(canonical_url).path
    if not path:
        return "/"
    if not path.startswith("/"):
        path = f"/{path}"
    if not path.endswith("/"):
        path = f"{path}/"
    return path


def copy_tree(src: Path, dst: Path) -> None:
    """Recursively copies `src` into `dst`, replacing any existing content."""
    _refuse_nested_paths(src, dst)
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst)


def _refuse_nested_paths(a: Path, b: Path) -> None:
    resolved_a, resolved_b = a.resolve(), b.resolve()
    if (
        resolved_a == resolved_b
        or resolved_a in resolved_b.parents
        or resolved_b in resolved_a.parents
    ):
        raise RtdError(f"refusing to copy {a} to {b}: one contains the other")


def _refuse_cwd_or_ancestor(path: Path) -> None:
    resolved = path.resolve()
    cwd = Path.cwd().resolve()
    if resolved == cwd or resolved in cwd.parents:
        raise RtdError(
            f"refusing to remove {resolved}: it is the working directory, "
            "or an ancestor of it"
        )


def fetch_bundle(
    version: str,
    out: Path,
    *,
    api_root: str = API_ROOT,
    timeout: float = DEFAULT_TIMEOUT,
    retries: int = DEFAULT_RETRIES,
) -> bool:
    """Downloads `version`'s report bundle asset into `out`.

    `version` is a release tag, or 'latest'/'stable', Read the Docs' names
    for the default-branch and stable-branch builds, which take the newest
    release's bundle. Returns False and writes nothing when the repository
    has no matching release, or that release has no report bundle asset, so
    the site build still succeeds and the report page shows its no-bundle
    message.
    """
    url = (
        f"{api_root}/latest"
        if version in LATEST_ALIASES
        else f"{api_root}/tags/{version}"
    )
    release = _get_json(url, timeout=timeout, retries=retries)
    if release is None:
        return False
    tag = release.get("tag_name") or version
    wanted = ASSET_NAME.format(tag=tag)
    asset = next(
        (a for a in release.get("assets", []) if a.get("name") == wanted), None
    )
    if asset is None:
        return False
    download_url = asset.get("browser_download_url")
    if not download_url:
        raise RtdError(f"release {tag} asset {wanted!r} has no download URL")
    data = _download(download_url, timeout=timeout, retries=retries)
    _safe_extract(data, out)
    return True


def _sleep_backoff(attempt: int) -> None:
    index = min(attempt, len(RETRY_BACKOFF_SECONDS) - 1)
    time.sleep(RETRY_BACKOFF_SECONDS[index])


def _format_reset(value: str | None) -> str:
    if not value:
        return "unknown"
    try:
        seconds = int(value)
    except ValueError:
        return "unknown"
    return datetime.fromtimestamp(seconds, tz=UTC).isoformat()


def _raise_if_rate_limited(url: str, exc: HTTPError) -> None:
    """Raises RtdError immediately for a rate limit with no quota left,
    rather than burning retries on a request that cannot succeed sooner.
    """
    if exc.code not in RATE_LIMIT_STATUSES:
        return
    headers = exc.headers
    remaining = headers.get("X-RateLimit-Remaining") if headers else None
    if remaining != "0":
        return
    reset = _format_reset(headers.get("X-RateLimit-Reset") if headers else None)
    raise RtdError(
        f"GitHub API rate limit exceeded fetching {url}; resets at {reset}"
    ) from exc


def _get_json(url: str, *, timeout: float, retries: int) -> dict[str, Any] | None:
    request = Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/vnd.github+json",
        },
    )
    last_error: BaseException | None = None
    for attempt in range(retries + 1):
        try:
            with urlopen(request, timeout=timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            if exc.code == 404:
                return None
            _raise_if_rate_limited(url, exc)
            last_error = exc
        except (URLError, TimeoutError, OSError) as exc:
            last_error = exc
        if attempt < retries:
            _sleep_backoff(attempt)
    raise RtdError(f"failed to fetch {url}: {last_error}")


def _download(url: str, *, timeout: float, retries: int) -> bytes:
    request = Request(url, headers={"User-Agent": USER_AGENT})
    last_error: BaseException | None = None
    for attempt in range(retries + 1):
        try:
            with urlopen(request, timeout=timeout) as response:
                return response.read()
        except HTTPError as exc:
            _raise_if_rate_limited(url, exc)
            last_error = exc
        except (URLError, TimeoutError, OSError) as exc:
            last_error = exc
        if attempt < retries:
            _sleep_backoff(attempt)
    raise RtdError(f"failed to download {url}: {last_error}")


def _is_safe_member(name: str) -> bool:
    normalized = name.replace("\\", "/")
    if normalized.startswith("/"):
        return False
    if len(normalized) > 1 and normalized[1] == ":":
        return False
    return ".." not in PurePosixPath(normalized).parts


def _safe_extract(data: bytes, out: Path) -> None:
    with zipfile.ZipFile(BytesIO(data)) as archive:
        for name in archive.namelist():
            if not _is_safe_member(name):
                raise RtdError(f"unsafe path in report bundle archive: {name!r}")
        _refuse_cwd_or_ancestor(out)
        if out.exists():
            shutil.rmtree(out)
        out.mkdir(parents=True)
        archive.extractall(out)
