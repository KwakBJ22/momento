"""Read-only checks and explicitly triggered storage maintenance operations."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from app.config import Settings
from app.services.storage_service import StorageService
from app.services.supabase import (
    cleanup_album_files,
    cleanup_album_orphans,
    cleanup_temporary_album_uploads,
)

logger = logging.getLogger(__name__)


def _list_albums(client: Any, *, album_id: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
    query = client.table("albums").select("id,result_path,result_bucket,pdf_cache,created_at,deleted_at")
    if album_id:
        query = query.eq("id", album_id)
    else:
        query = query.is_("deleted_at", "null").limit(limit)
    return list(query.execute().data or [])


def check_storage(client: Any, settings: Settings) -> dict[str, Any]:
    """Validate bucket connectivity only; no files or rows are changed."""
    storage = StorageService.for_supabase(client, settings)
    buckets = [settings.supabase_private_storage_bucket]
    if settings.supabase_storage_bucket not in buckets:
        buckets.append(settings.supabase_storage_bucket)
    checks: list[dict[str, str]] = []
    for bucket in buckets:
        storage.list(bucket, "albums")
        checks.append({"bucket": bucket, "status": "ok"})
    return {"status": "ok", "buckets": checks}


def check_integrity(client: Any, settings: Settings, *, album_id: str | None = None, limit: int = 100) -> dict[str, Any]:
    """Compare active album DB references with storage objects without mutation."""
    storage = StorageService.for_supabase(client, settings)
    missing: list[dict[str, str]] = []
    albums = _list_albums(client, album_id=album_id, limit=limit)
    for album in albums:
        plan = cleanup_album_files(client, settings, album, dry_run=True)
        for bucket, paths in plan.items():
            for path in paths:
                if not storage.file_exists(bucket, path):
                    missing.append({"album_id": str(album["id"]), "bucket": bucket, "path": path})
    return {
        "status": "ok" if not missing else "degraded",
        "albums_checked": len(albums),
        "missing_count": len(missing),
        "missing": missing,
    }


def cleanup_temp(client: Any, settings: Settings, *, album_id: str | None = None, execute: bool = False, limit: int = 100) -> dict[str, Any]:
    """Identify or explicitly delete temporary uploads for active albums."""
    candidates: list[dict[str, str]] = []
    for album in _list_albums(client, album_id=album_id, limit=limit):
        paths = cleanup_temporary_album_uploads(client, settings, str(album["id"]), dry_run=not execute)
        candidates.extend({"album_id": str(album["id"]), "path": path} for path in paths)
    return {"status": "ok", "executed": execute, "candidate_count": len(candidates), "candidates": candidates}


def cleanup_storage(client: Any, settings: Settings, *, album_id: str | None = None, execute: bool = False, limit: int = 100) -> dict[str, Any]:
    """Identify or explicitly delete unreferenced non-temporary assets.

    Legacy paths outside the canonical ``albums/{id}`` root are intentionally
    not automatically deleted; they remain available for old album reads.
    """
    candidates: list[dict[str, str]] = []
    skipped_recent: list[str] = []
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    for album in _list_albums(client, album_id=album_id, limit=limit):
        album_key = str(album["id"])
        timestamp = str(album.get("created_at") or "")
        try:
            created_at = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        except ValueError:
            created_at = None
        if created_at is not None and created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        if created_at is None or created_at > cutoff:
            skipped_recent.append(album_key)
            continue
        plan = cleanup_album_files(client, settings, album, dry_run=True)
        known_paths = set(plan.get(settings.supabase_private_storage_bucket, []))
        paths = cleanup_album_orphans(
            client,
            settings,
            album_key,
            known_paths,
            exclude_prefixes=(f"albums/{album_key}/temp",),
            dry_run=not execute,
        )
        candidates.extend({"album_id": album_key, "path": path} for path in paths)
    return {
        "status": "ok",
        "executed": execute,
        "candidate_count": len(candidates),
        "candidates": candidates,
        "skipped_recent_album_ids": skipped_recent,
    }
