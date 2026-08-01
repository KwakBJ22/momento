"""Collaborative album MVP API: invite, join, memories, rebuild."""

from __future__ import annotations

import asyncio
import logging
import uuid
import time
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Response, UploadFile

from app.config import get_settings
from app.models.album_photo_status import ALBUM_PHOTO_READY, ready_album_photo_query
from app.models.schemas import (
    CollaborationContributorResponse,
    CollaborationInviteStartResponse,
    CollaborationJoinRequest,
    CollaborationJoinResponse,
    CollaborationRebuildRequest,
    CollaborationRebuildResponse,
    CollaborationStatusResponse,
    CollaborationParticipationSummary,
    JoinPreviewResponse,
    PhotoMemoryCreateRequest,
    PhotoMemoryResponse,
    PhotoMemoryUpdateRequest,
)
from app.services.auth import optional_authenticated_user, require_authenticated_user
from app.services.authorization import require_album_edit_settings, require_album_read
from app.services.collaboration_service import (
    LIVING_APPEND_MEMORY_THRESHOLD,
    LIVING_APPEND_PHOTO_THRESHOLD,
    MAX_BATCH_UPLOAD,
    close_collaboration,
    count_active_contributors,
    count_ready_photos,
    create_photo_memory,
    deactivate_invites,
    delete_photo_memory,
    ensure_owner_contributor,
    get_album_for_invite,
    get_contributor,
    join_as_contributor,
    list_contributors,
    list_photo_memories,
    living_recommended_mode,
    mark_album_dirty,
    new_guest_id,
    publish_album,
    rebuild_album,
    apply_selected_contributions,
    contribution_baseline_at,
    count_new_contributions,
    remove_contributor,
    require_contributor,
    rotate_invite,
    soft_delete_photo,
    start_collaboration,
    update_photo_memory,
)
from app.services.image_upload_service import process_upload
from app.services.storage_service import StorageService
from app.services.membership import get_album_access
from app.services.supabase import (
    get_album_photo_records,
    get_album_record,
    get_signed_url,
    get_supabase_client,
    save_album_photo_records,
    upload_album_photo_assets,
)
from app.services.share_service import album_visitor_count, log_event

router = APIRouter(tags=["collaboration"])
logger = logging.getLogger(__name__)


def _parse_uuid_header(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return str(UUID(value.strip()))
    except ValueError:
        return None


def _owner_name(client: Any, album: dict[str, Any]) -> str | None:
    owner_id = album.get("created_by") or album.get("owner_id")
    if not owner_id:
        return None
    result = client.table("profiles").select("display_name").eq("id", owner_id).limit(1).execute()
    if result.data:
        return result.data[0].get("display_name")
    return None


def _invite_url(token: str) -> str:
    settings = get_settings()
    return f"{settings.frontend_base_url.rstrip('/')}/join/{token}"


def _resolve_expires(raw: Any) -> datetime | None:
    if not raw:
        return None
    return datetime.fromisoformat(str(raw).replace("Z", "+00:00"))


def _iso_for_analytics() -> str:
    return datetime.now(timezone.utc).isoformat()


def _pending_contributions(client: Any, album: dict[str, Any], settings: Any) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    album_id = str(album["id"])
    baseline = contribution_baseline_at(album)
    applied_photo_ids = {str(item) for item in (album.get("applied_contribution_photo_ids") or [])}
    applied_memory_ids = {str(item) for item in (album.get("applied_contribution_memory_ids") or [])}
    owners = {str(row["id"]) for row in list_contributors(client, album_id) if row.get("role") == "owner"}
    contributors = {str(row["id"]): str(row.get("display_name") or "참여자") for row in list_contributors(client, album_id)}
    photos = ready_album_photo_query(client.table("album_photos").select("*").eq("album_id", album_id)).is_("deleted_at", "null").execute().data or []
    memories = list_photo_memories(client, album_id)
    pending_photos = [
        row
        for row in photos
        if str(row.get("uploaded_by_contributor_id") or "").strip()
        and str(row.get("uploaded_by_contributor_id") or "").strip() not in owners
        and str(row.get("created_at") or "") > baseline
        and str(row["id"]) not in applied_photo_ids
    ]
    pending_memories = [
        row
        for row in memories
        if str(row.get("contributor_id") or "").strip()
        and str(row.get("contributor_id") or "").strip() not in owners
        and str(row.get("created_at") or "") > baseline
        and str(row["id"]) not in applied_memory_ids
    ]
    items: list[dict[str, Any]] = []
    for row in pending_photos:
        items.append({"id": str(row["id"]), "type": "photo", "actor_name": contributors.get(str(row.get("uploaded_by_contributor_id") or ""), "참여자"), "created_at": row.get("created_at"), "thumbnail_url": get_signed_url(client, str(row["thumbnail_bucket"]), str(row["thumbnail_path"]), settings.signed_url_ttl_seconds), "comment": str(row.get("comment") or "").strip() or None})
    for row in pending_memories:
        items.append({"id": str(row["id"]), "type": "memory", "actor_name": str(row.get("author_name") or "참여자"), "created_at": row.get("created_at"), "content": str(row.get("comment") or "")})
    return sorted(items, key=lambda item: str(item.get("created_at") or ""), reverse=True)[:30], pending_photos + pending_memories


@router.get("/api/join/{token}", response_model=JoinPreviewResponse)
async def join_preview(token: str) -> JoinPreviewResponse:
    settings = get_settings()
    client = get_supabase_client(settings)
    album, _invite = get_album_for_invite(client, token)
    # Metric: invite participation rate = invitation_accepted / invitation_opened.
    log_event(client, "invitation_opened", album_id=str(album["id"]))
    # A participation invitation should show an actual album photo, never the
    # generated result preview. Prefer the owner's explicit cover selection and
    # otherwise use the first available album photo without changing the public
    # API response shape.
    photos = get_album_photo_records(client, str(album["id"]))
    cover_photo_id = str(album.get("cover_photo_id") or "")
    cover_photo = next((photo for photo in photos if str(photo.get("id")) == cover_photo_id), None)
    cover_photo = cover_photo or (photos[0] if photos else None)
    cover = None
    if cover_photo:
        bucket = str(cover_photo.get("thumbnail_bucket") or cover_photo.get("storage_bucket") or "")
        path = str(cover_photo.get("thumbnail_path") or cover_photo.get("storage_path") or "")
        if bucket and path:
            cover = get_signed_url(client, bucket, path, settings.signed_url_ttl_seconds) or None
    return JoinPreviewResponse(
        album_id=UUID(str(album["id"])),
        title=str(album.get("title") or "함께 만드는 앨범"),
        owner_name=_owner_name(client, album),
        cover_image_url=cover,
        contributor_count=count_active_contributors(client, str(album["id"])),
        photo_count=count_ready_photos(client, str(album["id"])),
        photo_limit=int(album.get("photo_limit") or 30),
        collaboration_status=album.get("collaboration_status") or "collecting",
    )


@router.post("/api/join/{token}", response_model=CollaborationJoinResponse)
async def join_collaboration(
    token: str,
    body: CollaborationJoinRequest,
    user_id: str | None = Depends(optional_authenticated_user),
) -> CollaborationJoinResponse:
    settings = get_settings()
    client = get_supabase_client(settings)
    album, invite = get_album_for_invite(client, token)
    guest_id = str(body.guest_id) if body.guest_id else new_guest_id()
    contributor = join_as_contributor(
        client,
        album,
        invite,
        display_name=body.display_name,
        relationship=body.relationship,
        guest_id=guest_id,
        user_id=user_id,
    )
    resolved_guest = contributor.get("guest_id") or (guest_id if not user_id else None)
    # Metric: invite participation rate = invitation_accepted / invitation_opened.
    log_event(client, "invitation_accepted", album_id=str(album["id"]))
    return CollaborationJoinResponse(
        album_id=UUID(str(album["id"])),
        contributor_id=UUID(str(contributor["id"])),
        guest_id=UUID(str(resolved_guest)) if resolved_guest else None,
        display_name=str(contributor["display_name"]),
        relationship=contributor.get("relationship"),
        role=str(contributor.get("role") or "contributor"),
    )


@router.post("/api/albums/{album_id}/collaboration/start", response_model=CollaborationInviteStartResponse)
async def start_album_collaboration(
    album_id: str,
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> CollaborationInviteStartResponse:
    settings = get_settings()
    client = get_supabase_client(settings)
    album = get_album_record(client, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    access = get_album_access(client, album, authenticated_user_id)
    require_album_edit_settings(access)
    invite_row, token = start_collaboration(client, album, authenticated_user_id)
    return CollaborationInviteStartResponse(
        invite_url=_invite_url(token),
        invite_token=token,
        expires_at=_resolve_expires(invite_row.get("expires_at")),
        collaboration_status="collecting",
    )


@router.post("/api/albums/{album_id}/collaboration/rotate-invite", response_model=CollaborationInviteStartResponse)
async def rotate_album_invite(
    album_id: str,
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> CollaborationInviteStartResponse:
    settings = get_settings()
    client = get_supabase_client(settings)
    album = get_album_record(client, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    access = get_album_access(client, album, authenticated_user_id)
    require_album_edit_settings(access)
    invite_row, token = rotate_invite(client, album, authenticated_user_id)
    return CollaborationInviteStartResponse(
        invite_url=_invite_url(token),
        invite_token=token,
        expires_at=_resolve_expires(invite_row.get("expires_at")),
        collaboration_status="collecting",
    )


@router.post("/api/albums/{album_id}/collaboration/deactivate-invite")
async def deactivate_album_invite(
    album_id: str,
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> dict[str, str]:
    settings = get_settings()
    client = get_supabase_client(settings)
    album = get_album_record(client, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    access = get_album_access(client, album, authenticated_user_id)
    require_album_edit_settings(access)
    deactivate_invites(client, album_id)
    return {"status": "ok"}


@router.post("/api/albums/{album_id}/collaboration/close")
async def close_album_collaboration(
    album_id: str,
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> dict[str, str]:
    settings = get_settings()
    client = get_supabase_client(settings)
    album = get_album_record(client, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    access = get_album_access(client, album, authenticated_user_id)
    require_album_edit_settings(access)
    close_collaboration(client, album_id)
    return {"status": "closed"}


@router.post("/api/albums/{album_id}/collaboration/publish")
async def publish_album_collaboration(
    album_id: str,
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> dict[str, str]:
    settings = get_settings()
    client = get_supabase_client(settings)
    album = get_album_record(client, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    access = get_album_access(client, album, authenticated_user_id)
    require_album_edit_settings(access)
    publish_album(client, album_id)
    return {"status": "published"}


def _list_ready_photo_refs(client: Any, album_id: str) -> list[dict[str, Any]]:
    return (
        ready_album_photo_query(client.table("album_photos")
        .select("id, uploaded_by_contributor_id, created_at")
        .eq("album_id", album_id)
        )
        .is_("deleted_at", "null")
        .execute()
        .data
        or []
    )


def _invite_is_active(client: Any, album_id: str) -> bool:
    active = (
        client.table("album_invites")
        .select("id")
        .eq("album_id", album_id)
        .eq("is_active", True)
        .limit(1)
        .execute()
    )
    return bool(active.data)


def build_participation_payload(
    album: dict[str, Any],
    contributors: list[dict[str, Any]],
    photos: list[dict[str, Any]],
    memories: list[dict[str, Any]],
) -> dict[str, Any]:
    participant_rows: list[dict[str, Any]] = []
    for contributor in contributors:
        contributor_id = str(contributor["id"])
        photo_rows = [photo for photo in photos if str(photo.get("uploaded_by_contributor_id") or "") == contributor_id]
        memory_rows = [memory for memory in memories if str(memory.get("contributor_id") or "") == contributor_id]
        role = "host" if contributor.get("role") == "owner" else "participant"
        name = str(contributor.get("display_name") or "").strip() or ("주최자" if role == "host" else "이름 없는 참여자")
        activity_times = [
            str(value)
            for value in [
                contributor.get("last_active_at"),
                *(photo.get("created_at") for photo in photo_rows),
                *(memory.get("created_at") for memory in memory_rows),
            ]
            if value
        ]
        participant_rows.append(
            {
                "id": contributor_id,
                "name": name,
                "role": role,
                "photo_count": len(photo_rows),
                "memory_count": len(memory_rows),
                "last_active_at": max(activity_times) if activity_times else None,
            }
        )
    activities = [
        {
            "type": "album_created",
            "actor_name": str(next((row["name"] for row in participant_rows if row["role"] == "host"), "주최자")),
            "count": 1,
            "created_at": album.get("created_at"),
        }
    ]
    for photo in photos:
        actor = next((row["name"] for row in participant_rows if row["id"] == str(photo.get("uploaded_by_contributor_id") or "")), "참여자")
        activities.append({"type": "photo_added", "actor_name": actor, "count": 1, "created_at": photo.get("created_at")})
    for memory in memories:
        activities.append(
            {"type": "memory_added", "actor_name": str(memory.get("author_name") or "참여자"), "count": 1, "created_at": memory.get("created_at")}
        )
    activities = sorted((item for item in activities if item.get("created_at")), key=lambda item: str(item["created_at"]), reverse=True)[:10]
    recent_cutoff = contribution_baseline_at(album)
    applied_photo_ids = {str(item) for item in (album.get("applied_contribution_photo_ids") or [])}
    applied_memory_ids = {str(item) for item in (album.get("applied_contribution_memory_ids") or [])}
    owner_ids = {str(row["id"]) for row in contributors if row.get("role") == "owner"}
    new_photo_count, new_memory_count = count_new_contributions(
        photos,
        memories,
        owner_contributor_ids=owner_ids,
        applied_photo_ids=applied_photo_ids,
        applied_memory_ids=applied_memory_ids,
        baseline=recent_cutoff,
    )
    return {
        "participants": participant_rows,
        "recent_activities": activities,
        "new_photo_count": new_photo_count,
        "new_memory_count": new_memory_count,
        "new_contribution_count": new_photo_count + new_memory_count,
        "recommended_mode": living_recommended_mode(new_photo_count, new_memory_count),
    }


@router.get("/api/albums/{album_id}/collaboration", response_model=CollaborationStatusResponse)
async def get_collaboration_status(
    album_id: str,
    response: Response,
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> CollaborationStatusResponse:
    started_at = time.perf_counter()
    settings = get_settings()
    client = get_supabase_client(settings)
    album = await asyncio.to_thread(get_album_record, client, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    access = get_album_access(client, album, authenticated_user_id)
    require_album_read(access)
    owner_id = str(album.get("created_by") or album.get("owner_id") or "").strip()
    if owner_id:
        await asyncio.to_thread(ensure_owner_contributor, client, album, owner_id)

    contributors, photos, memories, invite_active = await asyncio.gather(
        asyncio.to_thread(list_contributors, client, album_id),
        asyncio.to_thread(_list_ready_photo_refs, client, album_id),
        asyncio.to_thread(list_photo_memories, client, album_id),
        asyncio.to_thread(_invite_is_active, client, album_id),
    )
    participation_payload = build_participation_payload(album, contributors, photos, memories)
    active_contributors = [row for row in contributors if row.get("status") == "active"]
    # "누가 다녀갔다" counter — owners only (§10). Non-owners never see it.
    visitor_count = await asyncio.to_thread(album_visitor_count, client, album_id) if access.can_edit_settings else 0
    duration_ms = round((time.perf_counter() - started_at) * 1000)
    response.headers["Server-Timing"] = f"collaboration;dur={duration_ms}"

    return CollaborationStatusResponse(
        album_id=UUID(album_id),
        can_edit_settings=access.can_edit_settings,
        collaboration_enabled=bool(album.get("collaboration_enabled")),
        collaboration_status=album.get("collaboration_status") or "draft",
        dirty=bool(album.get("dirty")),
        album_version=int(album.get("album_version") or 0),
        last_built_at=album.get("last_built_at"),
        published_at=album.get("published_at"),
        photo_count=len(photos),
        photo_limit=int(album.get("photo_limit") or 30),
        contributor_count=len(active_contributors),
        contributor_limit=int(album.get("contributor_limit") or 10),
        memory_count=len(memories),
        visitor_count=visitor_count,
        invite_active=invite_active,
        invite_url=None,
        contributors=[
            CollaborationContributorResponse(
                id=UUID(str(c["id"])),
                display_name=str(c.get("display_name") or ("주최자" if c.get("role") == "owner" else "이름 없는 참여자")),
                relationship=c.get("relationship"),
                role=str(c.get("role") or "contributor"),
                joined_at=c.get("joined_at"),
            )
            for c in contributors
        ],
        album_json=None,
        participation=CollaborationParticipationSummary(**participation_payload),
    )


@router.get("/api/albums/{album_id}/participation")
async def get_album_participation(
    album_id: str,
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> dict[str, Any]:
    client = get_supabase_client(get_settings())
    album = await asyncio.to_thread(get_album_record, client, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="Album not found.")
    require_album_read(get_album_access(client, album, authenticated_user_id))
    owner_id = str(album.get("created_by") or album.get("owner_id") or "").strip()
    if owner_id:
        await asyncio.to_thread(ensure_owner_contributor, client, album, owner_id)
    contributors, photos, memories = await asyncio.gather(
        asyncio.to_thread(list_contributors, client, album_id),
        asyncio.to_thread(_list_ready_photo_refs, client, album_id),
        asyncio.to_thread(list_photo_memories, client, album_id),
    )
    return build_participation_payload(album, contributors, photos, memories)


@router.get("/api/albums/{album_id}/pending-contributions")
async def get_pending_contributions(
    album_id: str,
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> dict[str, Any]:
    settings = get_settings()
    client = get_supabase_client(settings)
    album = get_album_record(client, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="Album not found.")
    if str(album.get("created_by") or album.get("owner_id") or "") != authenticated_user_id:
        raise HTTPException(status_code=403, detail="Only the album host can review new memories.")
    items, _ = _pending_contributions(client, album, settings)
    photo_count = sum(1 for item in items if item.get("type") == "photo")
    memory_count = sum(1 for item in items if item.get("type") == "memory")
    return {
        "count": len(items),
        "items": items,
        "last_applied_at": album.get("last_collaboration_applied_at"),
        "recommended_mode": (
            "append_page"
            if photo_count <= LIVING_APPEND_PHOTO_THRESHOLD and memory_count <= LIVING_APPEND_MEMORY_THRESHOLD
            else "edition"
        ),
        "append_photo_threshold": LIVING_APPEND_PHOTO_THRESHOLD,
        "append_memory_threshold": LIVING_APPEND_MEMORY_THRESHOLD,
    }


@router.post("/api/albums/{album_id}/apply-contributions")
async def apply_contributions(
    album_id: str,
    body: dict[str, Any],
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> dict[str, Any]:
    settings = get_settings()
    client = get_supabase_client(settings)
    album = get_album_record(client, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="Album not found.")
    if str(album.get("created_by") or album.get("owner_id") or "") != authenticated_user_id:
        raise HTTPException(status_code=403, detail="Only the album host can update this album.")
    photo_ids = {str(item) for item in body.get("photo_ids", [])}
    memory_ids = {str(item) for item in body.get("memory_ids", [])}
    if not photo_ids and not memory_ids:
        raise HTTPException(status_code=400, detail="반영할 새 추억이 없습니다.")
    requested_mode = str(body.get("mode") or "auto")
    started_at = _iso_for_analytics()
    started_perf = time.perf_counter()
    previous_version = int(album.get("album_version") or 0)
    log_event(client, "album_rebuild_started", album_id=album_id, metadata={
        "owner_id": authenticated_user_id,
        "previous_version": previous_version,
        "started_at": started_at,
        "applied_photo_count": len(photo_ids),
        "applied_memory_count": len(memory_ids),
        "mode": requested_mode,
    })
    try:
        result = apply_selected_contributions(
            client,
            album,
            photo_ids=photo_ids,
            memory_ids=memory_ids,
            mode=requested_mode,
        )
    except HTTPException as exc:
        log_event(client, "album_rebuild_failed", album_id=album_id, metadata={
            "owner_id": authenticated_user_id,
            "previous_version": previous_version,
            "started_at": started_at,
            "completed_at": _iso_for_analytics(),
            "duration_ms": round((time.perf_counter() - started_perf) * 1000),
            "applied_photo_count": len(photo_ids),
            "applied_memory_count": len(memory_ids),
            "failure_code": str(exc.status_code),
            "mode": requested_mode,
        })
        raise
    log_event(client, "album_rebuild_completed", album_id=album_id, metadata={
        "owner_id": authenticated_user_id,
        "previous_version": previous_version,
        "new_version": int(result["album_version"]),
        "started_at": started_at,
        "completed_at": _iso_for_analytics(),
        "duration_ms": round((time.perf_counter() - started_perf) * 1000),
        "applied_photo_count": len(photo_ids),
        "applied_memory_count": len(memory_ids),
        "mode": result["mode"],
    })
    living_event = "living_page_appended" if result["mode"] == "append_page" else "edition_created"
    log_event(client, living_event, album_id=album_id, metadata={
        "owner_id": authenticated_user_id,
        "photo_count": len(photo_ids),
        "memory_count": len(memory_ids),
        "selected_mode": result["mode"],
        "previous_edition": previous_version,
        "new_edition": int(result["album_version"]),
    })
    return {
        "status": "completed",
        "album_id": album_id,
        "applied_count": result["applied_count"],
        "last_applied_at": result["last_applied_at"],
        "album_version": result["album_version"],
        "mode": result["mode"],
        "append_page_id": result.get("append_page_id"),
        "previous_edition": result.get("previous_edition"),
    }


@router.get("/api/albums/{album_id}/contribute/workspace")
async def contribute_workspace(
    album_id: str,
    x_momento_guest_id: str | None = Header(default=None),
    x_momento_contributor_id: str | None = Header(default=None),
    user_id: str | None = Depends(optional_authenticated_user),
) -> dict[str, Any]:
    settings = get_settings()
    client = get_supabase_client(settings)
    album = get_album_record(client, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")

    contributor = require_contributor(
        client,
        album_id,
        contributor_id=_parse_uuid_header(x_momento_contributor_id),
        guest_id=_parse_uuid_header(x_momento_guest_id),
        user_id=user_id,
    )

    photos = (
        ready_album_photo_query(client.table("album_photos")
        .select(
            "id, sort_order, status, storage_bucket, storage_path, display_bucket, display_path, thumbnail_bucket, thumbnail_path, "
            "taken_at, orientation, width, height, uploaded_by_contributor_id, original_filename"
        )
        .eq("album_id", album_id)
        )
        .is_("deleted_at", "null")
        .order("sort_order")
        .execute()
    ).data or []
    memories = list_photo_memories(client, album_id)

    photo_payload = []
    for photo in photos:
        photo_payload.append(
            {
                "id": photo["id"],
                "sort_order": photo.get("sort_order"),
                "taken_at": photo.get("taken_at"),
                "orientation": photo.get("orientation"),
                "width": photo.get("width"),
                "height": photo.get("height"),
                "uploaded_by_contributor_id": photo.get("uploaded_by_contributor_id"),
                "mine": str(photo.get("uploaded_by_contributor_id") or "") == str(contributor["id"]),
                "original_url": get_signed_url(
                    client, str(photo["storage_bucket"]), str(photo["storage_path"]), settings.signed_url_ttl_seconds
                ),
                "display_url": get_signed_url(
                    client,
                    str(photo.get("display_bucket") or photo["storage_bucket"]),
                    str(photo.get("display_path") or photo["storage_path"]),
                    settings.signed_url_ttl_seconds,
                ),
                "thumbnail_url": get_signed_url(
                    client, str(photo["thumbnail_bucket"]), str(photo["thumbnail_path"]), settings.signed_url_ttl_seconds
                ),
                "memories": [
                    {
                        "id": m["id"],
                        "author_name": m.get("author_name"),
                        "relationship": m.get("relationship"),
                        "comment": m.get("comment"),
                        "contributor_id": m.get("contributor_id"),
                        "created_at": m.get("created_at"),
                        "mine": str(m.get("contributor_id")) == str(contributor["id"]),
                    }
                    for m in memories
                    if str(m["photo_id"]) == str(photo["id"])
                ],
            }
        )

    return {
        "album_id": album_id,
        "title": album.get("title") or "",
        "dirty": bool(album.get("dirty")),
        "album_version": int(album.get("album_version") or 0),
        "album_json": album.get("album_json"),
        "photo_count": len(photos),
        "photo_limit": int(album.get("photo_limit") or 30),
        "contributor": {
            "id": contributor["id"],
            "display_name": contributor.get("display_name"),
            "relationship": contributor.get("relationship"),
            "role": contributor.get("role"),
            "guest_id": contributor.get("guest_id"),
        },
        "contributors": list_contributors(client, album_id),
        "photos": photo_payload,
        "notice": (
            "내가 남긴 내용은 저장되었습니다. 앨범 생성자가 업데이트하면 앨범에 반영됩니다."
            if album.get("dirty")
            else None
        ),
    }


@router.post("/api/albums/{album_id}/contribute/photos")
async def contribute_upload_photos(
    album_id: str,
    photos: list[UploadFile] = File(...),
    file_created_ats: list[str] | None = Form(default=None),
    x_momento_guest_id: str | None = Header(default=None),
    x_momento_contributor_id: str | None = Header(default=None),
    user_id: str | None = Depends(optional_authenticated_user),
) -> dict[str, Any]:
    settings = get_settings()
    client = get_supabase_client(settings)
    album = get_album_record(client, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    if album.get("collaboration_status") == "closed":
        raise HTTPException(status_code=403, detail="함께 만들기가 종료되었습니다.")

    contributor = require_contributor(
        client,
        album_id,
        contributor_id=_parse_uuid_header(x_momento_contributor_id),
        guest_id=_parse_uuid_header(x_momento_guest_id),
        user_id=user_id,
    )

    if len(photos) > MAX_BATCH_UPLOAD:
        raise HTTPException(status_code=400, detail=f"한 번에 최대 {MAX_BATCH_UPLOAD}장까지 올릴 수 있어요.")

    current = count_ready_photos(client, album_id)
    limit = int(album.get("photo_limit") or 30)
    if current + len(photos) > limit:
        raise HTTPException(status_code=400, detail=f"앨범 사진은 최대 {limit}장까지예요.")

    family_id = str(album.get("family_id") or album.get("owner_id") or "shared")
    existing = (
        client.table("album_photos").select("sort_order, checksum_sha256").eq("album_id", album_id).execute()
    ).data or []
    next_order = max([int(r.get("sort_order") or 0) for r in existing] + [-1]) + 1
    known_hashes = {str(r.get("checksum_sha256")) for r in existing if r.get("checksum_sha256")}
    uploaded: list[dict[str, Any]] = []
    for index, photo in enumerate(photos):
        processed = process_upload(photo, settings)
        if processed.checksum_sha256 in known_hashes:
            continue
        known_hashes.add(processed.checksum_sha256)
        photo_id = str(uuid.uuid4())
        asset_paths = upload_album_photo_assets(client, family_id, album_id, photo_id, processed, settings)
        if len(asset_paths) == 2:
            original_path, thumbnail_path = asset_paths
            display_path = original_path
        else:
            original_path, display_path, thumbnail_path = asset_paths
        created_at = datetime.now(timezone.utc).isoformat()
        record = {
            "id": photo_id,
            "album_id": album_id,
            "storage_bucket": settings.supabase_private_storage_bucket,
            "storage_path": original_path,
            "display_bucket": settings.supabase_private_storage_bucket,
            "display_path": display_path,
            "thumbnail_bucket": settings.supabase_private_storage_bucket,
            "thumbnail_path": thumbnail_path,
            "original_filename": photo.filename,
            "mime_type": processed.original_mime_type,
            "byte_size": len(processed.original_bytes),
            "checksum_sha256": processed.checksum_sha256,
            "sort_order": next_order,
            "status": ALBUM_PHOTO_READY,
            "uploaded_by_contributor_id": contributor["id"],
            "width": processed.width or None,
            "height": processed.height or None,
            "orientation": processed.orientation,
            "taken_at": processed.taken_at.isoformat() if processed.taken_at else None,
            "latitude": processed.latitude,
            "longitude": processed.longitude,
            "location_name": None,
            "location_source": (
                "exif"
                if processed.latitude is not None and processed.longitude is not None
                else "unknown"
            ),
            "created_at": created_at,
        }
        save_album_photo_records(client, [record])
        next_order += 1
        uploaded.append(
            {
                "id": photo_id,
                "sort_order": record["sort_order"],
                "taken_at": record["taken_at"],
                "orientation": record["orientation"],
                "width": record["width"],
                "height": record["height"],
                "uploaded_by_contributor_id": contributor["id"],
                "author_name": str(contributor.get("display_name") or "익명"),
                "created_at": created_at,
                "mine": True,
                "original_url": get_signed_url(
                    client,
                    str(record["storage_bucket"]),
                    str(record["storage_path"]),
                    settings.signed_url_ttl_seconds,
                ),
                "display_url": get_signed_url(
                    client,
                    str(record["display_bucket"]),
                    str(record["display_path"]),
                    settings.signed_url_ttl_seconds,
                ),
                "thumbnail_url": get_signed_url(
                    client,
                    str(record["thumbnail_bucket"]),
                    str(record["thumbnail_path"]),
                    settings.signed_url_ttl_seconds,
                ),
                "memories": [],
            }
        )

    if uploaded:
        current_cover_id = str(album.get("cover_photo_id") or "")
        valid_cover = (
            ready_album_photo_query(client.table("album_photos").select("id").eq("album_id", album_id)
            .eq("id", current_cover_id)).is_("deleted_at", "null").limit(1).execute().data or []
        ) if current_cover_id else []
        if not valid_cover:
            client.table("albums").update({"cover_photo_id": uploaded[0]["id"]}).eq("id", album_id).execute()
        mark_album_dirty(client, album_id)

    if uploaded:
        # Metric: collaborative-album share = albums with participant photo_added/memory_added.
        log_event(client, "photo_added", album_id=album_id, metadata={"photo_count": len(uploaded)})
    return {"photos": uploaded, "uploaded": uploaded, "photo_count": current + len(uploaded), "photo_limit": limit}


@router.post("/api/albums/{album_id}/photos/{photo_id}/memories", response_model=PhotoMemoryResponse)
async def create_memory(
    album_id: str,
    photo_id: str,
    body: PhotoMemoryCreateRequest,
    x_momento_guest_id: str | None = Header(default=None),
    user_id: str | None = Depends(optional_authenticated_user),
) -> PhotoMemoryResponse:
    settings = get_settings()
    client = get_supabase_client(settings)
    album = get_album_record(client, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")

    contributor = require_contributor(
        client,
        album_id,
        contributor_id=str(body.contributor_id) if body.contributor_id else None,
        guest_id=str(body.guest_id) if body.guest_id else _parse_uuid_header(x_momento_guest_id),
        user_id=user_id,
    )
    memory = create_photo_memory(
        client, album_id=album_id, photo_id=photo_id, contributor=contributor, comment=body.comment
    )
    # Metric: collaborative-album share = albums with participant photo_added/memory_added.
    log_event(client, "memory_added", album_id=album_id)
    return PhotoMemoryResponse(
        id=UUID(str(memory["id"])),
        photo_id=UUID(str(memory["photo_id"])),
        author_name=str(memory.get("author_name") or ""),
        relationship=memory.get("relationship"),
        comment=str(memory.get("comment") or ""),
        contributor_id=UUID(str(memory["contributor_id"])),
        created_at=memory.get("created_at"),
        updated_at=memory.get("updated_at"),
        mine=True,
    )


@router.patch("/api/albums/{album_id}/memories/{memory_id}", response_model=PhotoMemoryResponse)
async def patch_memory(
    album_id: str,
    memory_id: str,
    body: PhotoMemoryUpdateRequest,
    x_momento_guest_id: str | None = Header(default=None),
    user_id: str | None = Depends(optional_authenticated_user),
) -> PhotoMemoryResponse:
    settings = get_settings()
    client = get_supabase_client(settings)
    album = get_album_record(client, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")

    is_owner = False
    if user_id:
        access = get_album_access(client, album, user_id)
        is_owner = access.can_edit_settings

    if is_owner:
        contributor = get_contributor(
            client,
            album_id,
            contributor_id=str(body.contributor_id) if body.contributor_id else None,
            guest_id=str(body.guest_id) if body.guest_id else _parse_uuid_header(x_momento_guest_id),
            user_id=user_id,
        ) or {"id": "owner"}
    else:
        contributor = require_contributor(
            client,
            album_id,
            contributor_id=str(body.contributor_id) if body.contributor_id else None,
            guest_id=str(body.guest_id) if body.guest_id else _parse_uuid_header(x_momento_guest_id),
            user_id=user_id,
        )

    memory = update_photo_memory(
        client,
        album_id=album_id,
        memory_id=memory_id,
        contributor=contributor,
        comment=body.comment,
        is_owner=is_owner,
    )
    return PhotoMemoryResponse(
        id=UUID(str(memory["id"])),
        photo_id=UUID(str(memory["photo_id"])),
        author_name=str(memory.get("author_name") or ""),
        relationship=memory.get("relationship"),
        comment=str(memory.get("comment") or ""),
        contributor_id=UUID(str(memory["contributor_id"])),
        created_at=memory.get("created_at"),
        updated_at=memory.get("updated_at"),
        mine=True,
    )


@router.delete("/api/albums/{album_id}/memories/{memory_id}")
async def remove_memory(
    album_id: str,
    memory_id: str,
    guest_id: str | None = None,
    contributor_id: str | None = None,
    x_momento_guest_id: str | None = Header(default=None),
    user_id: str | None = Depends(optional_authenticated_user),
) -> dict[str, str]:
    settings = get_settings()
    client = get_supabase_client(settings)
    album = get_album_record(client, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")

    is_owner = False
    if user_id:
        access = get_album_access(client, album, user_id)
        is_owner = access.can_edit_settings

    contributor = None
    if not is_owner:
        contributor = require_contributor(
            client,
            album_id,
            contributor_id=contributor_id,
            guest_id=guest_id or _parse_uuid_header(x_momento_guest_id),
            user_id=user_id,
        )
    delete_photo_memory(
        client, album_id=album_id, memory_id=memory_id, contributor=contributor, is_owner=is_owner
    )
    return {"status": "deleted"}


@router.post("/api/albums/{album_id}/collaboration/rebuild", response_model=CollaborationRebuildResponse)
async def rebuild_collaboration_album(
    album_id: str,
    body: CollaborationRebuildRequest,
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> CollaborationRebuildResponse:
    settings = get_settings()
    client = get_supabase_client(settings)
    album = get_album_record(client, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    access = get_album_access(client, album, authenticated_user_id)
    require_album_edit_settings(access)
    if count_ready_photos(client, album_id) == 0:
        raise HTTPException(status_code=422, detail="사진을 추가한 뒤 앨범을 만들어주세요.")
    # Default: reuse existing narrative (no AI). regenerate_story reserved for later.
    _ = body.regenerate_story
    # A client can hold an old document after deleting photos. Rebuild from the
    # current DB rows only; never accept stale photo/media IDs from that body.
    result = rebuild_album(client, album, album_json=None, force=body.force)
    return CollaborationRebuildResponse(
        album_version=int(result["album_version"]),
        dirty=False,
        last_built_at=result.get("last_built_at"),
        album_json=result.get("album_json"),
    )


@router.delete("/api/albums/{album_id}/collaboration/contributors/{contributor_id}")
async def remove_album_contributor(
    album_id: str,
    contributor_id: str,
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> dict[str, str]:
    settings = get_settings()
    client = get_supabase_client(settings)
    album = get_album_record(client, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    access = get_album_access(client, album, authenticated_user_id)
    require_album_edit_settings(access)
    remove_contributor(client, album_id, contributor_id)
    return {"status": "removed"}


@router.delete("/api/albums/{album_id}/collaboration/photos/{photo_id}")
async def owner_delete_photo(
    album_id: str,
    photo_id: str,
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> dict[str, str]:
    settings = get_settings()
    client = get_supabase_client(settings)
    album = get_album_record(client, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    access = get_album_access(client, album, authenticated_user_id)
    require_album_edit_settings(access)
    photo_rows = (
        client.table("album_photos").select("storage_path,display_path,thumbnail_path")
        .eq("id", photo_id).eq("album_id", album_id).is_("deleted_at", "null").limit(1).execute().data or []
    )
    soft_delete_photo(client, album_id, photo_id)
    paths = sorted({str(path) for path in (photo_rows[0].values() if photo_rows else ()) if path})
    if paths:
        try:
            StorageService.for_supabase(client, settings).delete(settings.supabase_private_storage_bucket, paths)
        except Exception as exc:
            logger.warning("collaboration_photo_storage_cleanup_failed album_id=%s photo_id=%s error_type=%s", album_id[:8], photo_id[:8], type(exc).__name__)
    return {"status": "deleted"}
