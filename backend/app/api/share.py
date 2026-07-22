from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from time import monotonic
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from app.config import get_settings
from app.models.schemas import (
    GuestMemoryClaimRequest, GuestMemoryRequest, GuestMemoryResponse, PublicMediaItem,
    PublicShareAlbumResponse, ShareLinkCreateRequest, ShareLinkResponse, ShareReactionRequest,
    AlbumPhotoUrlResponse,
)
from app.services.auth import require_authenticated_user
from app.services.authorization import require_album_edit_settings
from app.services.membership import get_album_access
from app.services.share_service import (
    add_reaction, claim_guest_memory, create_guest_memory, create_share_link, deactivate_share_link,
    get_active_share, increment_view, list_share_links, log_event,
)
from app.services.supabase import (
    get_album_media_records,
    get_album_photo_records,
    get_album_record,
    get_public_url,
    get_signed_url,
    get_supabase_client,
)
from app.services.collaboration_service import list_photo_memories
from app.services.collaboration_service import join_as_contributor, new_guest_id
from app.services.story_rules import visible_date_stories


router = APIRouter(prefix="/api", tags=["share"])
_WINDOW_SECONDS = 60.0
_PUBLIC_LIMIT = 60
_GUEST_LIMIT = 5
_rate_windows: dict[str, list[float]] = defaultdict(list)


def _rate_limit(key: str, limit: int) -> None:
    now = monotonic()
    window = [value for value in _rate_windows[key] if now - value < _WINDOW_SECONDS]
    if len(window) >= limit:
        raise HTTPException(status_code=429, detail="잠시 후 다시 시도해주세요.")
    window.append(now)
    _rate_windows[key] = window


def _share_response(row: dict, share_url: str | None = None) -> ShareLinkResponse:
    return ShareLinkResponse(
        id=UUID(str(row["id"])), status=row["status"], expires_at=row.get("expires_at"),
        view_count=int(row.get("view_count") or 0), created_at=row["created_at"],
        deactivated_at=row.get("deactivated_at"), share_url=share_url,
    )


@router.post("/albums/{album_id}/share-links", response_model=ShareLinkResponse, status_code=status.HTTP_201_CREATED)
async def create_album_share_link(album_id: str, body: ShareLinkCreateRequest, authenticated_user_id: str = Depends(require_authenticated_user)) -> ShareLinkResponse:
    client = get_supabase_client()
    album = get_album_record(client, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    require_album_edit_settings(get_album_access(client, album, authenticated_user_id))
    if body.expires_at and body.expires_at <= datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="만료일은 미래여야 합니다.")
    row, token = create_share_link(client, album_id, authenticated_user_id, body.expires_at)
    settings = get_settings()
    log_event(client, "share_link_created", album_id=album_id, share_link_id=row["id"])
    return _share_response(row, f"{settings.frontend_base_url.rstrip('/')}/s/{token}")


@router.get("/albums/{album_id}/share-links", response_model=list[ShareLinkResponse])
async def get_album_share_links(album_id: str, authenticated_user_id: str = Depends(require_authenticated_user)) -> list[ShareLinkResponse]:
    client = get_supabase_client()
    album = get_album_record(client, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    require_album_edit_settings(get_album_access(client, album, authenticated_user_id))
    return [_share_response(row) for row in list_share_links(client, album_id)]


@router.post("/albums/{album_id}/share-links/{share_id}/deactivate", status_code=status.HTTP_204_NO_CONTENT)
async def deactivate_album_share_link(album_id: str, share_id: str, authenticated_user_id: str = Depends(require_authenticated_user)) -> Response:
    client = get_supabase_client()
    album = get_album_record(client, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    require_album_edit_settings(get_album_access(client, album, authenticated_user_id))
    deactivate_share_link(client, album_id, share_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/public/shares/{token}", response_model=PublicShareAlbumResponse)
async def get_public_share(token: str, request: Request) -> PublicShareAlbumResponse:
    _rate_limit(f"view:{token}", _PUBLIC_LIMIT)
    client = get_supabase_client()
    share = get_active_share(client, token)
    album = get_album_record(client, str(share["album_id"]))
    if not album:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    increment_view(client, str(share["id"]))
    log_event(client, "public_album_viewed", album_id=str(album["id"]), share_link_id=str(share["id"]), metadata={"source": "share"})
    settings = get_settings()
    media = [PublicMediaItem(media_type=row["media_type"], mime_type=row["mime_type"], processing_status=row["processing_status"], original_filename=row.get("original_filename")) for row in get_album_media_records(client, str(album["id"]))]
    narrative = str(album.get("epilogue") or album.get("narrative") or "").strip()
    album_id = str(album["id"])
    photo_records = get_album_photo_records(client, album_id)
    chapter_stories = visible_date_stories(album.get("chapter_stories"), photo_records)
    memories = list_photo_memories(client, album_id)
    memories_by_photo: dict[str, list[dict]] = {}
    for mem in memories:
        pid = str(mem.get("photo_id") or "")
        memories_by_photo.setdefault(pid, []).append(mem)

    photos = []
    for photo in photo_records:
        pid = str(photo["id"])
        mems = memories_by_photo.get(pid, [])
        photos.append(
            AlbumPhotoUrlResponse(
                id=UUID(pid),
                sort_order=int(photo.get("sort_order") or 0),
                comment=str(photo.get("comment") or "").strip() or None,
                comments=[
                    {"author": m.get("author_name"), "text": str(m.get("comment") or "")}
                    for m in mems
                    if str(m.get("comment") or "").strip()
                ]
                or None,
                original_url=get_signed_url(
                    client,
                    str(photo["storage_bucket"]),
                    str(photo["storage_path"]),
                    settings.signed_url_ttl_seconds,
                ),
                thumbnail_url=get_signed_url(
                    client,
                    str(photo["thumbnail_bucket"]),
                    str(photo["thumbnail_path"]),
                    settings.signed_url_ttl_seconds,
                ),
                width=photo.get("width"),
                height=photo.get("height"),
                taken_at=photo.get("taken_at"),
                latitude=photo.get("latitude"),
                longitude=photo.get("longitude"),
                location_name=photo.get("location_name"),
                location_source=photo.get("location_source"),
                orientation=photo.get("orientation"),
            )
        )

    return PublicShareAlbumResponse(
        title=str(album.get("title") or "우리의 추억"),
        narrative=narrative,
        epilogue=narrative or None,
        chapter_stories=chapter_stories,
        image_url=get_public_url(client, str(album.get("result_path") or ""), settings),
        date=str(album.get("event_date") or ""),
        category=album.get("category"),
        template_type=album.get("template_type"),
        media=media,
        photos=photos,
        og_title=str(album.get("title") or "우리의 추억"),
        og_description=(narrative[:120] or "함께 만든 추억 앨범"),
    )


@router.post("/public/shares/{token}/guest-memories", response_model=GuestMemoryResponse, status_code=status.HTTP_201_CREATED)
async def submit_guest_memory(token: str, body: GuestMemoryRequest) -> GuestMemoryResponse:
    _rate_limit(f"guest:{token}", _GUEST_LIMIT)
    if body.website:
        raise HTTPException(status_code=400, detail="요청을 처리할 수 없습니다.")
    client = get_supabase_client()
    share = get_active_share(client, token)
    log_event(client, "guest_memory_started", album_id=str(share["album_id"]), share_link_id=str(share["id"]))
    _, claim_token = create_guest_memory(client, share, body.name, body.memory)
    log_event(client, "guest_memory_completed", album_id=str(share["album_id"]), share_link_id=str(share["id"]))
    return GuestMemoryResponse(claim_token=claim_token)


@router.post("/public/shares/{token}/contribute")
async def start_public_contribution(token: str, body: dict[str, str] | None = None) -> dict[str, str | None]:
    """Create or restore an anonymous contributor session from an active share link."""
    _rate_limit(f"contribute:{token}", _GUEST_LIMIT)
    client = get_supabase_client()
    share = get_active_share(client, token)
    album = get_album_record(client, str(share["album_id"]))
    if not album:
        raise HTTPException(status_code=404, detail="Album was not found.")
    if album.get("collaboration_status") == "closed":
        raise HTTPException(status_code=403, detail="This album is no longer accepting contributions.")
    guest_id = (body or {}).get("guest_id") or new_guest_id()
    display_name = ((body or {}).get("display_name") or "함께한 사람").strip()[:40] or "함께한 사람"
    contributor = join_as_contributor(
        client,
        album,
        None,
        display_name=display_name,
        relationship=None,
        guest_id=guest_id,
        user_id=None,
    )
    log_event(client, "public_contribution_started", album_id=str(album["id"]), share_link_id=str(share["id"]))
    return {
        "album_id": str(album["id"]),
        "contributor_id": str(contributor["id"]),
        "guest_id": str(contributor.get("guest_id") or guest_id),
        "display_name": str(contributor.get("display_name") or display_name),
    }


@router.post("/public/shares/{token}/reactions", status_code=status.HTTP_204_NO_CONTENT)
async def submit_reaction(token: str, body: ShareReactionRequest) -> Response:
    client = get_supabase_client()
    share = get_active_share(client, token)
    add_reaction(client, str(share["id"]), body.reaction, body.session_key)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/guest-memories/claim")
async def claim_memory(body: GuestMemoryClaimRequest, authenticated_user_id: str = Depends(require_authenticated_user)) -> dict[str, str | None]:
    client = get_supabase_client()
    result = claim_guest_memory(client, body.claim_token, authenticated_user_id)
    return {"album_id": str(result["album_id"]), "memory_answer_id": str(result["memory_answer_id"]) if result.get("memory_answer_id") else None}
