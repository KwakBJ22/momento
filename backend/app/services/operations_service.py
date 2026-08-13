"""Read-only checks and explicitly triggered storage maintenance operations."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from app.config import Settings
from app.services.storage_service import StorageService

#: 앨범 파일이 사는 최상위 폴더. 버킷 전체 목록에서 이 밑만 골라낼 때도 쓴다.
ALBUM_PREFIX = "albums"
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


def count_orphan_files(
    client: Any,
    settings: Settings,
    *,
    limit: int = 5000,
    files: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """저장소에는 있는데 DB 가 모르는 파일이 **몇 개인지 센다** (K-3).

    ★ **지우지 않는다. 세기만 한다.** 조건이 틀리면 지우고 나서 안다(§9) — 사진은
      되살릴 수 없다. 며칠 숫자를 보고 나서 삭제를 켜는 것이 순서다.

    ★ **저장소와 DB 를 한 트랜잭션으로 묶을 수 없다.** Storage 는 별도 서비스라
      Postgres 트랜잭션 밖에 있다. 그래서 묶으려 하지 않고 **"지우고 남으면 나중에
      줍는다"** 로 간다. 이 함수가 그 "나중에" 의 첫 단계다.

    ``check_integrity`` 와 방향이 반대다 — 그쪽은 DB 가 가리키는데 파일이 없는 것을
    찾고, 이쪽은 파일이 있는데 가리키는 DB 행이 없는 것을 찾는다.

    ``files`` 를 넘기면 저장소를 다시 훑지 않고 그 목록에서 ``albums/`` 밑만 걸러
    쓴다. 버킷 전체 목록은 ``albums`` 밑을 포함하므로 걸러낸 집합이 스스로
    ``list_recursive(bucket, "albums")`` 를 돌렸을 때와 같다. 넘기지 않으면
    지금까지처럼 스스로 훑는다(운영 CLI 가 그 길로 부른다).
    """
    storage = StorageService.for_supabase(client, settings)
    bucket = settings.supabase_private_storage_bucket
    listed = (
        [item for item in files if str(item.get("path") or "").strip("/").startswith(f"{ALBUM_PREFIX}/")]
        if files is not None
        else storage.list_recursive(bucket, ALBUM_PREFIX)
    )
    stored = {str(item.get("path") or "").strip("/") for item in listed}
    stored.discard("")
    known: set[str] = set()
    rows = client.table("album_photos").select("storage_path,thumbnail_path,display_path").limit(limit).execute().data or []
    for row in rows:
        for key in ("storage_path", "thumbnail_path", "display_path"):
            value = str(row.get(key) or "").strip("/")
            if value:
                known.add(value)
    # 앨범 자체가 들고 있는 결과물(PDF 등)도 DB 가 아는 파일이다.
    for album in client.table("albums").select("result_path").limit(limit).execute().data or []:
        value = str(album.get("result_path") or "").strip("/")
        if value:
            known.add(value)
    orphans = sorted(stored - known)
    return {
        "status": "ok",
        "bucket": bucket,
        "stored_count": len(stored),
        "known_count": len(known),
        "orphan_count": len(orphans),
        # 지우지 않으므로 목록은 눈으로 볼 만큼만 낸다.
        "orphan_sample": orphans[:20],
    }


def storage_usage(
    client: Any,
    settings: Settings,
    *,
    files: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Measure the configured private bucket without changing any object.

    ``files`` 를 넘기면 저장소를 다시 훑지 않고 그 목록을 그대로 센다.
    """
    storage = StorageService.for_supabase(client, settings)
    bucket = settings.supabase_private_storage_bucket
    if files is None:
        files = storage.list_recursive(bucket)
    total_bytes = 0
    for item in files:
        metadata = item.get("metadata") or {}
        size = metadata.get("size", item.get("size", 0)) if isinstance(metadata, dict) else 0
        try:
            total_bytes += int(size or 0)
        except (TypeError, ValueError):
            continue
    return {"bucket": bucket, "file_count": len(files), "bytes": total_bytes}


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
