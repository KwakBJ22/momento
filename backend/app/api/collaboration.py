"""Collaborative album MVP API: invite, join, memories, rebuild."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, UploadFile

from app.config import get_settings
from app.models.schemas import (
    CollaborationContributorResponse,
    CollaborationInviteStartResponse,
    CollaborationJoinRequest,
    CollaborationJoinResponse,
    CollaborationRebuildRequest,
    CollaborationRebuildResponse,
    CollaborationStatusResponse,
    JoinPreviewResponse,
    PhotoMemoryCreateRequest,
    PhotoMemoryResponse,
    PhotoMemoryUpdateRequest,
)
from app.services.auth import optional_authenticated_user, require_authenticated_user
from app.services.authorization import require_album_edit_settings, require_album_read
from app.services.collaboration_service import (
    MAX_BATCH_UPLOAD,
    close_collaboration,
    count_active_contributors,
    count_ready_photos,
    create_photo_memory,
    deactivate_invites,
    delete_photo_memory,
    get_album_for_invite,
    get_contributor,
    join_as_contributor,
    list_contributors,
    list_photo_memories,
    mark_album_dirty,
    new_guest_id,
    publish_album,
    rebuild_album,
    remove_contributor,
    require_contributor,
    rotate_invite,
    soft_delete_photo,
    start_collaboration,
    update_photo_memory,
)
from app.services.image_upload_service import process_upload
from app.services.membership import get_album_access
from app.services.supabase import (
    get_album_record,
    get_public_url,
    get_signed_url,
    get_supabase_client,
    save_album_photo_records,
    upload_album_photo_assets,
)

router = APIRouter(tags=["collaboration"])


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


@router.get("/api/join/{token}", response_model=JoinPreviewResponse)
async def join_preview(token: str) -> JoinPreviewResponse:
    settings = get_settings()
    client = get_supabase_client(settings)
    album, _invite = get_album_for_invite(client, token)
    cover = None
    if album.get("result_path"):
        cover = get_public_url(client, str(album["result_path"]), settings)
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


@router.get("/api/albums/{album_id}/collaboration", response_model=CollaborationStatusResponse)
async def get_collaboration_status(
    album_id: str,
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> CollaborationStatusResponse:
    settings = get_settings()
    client = get_supabase_client(settings)
    album = get_album_record(client, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    access = get_album_access(client, album, authenticated_user_id)
    require_album_read(access)

    memories = list_photo_memories(client, album_id)
    contributors = list_contributors(client, album_id)
    active = (
        client.table("album_invites")
        .select("id")
        .eq("album_id", album_id)
        .eq("is_active", True)
        .limit(1)
        .execute()
    )

    return CollaborationStatusResponse(
        album_id=UUID(album_id),
        collaboration_enabled=bool(album.get("collaboration_enabled")),
        collaboration_status=album.get("collaboration_status") or "draft",
        dirty=bool(album.get("dirty")),
        album_version=int(album.get("album_version") or 0),
        last_built_at=album.get("last_built_at"),
        published_at=album.get("published_at"),
        photo_count=count_ready_photos(client, album_id),
        photo_limit=int(album.get("photo_limit") or 30),
        contributor_count=count_active_contributors(client, album_id),
        contributor_limit=int(album.get("contributor_limit") or 10),
        memory_count=len(memories),
        invite_active=bool(active.data),
        invite_url=None,
        contributors=[
            CollaborationContributorResponse(
                id=UUID(str(c["id"])),
                display_name=str(c["display_name"]),
                relationship=c.get("relationship"),
                role=str(c.get("role") or "contributor"),
                joined_at=c.get("joined_at"),
            )
            for c in contributors
        ],
        album_json=album.get("album_json"),
    )


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
        client.table("album_photos")
        .select(
            "id, sort_order, status, storage_bucket, storage_path, thumbnail_bucket, thumbnail_path, "
            "taken_at, orientation, width, height, uploaded_by_contributor_id, original_filename"
        )
        .eq("album_id", album_id)
        .eq("status", "ready")
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
        original_path, thumbnail_path = upload_album_photo_assets(
            client, family_id, album_id, photo_id, processed, settings
        )
        record = {
            "id": photo_id,
            "album_id": album_id,
            "storage_bucket": settings.supabase_private_storage_bucket,
            "storage_path": original_path,
            "thumbnail_bucket": settings.supabase_private_storage_bucket,
            "thumbnail_path": thumbnail_path,
            "original_filename": photo.filename,
            "mime_type": processed.original_mime_type,
            "byte_size": len(processed.original_bytes),
            "checksum_sha256": processed.checksum_sha256,
            "sort_order": next_order,
            "status": "ready",
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
        }
        save_album_photo_records(client, [record])
        next_order += 1
        uploaded.append({"id": photo_id, "sort_order": record["sort_order"]})

    if uploaded:
        mark_album_dirty(client, album_id)

    return {"uploaded": uploaded, "photo_count": current + len(uploaded), "photo_limit": limit}


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
    # Default: reuse existing narrative (no AI). regenerate_story reserved for later.
    _ = body.regenerate_story
    result = rebuild_album(client, album, album_json=body.album_json, force=body.force)
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
    soft_delete_photo(client, album_id, photo_id)
    return {"status": "deleted"}
