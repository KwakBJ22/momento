"""Provider-neutral album asset storage.

Database rows store bucket + object path only.  Application code uses this
service for every object operation so a future S3 provider replaces one class,
not album, sharing, PDF, or upload flows.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Protocol

from supabase import Client

from app.config import Settings

logger = logging.getLogger(__name__)


class StorageProvider(Protocol):
    def upload(self, bucket: str, path: str, content: bytes, *, content_type: str, upsert: bool = False) -> None: ...
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

    def upload(self, bucket: str, path: str, content: bytes, *, content_type: str, upsert: bool = False) -> None:
        self.client.storage.from_(bucket).upload(path, content, file_options={"content-type": content_type, "upsert": str(upsert).lower()})

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

    def upload(self, bucket: str, path: str, content: bytes, *, content_type: str, upsert: bool = False) -> None:
        self.provider.upload(bucket, path, content, content_type=content_type, upsert=upsert)

    def delete(self, bucket: str, paths: list[str]) -> None:
        self.provider.delete(bucket, [path for path in paths if path])

    def download(self, bucket: str, path: str) -> bytes:
        return self.provider.download(bucket, path)

    def create_signed_url(self, bucket: str, path: str, expires_in: int | None = None) -> str:
        return self.provider.signed_url(bucket, path, expires_in or self.signed_url_ttl_seconds)

    def create_signed_urls(self, bucket: str, paths: list[str], expires_in: int | None = None) -> list[dict[str, Any]]:
        return self.provider.signed_urls(bucket, paths, expires_in or self.signed_url_ttl_seconds)

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


def album_photo_paths(family_scope_id: str, album_id: str, photo_id: str, extension: str) -> tuple[str, str]:
    base = f"albums/{album_id}/photos/{photo_id}"
    return f"{base}/original.{extension}", f"{base}/thumbnail.webp"


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
