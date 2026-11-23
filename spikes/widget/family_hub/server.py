from __future__ import annotations
import json, re, time
from pathlib import Path
from typing import Any
from urllib.parse import quote
from app.plugin_http import fetch_json

def _safe(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]+", "_", s) or "x"

def fetch(options: dict[str, Any], settings: dict[str, Any], *, ctx: dict[str, Any]) -> dict[str, Any]:
    base = str(settings.get("base_url") or "http://family-hub:3000").rstrip("/")
    token = str(settings.get("token") or "")
    device = str(options.get("device") or "").strip()
    page = str(options.get("page") or "home").strip()
    cache = Path(ctx["data_dir"]) / f"last_{_safe(device)}_{_safe(page)}.json"
    url = f"{base}/api/render/{quote(device)}/{quote(page)}.json"
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    t0 = time.time()
    try:
        payload = fetch_json(url, headers=headers, timeout=2, retries=0)
        out = {"payload": payload, "fetched_at": int(time.time()), "stale": False, "ms": int((time.time()-t0)*1000)}
        try:
            cache.parent.mkdir(parents=True, exist_ok=True)
            cache.write_text(json.dumps(out), encoding="utf-8")
        except OSError:
            pass
        return out
    except Exception as err:
        reason = f"{type(err).__name__}: {err}"
        if cache.exists():
            try:
                out = json.loads(cache.read_text(encoding="utf-8"))
                out.update(stale=True, stale_reason=reason)
                return out
            except (OSError, json.JSONDecodeError):
                pass
        return {"error": reason}
