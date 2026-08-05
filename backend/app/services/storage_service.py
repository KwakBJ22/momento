"""Provider-neutral album asset storage.

Database rows store bucket + object path only.  Application code uses this
service for every object operation so a future S3 provider replaces one class,
not album, sharing, PDF, or upload flows.
"""
from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Protocol

from supabase import Client

from app.config import Settings

logger = logging.getLogger(__name__)

# In-process signed-URL cache.
#
# Supabase signs every create_signed_url call with the request timestamp (`iat`), so two
# calls in different seconds return different URLs for the same object. Different URLs
# mean the CDN treats every view as a new resource — 100% uncached traffic at 3x the
# cached rate. Re-serving the same URL while it is still fresh lets the CDN cache hit.
#
# Callers build a fresh StorageService per request (see get_signed_url /
# get_signed_urls_batch), so the cache must be process-wide, not per-instance.
#
# key: (bucket, path) → value: (url, expires_at_epoch, ttl_at_issue_seconds)
_SIGNED_URL_CACHE: dict[tuple[str, str], tuple[str, float, int]] = {}
_SIGNED_URL_CACHE_LOCK = threading.Lock()
# Hard cap so the cache cannot grow without bound (memory leak); expired entries are
# evicted first, then the earliest-expiring ones.
_SIGNED_URL_CACHE_MAX = 5000
# ★ Reuse only while the URL still has more than half of the requested TTL left.
# Serving a nearly-expired URL breaks the user's photos mid-view — this happened in
# production before. Below 50%, issue a fresh URL and refresh the cache.
_SIGNED_URL_REUSE_FRACTION = 0.5


def _cache_get(bucket: str, path: str, expires_in: int) -> str | None:
    with _SIGNED_URL_CACHE_LOCK:
        entry = _SIGNED_URL_CACHE.get((bucket, path))
        if not entry:
            return None
        url, expires_at, _ttl = entry
        if expires_at - time.time() > expires_in * _SIGNED_URL_REUSE_FRACTION:
            return url
        return None


def _cache_put(bucket: str, path: str, url: str, expires_in: int) -> None:
    if not url:
        return
    now = time.time()
    with _SIGNED_URL_CACHE_LOCK:
        if len(_SIGNED_URL_CACHE) >= _SIGNED_URL_CACHE_MAX:
            expired = [key for key, (_u, expires_at, _t) in _SIGNED_URL_CACHE.items() if expires_at <= now]
            for key in expired:
                _SIGNED_URL_CACHE.pop(key, None)
            while len(_SIGNED_URL_CACHE) >= _SIGNED_URL_CACHE_MAX:
                earliest = min(_SIGNED_URL_CACHE, key=lambda key: _SIGNED_URL_CACHE[key][1])
                _SIGNED_URL_CACHE.pop(earliest, None)
        _SIGNED_URL_CACHE[(bucket, path)] = (url, now + expires_in, expires_in)


def _cache_invalidate(bucket: str, paths: list[str]) -> None:
    with _SIGNED_URL_CACHE_LOCK:
        for path in paths:
            _SIGNED_URL_CACHE.pop((bucket, path), None)


def clear_signed_url_cache() -> None:
    """Test hook: reset the process-wide signed-URL cache."""
    with _SIGNED_URL_CACHE_LOCK:
        _SIGNED_URL_CACHE.clear()


# Objects are stored under photo_id-derived paths and their content is effectively
# immutable (a regenerated derivative renders the same image), so browsers and the CDN
# may cache for a long time. Without this every object is stored as no-cache and every
# view is a fresh download. Value is SECONDS — storage3 itself renders "max-age={n}".
_CACHE_CONTROL_SECONDS = str(30 * 24 * 3600)  # 30 days


class StorageProvider(Protocol):
    def upload(self, bucket: str, path: str, content: bytes, *, content_type: str, upsert: bool = False, cache_control: str = _CACHE_CONTROL_SECONDS) -> None: ...
    def delete(self, bucket: str, paths: list[str]) -> None: ...
    def download(self, bucket: str, path: str) -> bytes: ...
    def signed_url(self, bucket: str, path: str, expires_in: int) -> str: ...
    def signed_urls(self, bucket: str, paths: list[str], expires_in: int) -> list[dict[str, Any]]: ...
    def list(self, bucket: str, prefix: str) -> list[dict[str, Any]]: ...
    def move(self, bucket: str, source: str, destination: str) -> None: ...
    def copy(self, bucket: str, source: str, destination: str) -> None: ...


class SupabaseStorageProvider:
    """The current implementation; this is the only class using client.storage."""

    def __init__(self, client: Client):
        self.client = client

    def upload(self, bucket: str, path: str, content: bytes, *, content_type: str, upsert: bool = False, cache_control: str = _CACHE_CONTROL_SECONDS) -> None:
        self.client.storage.from_(bucket).upload(path, content, file_options={
            "content-type": content_type,
            "upsert": str(upsert).lower(),
            # storage3 turns this seconds value into "max-age={n}" (header + metadata).
            "cache-control": cache_control,
        })

    def delete(self, bucket: str, paths: list[str]) -> None:
        if paths:
            self.client.storage.from_(bucket).remove(paths)

    def download(self, bucket: str, path: str) -> bytes:
        return self.client.storage.from_(bucket).download(path)

    def signed_url(self, bucket: str, path: str, expires_in: int) -> str:
        response = self.client.storage.from_(bucket).create_signed_url(path, expires_in)
        if isinstance(response, dict):
            return str(response.get("signedURL") or response.get("signedUrl") or "")
        return str(response)

    def signed_urls(self, bucket: str, paths: list[str], expires_in: int) -> list[dict[str, Any]]:
        return list(self.client.storage.from_(bucket).create_signed_urls(paths, expires_in) or [])

    def list(self, bucket: str, prefix: str) -> list[dict[str, Any]]:
        return list(self.client.storage.from_(bucket).list(prefix) or [])

    def move(self, bucket: str, source: str, destination: str) -> None:
        self.client.storage.from_(bucket).move(source, destination)

    def copy(self, bucket: str, source: str, destination: str) -> None:
        self.client.storage.from_(bucket).copy(source, destination)


@dataclass(frozen=True)
class StorageService:
    provider: StorageProvider
    signed_url_ttl_seconds: int

    @classmethod
    def for_supabase(cls, client: Client, settings: Settings) -> "StorageService":
        return cls(SupabaseStorageProvider(client), int(getattr(settings, "signed_url_ttl_seconds", 300)))

    def upload(self, bucket: str, path: str, content: bytes, *, content_type: str, upsert: bool = False, cache_control: str = _CACHE_CONTROL_SECONDS) -> None:
        self.provider.upload(bucket, path, content, content_type=content_type, upsert=upsert, cache_control=cache_control)
        # The signed-URL cache assumes "same path = same content". An upsert replaces
        # the content under an existing path, so a cached URL (and the CDN entry behind
        # it) would keep serving the OLD image for up to half the TTL — drop it.
        if upsert:
            _cache_invalidate(bucket, [path])

    def delete(self, bucket: str, paths: list[str]) -> None:
        existing = [path for path in paths if path]
        self.provider.delete(bucket, existing)
        # A cached URL for a deleted object would 404 (or serve a stale CDN copy).
        _cache_invalidate(bucket, existing)

    def download(self, bucket: str, path: str) -> bytes:
        return self.provider.download(bucket, path)

    def create_signed_url(self, bucket: str, path: str, expires_in: int | None = None) -> str:
        ttl = expires_in or self.signed_url_ttl_seconds
        cached = _cache_get(bucket, path, ttl)
        if cached is not None:
            return cached
        url = self.provider.signed_url(bucket, path, ttl)
        _cache_put(bucket, path, url, ttl)
        return url

    def create_signed_urls(self, bucket: str, paths: list[str], expires_in: int | None = None) -> list[dict[str, Any]]:
        ttl = expires_in or self.signed_url_ttl_seconds
        # Serve cached entries and only ask Supabase for the misses.
        hits: list[dict[str, Any]] = []
        misses: list[str] = []
        for path in paths:
            cached = _cache_get(bucket, path, ttl)
            if cached is not None:
                # Same row shape as the provider response (consumers read path + signedURL).
                hits.append({"path": path, "signedURL": cached, "signedUrl": cached, "error": None})
            else:
                misses.append(path)
        fresh: list[dict[str, Any]] = []
        if misses:
            fresh = list(self.provider.signed_urls(bucket, misses, ttl) or [])
            for row in fresh:
                if not isinstance(row, dict) or row.get("error"):
                    continue
                row_path = str(row.get("path") or "")
                row_url = str(row.get("signedURL") or row.get("signedUrl") or "")
                if row_path and row_url:
                    _cache_put(bucket, row_path, row_url, ttl)
        return hits + fresh

    def list(self, bucket: str, prefix: str = "") -> list[dict[str, Any]]:
        return self.provider.list(bucket, prefix)

    def list_recursive(self, bucket: str, prefix: str = "") -> list[dict[str, Any]]:
        """Return file entries below a prefix without treating folders as files."""
        files: list[dict[str, Any]] = []
        normalized_prefix = prefix.strip("/")
        for item in self.list(bucket, normalized_prefix):
            name = str(item.get("name") or "").strip("/")
            if not name:
                continue
            path = "/".join(part for part in (normalized_prefix, name) if part)
            # Supabase folder placeholders do not carry an object id/metadata.
            if item.get("id") or item.get("metadata") is not None:
                files.append({**item, "path": path})
            else:
                files.extend(self.list_recursive(bucket, path))
        return files

    def file_exists(self, bucket: str, path: str) -> bool:
        normalized = path.strip("/")
        if not normalized:
            return False
        parent, _, name = normalized.rpartition("/")
        return any(str(item.get("name") or "") == name for item in self.list(bucket, parent))

    def move(self, bucket: str, source: str, destination: str) -> None:
        self.provider.move(bucket, source, destination)

    def copy(self, bucket: str, source: str, destination: str) -> None:
        self.provider.copy(bucket, source, destination)


def album_photo_paths(family_scope_id: str, album_id: str, photo_id: str, extension: str) -> tuple[str, str, str]:
    base = f"albums/{album_id}/photos/{photo_id}"
    return f"{base}/original.{extension}", f"{base}/display.webp", f"{base}/thumbnail.webp"


def album_media_paths(album_id: str, media_id: str, has_preview: bool, has_thumbnail: bool) -> tuple[str, str | None, str | None]:
    base = f"albums/{album_id}/media/{media_id}"
    return f"{base}/original", f"{base}/preview" if has_preview else None, f"{base}/thumbnail.webp" if has_thumbnail else None


def album_result_path(album_id: str, asset_id: str) -> str:
    return f"albums/{album_id}/results/{asset_id}.png"


def album_pdf_path(album_id: str, asset_id: str) -> str:
    return f"albums/{album_id}/pdf/{asset_id}.pdf"


def cleanup_temporary_uploads(
    storage: StorageService,
    bucket: str,
    album_id: str,
    *,
    minimum_age_hours: int = 24,
    dry_run: bool = True,
) -> list[str]:
    """Return only aged temp candidates; callers must explicitly opt in to deletion."""
    prefix = f"albums/{album_id}/temp"
    cutoff = datetime.now(timezone.utc) - timedelta(hours=minimum_age_hours)
    candidates: list[str] = []
    for item in storage.list_recursive(bucket, prefix):
        timestamp = str(item.get("updated_at") or item.get("created_at") or "")
        try:
            created_at = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        except ValueError:
            # Missing timestamps are not safe to delete automatically.
            continue
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        if item.get("path") and created_at <= cutoff:
            candidates.append(str(item["path"]))
    if not dry_run:
        storage.delete(bucket, candidates)
    return candidates


def cleanup_orphan_assets(
    storage: StorageService,
    bucket: str,
    known_paths: set[str],
    *,
    prefix: str = "albums",
    exclude_prefixes: tuple[str, ...] = (),
    dry_run: bool = True,
) -> list[str]:
    """Identify orphan files for an explicit maintenance job.

    Cleanup is never implicit and callers can keep temporary uploads in their
    own retention job with ``exclude_prefixes``.
    """
    candidates = [
        str(item["path"])
        for item in storage.list_recursive(bucket, prefix)
        if item.get("path")
        and str(item["path"]) not in known_paths
        and not any(str(item["path"]).startswith(excluded.rstrip("/") + "/") for excluded in exclude_prefixes)
    ]
    if not dry_run:
        storage.delete(bucket, candidates)
    return candidates
