"""fontbakery/index.html: Fontbakery's universal profile over the Sawa TTFs."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import time
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape

PROFILE = "check-universal"
# ttx_roundtrip alone takes about ten minutes on the Sawa variable fonts,
# against about a minute and a half for every other universal check.
EXCLUDED = ("ttx_roundtrip",)
STATUSES = ("PASS", "SKIP", "INFO", "WARN", "FAIL", "FATAL", "ERROR")


class FontbakeryError(Exception):
    """Raised when Fontbakery exits without writing its report."""


def fontbakery_version() -> str | None:
    try:
        return version("fontbakery")
    except PackageNotFoundError:
        return None


def _run_one(ttf: Path, html: Path) -> dict[str, int]:
    html.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        json_path = Path(tmp) / "fontbakery.json"
        # Exit status 1 means some check failed, which is a result, not an error.
        completed = subprocess.run(
            [
                sys.executable,
                "-m",
                "fontbakery",
                PROFILE,
                "--skip-network",
                *(arg for check in EXCLUDED for arg in ("--exclude-checkid", check)),
                "--html",
                str(html),
                "--json",
                str(json_path),
                str(ttf),
            ],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
        if not json_path.exists():
            tail = (completed.stderr or completed.stdout)[-2000:]
            raise FontbakeryError(f"fontbakery wrote no report for {ttf}:\n{tail}")
        data = json.loads(json_path.read_text(encoding="utf-8"))
    result = data.get("result") if isinstance(data, dict) else None
    if not isinstance(result, dict):
        raise FontbakeryError(f"fontbakery's JSON for {ttf} has no 'result' counts")
    return {status: int(result.get(status, 0)) for status in STATUSES}


def index_html(families: dict[str, dict[str, Any]]) -> str:
    """A page linking each family's report, with its status counts."""
    head = "".join(f"<th>{status}</th>" for status in STATUSES)
    rows = "".join(
        f'<tr><td><a href="{escape(fid)}/index.html">{escape(fid)}</a></td>'
        + "".join(f"<td>{summary['counts'][s]}</td>" for s in STATUSES)
        + "</tr>"
        for fid, summary in families.items()
    )
    return (
        '<!doctype html><html lang="en"><meta charset="utf-8">'
        "<title>Fontbakery</title>"
        f"<h1>Fontbakery {escape(PROFILE)}</h1>"
        f"<p>Excluded checks: {escape(', '.join(EXCLUDED))}</p>"
        f"<table><thead><tr><th>Family</th>{head}</tr></thead>"
        f"<tbody>{rows}</tbody></table></html>\n"
    )


def run_fontbakery(ttfs: dict[str, Path], out_dir: Path) -> dict[str, Any]:
    """Runs Fontbakery once per family into `out_dir`/<family>/index.html,
    writes `out_dir`/index.html and returns the manifest's summary.
    """
    if fontbakery_version() is None:
        return {"ran": False, "reason": "fontbakery is not installed"}
    families: dict[str, dict[str, Any]] = {}
    for family_id, ttf in ttfs.items():
        start = time.monotonic()
        counts = _run_one(ttf, out_dir / family_id / "index.html")
        families[family_id] = {
            "counts": counts,
            "seconds": round(time.monotonic() - start, 1),
            "report": f"fontbakery/{family_id}/index.html",
        }
    (out_dir / "index.html").write_text(index_html(families), encoding="utf-8")
    return {
        "ran": True,
        "profile": PROFILE,
        "excluded": list(EXCLUDED),
        "version": fontbakery_version(),
        "report": "fontbakery/index.html",
        "families": families,
    }
