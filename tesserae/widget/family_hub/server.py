"""Family Hub data source (Tesserae widget plugin).

Fetches the wall payload from Family Hub with the device bearer. Never caches
on the happy path; on failure returns the last good payload marked stale so the
wall shows "Hub offline · last updated hh:mm" instead of an error string.
"""

from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any
from urllib.parse import quote

from app.plugin_http import fetch_json  # plain urllib; egress bounded by plugin.json requires


def _safe(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]+", "_", s) or "x"


def fetch(options: dict[str, Any], settings: dict[str, Any], *, ctx: dict[str, Any]) -> dict[str, Any]:
    base = str(options.get("base_url") or "http://family-hub:3000").rstrip("/")
    device = str(options.get("device") or "").strip()
    page = str(options.get("page") or "home").strip()
    token = str(options.get("token") or "")
    if not device:
        return {"error": "Family Hub: set a device id"}
    cache = Path(ctx["data_dir"]) / f"last_{_safe(device)}_{_safe(page)}.json"
    url = f"{base}/api/render/{quote(device)}/{quote(page)}.json"
    headers = {"Accept": "application/json", "Authorization": f"Bearer {token}"}
    try:
        payload = fetch_json(url, headers=headers, timeout=2, retries=0)
        out = {"payload": payload, "fetched_at": int(time.time()), "stale": False}
        try:
            cache.parent.mkdir(parents=True, exist_ok=True)
            cache.write_text(json.dumps(out), encoding="utf-8")
        except OSError:
            pass
        return out
    except Exception as err:  # serve last-good instead of an error cell
        reason = f"{type(err).__name__}: {err}"
        if cache.exists():
            try:
                out = json.loads(cache.read_text(encoding="utf-8"))
                out.update(stale=True, stale_reason=reason[:200])
                return out
            except (OSError, json.JSONDecodeError):
                pass
        return {"error": reason[:200]}
