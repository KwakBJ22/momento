"""Measure album API latency (needs Supabase env via `railway run`)."""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request

API = os.environ.get("MOMENTO_API_BASE", "https://momento-api-production.up.railway.app").rstrip("/")
ADMIN_EMAIL = os.environ.get("MOMENTO_ADMIN_EMAIL", "kbjkwak@gmail.com")
ALBUM_ID = os.environ.get("MOMENTO_SAMPLE_ALBUM_ID", "")


def http(
    method: str,
    url: str,
    headers: dict | None = None,
    body: dict | None = None,
) -> tuple[float, int]:
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={**(headers or {}), "Content-Type": "application/json"},
    )
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            resp.read()
            return round((time.perf_counter() - started) * 1000), resp.status
    except urllib.error.HTTPError as exc:
        exc.read()
        return round((time.perf_counter() - started) * 1000), exc.code


def access_token() -> str:
    base = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    _, payload = _json_post(
        f"{base}/auth/v1/admin/generate_link",
        {"apikey": key, "Authorization": f"Bearer {key}"},
        {"type": "magiclink", "email": ADMIN_EMAIL},
    )
    props = payload.get("properties") or payload
    _, token_payload = _json_post(
        f"{base}/auth/v1/verify",
        {"apikey": key},
        {"type": "magiclink", "token_hash": props["hashed_token"]},
    )
    return str(token_payload["access_token"])


def _json_post(url: str, headers: dict, body: dict) -> tuple[int, dict]:
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method="POST", headers={**headers, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return resp.status, json.loads(resp.read().decode() or "{}")


def resolve_album_id(token: str) -> str:
    if ALBUM_ID:
        return ALBUM_ID
    req = urllib.request.Request(
        f"{API}/api/albums/mine",
        headers={"Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        albums = json.loads(resp.read().decode()).get("albums") or []
    if not albums:
        raise RuntimeError("no albums for sample user")
    return str(albums[0]["album_id"])


def measure(label: str, path: str, token: str) -> None:
    headers = {"Authorization": f"Bearer {token}"}
    runs: list[int] = []
    for index in range(2):
        ms, status = http("GET", f"{API}{path}", headers=headers)
        runs.append(ms)
        print(f"{label} run{index + 1}: {ms}ms status={status}")
    print(f"{label} avg: {sum(runs) // len(runs)}ms\n")


def main() -> int:
    token = access_token()
    album_id = resolve_album_id(token)
    print(f"API={API} album_id={album_id}\n")
    measure("GET /albums/{{id}}", f"/api/albums/{album_id}", token)
    measure("GET /albums/{{id}}/photos", f"/api/albums/{album_id}/photos", token)
    measure("GET /albums/{{id}}/collaboration", f"/api/albums/{album_id}/collaboration", token)
    return 0


if __name__ == "__main__":
    sys.exit(main())
