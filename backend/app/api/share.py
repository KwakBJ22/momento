from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from time import monotonic
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from app.config import get_settings
from app.models.schemas import (
    PublicContributionItem, PublicMediaItem,
    PublicShareAlbumResponse, ShareLinkCreateRequest, ShareLinkResponse, ShareReactionRequest,
    AlbumPhotoUrlResponse,
)
from app.services.authorization import require_album_edit_settings
from app.services.auth import optional_authenticated_user, require_authenticated_user
from app.services.membership import get_album_access
from app.services.share_service import (
    add_reaction, create_share_link, deactivate_share_link,
    get_active_share, increment_view, list_share_links, log_event, reaction_counts,
)
from app.services.supabase import (
    get_album_media_records,
    get_album_photo_records,
    get_album_record,
    get_result_signed_url,
    get_public_url,  # compatibility import for legacy integration mocks; never returned directly
    get_signed_url,
    get_signed_urls_batch,
    get_supabase_client,
)
from app.services.collaboration_service import album_document_photo_ids, list_contributors, list_photo_memories, unpack_edition_snapshot
from app.services.collaboration_service import join_as_contributor, new_guest_id
from app.services.story_rules import visible_date_stories


router = APIRouter(prefix="/api", tags=["share"])
_WINDOW_SECONDS = 60.0
_PUBLIC_LIMIT = 60
_GUEST_LIMIT = 5
_rate_windows: dict[str, list[float]] = defaultdict(list)
_LEGACY_ANONYMOUS_NAMES = {"", "함께한 사람", "함께 참여한 사람", "참여자"}


def _rate_limit(key: str, limit: int) -> None:
    now = monotonic()
    window = [value for value in _rate_windows[key] if now - value < _WINDOW_SECONDS]
    if len(window) >= limit:
        raise HTTPException(status_code=429, detail="잠시 후 다시 시도해주세요.")
    window.append(now)
    _rate_windows[key] = window


def _public_author_name(value: object) -> str:
    name = str(value or "").strip()
    return "익명" if name in _LEGACY_ANONYMOUS_NAMES else name


def _public_edition_document_and_pages(
    album: dict[str, object], edition: int | None,
) -> tuple[dict[str, object] | None, list[dict[str, object]]]:
    if edition is None:
        document = album.get("album_json") if isinstance(album.get("album_json"), dict) else None
        pages = album.get("living_append_pages")
        return document, list(pages) if isinstance(pages, list) else []
    history = album.get("album_version_history")
    snapshot = history.get(str(edition)) if isinstance(history, dict) else None
    document, pages = unpack_edition_snapshot(snapshot)
    if document is None:
        raise HTTPException(status_code=404, detail="The requested album edition was not found.")
    return document, pages


def _public_previous_edition(album: dict[str, object], edition: int | None) -> int | None:
    if edition is None:
        value = album.get("living_latest_edition_previous")
        return int(value) if value is not None else None
    history = album.get("album_version_history")
    if not isinstance(history, dict):
        return None
    older: list[int] = []
    for key in history:
        try:
            candidate = int(key)
        except (TypeError, ValueError):
            continue
        if candidate < edition:
            older.append(candidate)
    return max(older) if older else None


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
async def get_public_share(token: str, request: Request, edition: int | None = None) -> PublicShareAlbumResponse:
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
    memories = list_photo_memories(client, album_id)
    baseline = str(album.get("created_at") or "")
    applied_photo_ids = {str(item) for item in (album.get("applied_contribution_photo_ids") or [])}
    applied_memory_ids = {str(item) for item in (album.get("applied_contribution_memory_ids") or [])}
    contributors = list_contributors(client, album_id)
    owner_ids = {str(row["id"]) for row in contributors if row.get("role") == "owner"}
    contributor_names = {
        str(row["id"]): _public_author_name(row.get("display_name"))
        for row in contributors
    }

    def is_pending_photo(photo: dict[str, object]) -> bool:
        contributor_id = str(photo.get("uploaded_by_contributor_id") or "")
        return (
            bool(contributor_id)
            and
            contributor_id not in owner_ids
            and str(photo.get("created_at") or "") > baseline
            and str(photo.get("id")) not in applied_photo_ids
        )

    def is_pending_memory(memory: dict[str, object]) -> bool:
        contributor_id = str(memory.get("contributor_id") or "")
        return (
            bool(contributor_id)
            and
            contributor_id not in owner_ids
            and str(memory.get("created_at") or "") > baseline
            and str(memory.get("id")) not in applied_memory_ids
        )

    pending_photo_records = [photo for photo in photo_records if is_pending_photo(photo)] if edition is None else []
    pending_memories = [memory for memory in memories if is_pending_memory(memory)] if edition is None else []
    shared_photo_records = [photo for photo in photo_records if not is_pending_photo(photo)]
    current_document, selected_append_pages = _public_edition_document_and_pages(album, edition)
    document_photo_ids = album_document_photo_ids(current_document)
    visible_photo_records = [
        photo for photo in shared_photo_records
        if not document_photo_ids or str(photo["id"]) in document_photo_ids
    ]
    visible_photo_ids = {str(photo["id"]) for photo in visible_photo_records}
    shared_memories = [memory for memory in memories if not is_pending_memory(memory)]
    visible_memories = [
        memory
        for memory in shared_memories
        if str(memory.get("photo_id") or "") in visible_photo_ids
    ]
    chapter_stories = visible_date_stories(album.get("chapter_stories"), visible_photo_records)
    memories_by_photo: dict[str, list[dict]] = {}
    for mem in visible_memories:
        pid = str(mem.get("photo_id") or "")
        memories_by_photo.setdefault(pid, []).append(mem)

    all_memories_by_photo: dict[str, list[dict]] = {}
    for mem in shared_memories:
        all_memories_by_photo.setdefault(str(mem.get("photo_id") or ""), []).append(mem)

    # Public album rendering can include the same photo in the album, a Living
    # page and pending content. Create each signed URL once per response rather
    # than signing it again for every representation.
    photo_assets: list[dict[str, str]] = []
    for photo in photo_records:
        for bucket_key, path_key in (
            ("storage_bucket", "storage_path"),
            ("display_bucket", "display_path"),
            ("thumbnail_bucket", "thumbnail_path"),
        ):
            bucket = str(photo.get(bucket_key) or photo.get("storage_bucket") or "")
            path = str(photo.get(path_key) or (photo.get("storage_path") if path_key == "display_path" else "") or "")
            if bucket and path:
                photo_assets.append({"bucket": bucket, "path": path})
    photo_signed_urls = get_signed_urls_batch(client, photo_assets, settings.signed_url_ttl_seconds)

    def signed_photo_url(photo: dict, bucket_key: str, path_key: str, *, fallback_to_original: bool = False) -> str:
        bucket = str(photo.get(bucket_key) or photo.get("storage_bucket") or "")
        path = str(photo.get(path_key) or (photo.get("storage_path") if fallback_to_original else "") or "")
        return photo_signed_urls.get((bucket, path)) or get_signed_url(client, bucket, path, settings.signed_url_ttl_seconds)

    def to_public_photo(photo: dict) -> AlbumPhotoUrlResponse:
        pid = str(photo["id"])
        mems = all_memories_by_photo.get(pid, [])
        return AlbumPhotoUrlResponse(
            id=UUID(pid),
            sort_order=int(photo.get("sort_order") or 0),
            comment=str(photo.get("comment") or "").strip() or None,
            comments=[
                {"author": m.get("author_name"), "text": str(m.get("comment") or "")}
                for m in mems
                if str(m.get("comment") or "").strip()
            ] or None,
            original_url=signed_photo_url(photo, "storage_bucket", "storage_path"),
            display_url=signed_photo_url(photo, "display_bucket", "display_path", fallback_to_original=True),
            thumbnail_url=signed_photo_url(photo, "thumbnail_bucket", "thumbnail_path"),
            width=photo.get("width"), height=photo.get("height"), taken_at=photo.get("taken_at"),
            latitude=photo.get("latitude"), longitude=photo.get("longitude"),
            location_name=photo.get("location_name"), location_source=photo.get("location_source"),
            orientation=photo.get("orientation"),
        )

    shared_photo_models = {str(photo["id"]): to_public_photo(photo) for photo in shared_photo_records}
    photos = [shared_photo_models[str(photo["id"])] for photo in visible_photo_records]

    memory_by_id = {str(memory["id"]): memory for memory in shared_memories}
    living_append_pages: list[dict] = []
    for page in selected_append_pages:
        if not isinstance(page, dict):
            continue
        page_photos = [
            shared_photo_models[str(photo_id)].model_dump(mode="json")
            for photo_id in page.get("photo_ids") or []
            if str(photo_id) in shared_photo_models
        ]
        page_memories = [
            {
                "id": str(memory["id"]),
                "author_name": _public_author_name(memory.get("author_name")),
                "content": str(memory.get("comment") or "").strip(),
                "created_at": memory.get("created_at"),
            }
            for memory_id in page.get("memory_ids") or []
            if (memory := memory_by_id.get(str(memory_id))) and str(memory.get("comment") or "").strip()
        ]
        if page_photos or page_memories:
            living_append_pages.append({
                "id": str(page.get("id") or ""), "type": "append_page", "created_at": page.get("created_at"),
                "photos": page_photos, "memories": page_memories,
            })

    pending_items: list[PublicContributionItem] = []
    for photo in pending_photo_records:
        author_name = contributor_names.get(str(photo.get("uploaded_by_contributor_id") or ""), "익명")
        pending_items.append(
            PublicContributionItem(
                id=str(photo["id"]),
                type="photo",
                actor_name=author_name,
                author_name=author_name,
                created_at=photo.get("created_at"),
                thumbnail_url=signed_photo_url(photo, "thumbnail_bucket", "thumbnail_path"),
                comment=str(photo.get("comment") or "").strip() or None,
            )
        )
    for memory in pending_memories:
        author_name = _public_author_name(
            memory.get("author_name") or contributor_names.get(str(memory.get("contributor_id") or ""))
        )
        pending_items.append(
            PublicContributionItem(
                id=str(memory["id"]),
                type="memory",
                actor_name=author_name,
                author_name=author_name,
                created_at=memory.get("created_at"),
                content=str(memory.get("comment") or "").strip() or None,
            )
        )
    pending_items.sort(key=lambda item: str(item.created_at or ""), reverse=True)

    cover_photo_id = str(album.get("cover_photo_id") or "").strip() or None
    cover_photo = next((photo for photo in visible_photo_records if str(photo.get("id")) == cover_photo_id), None)
    if cover_photo is None and visible_photo_records:
        cover_photo = visible_photo_records[0]
        cover_photo_id = str(cover_photo.get("id"))
    cover_image_url = (
        get_signed_url(
            client,
            str(cover_photo.get("thumbnail_bucket") or cover_photo.get("storage_bucket")),
            str(cover_photo.get("thumbnail_path") or cover_photo.get("storage_path")),
            settings.signed_url_ttl_seconds,
        )
        if cover_photo else None
    )

    return PublicShareAlbumResponse(
        album_id=UUID(album_id),
        title=str(album.get("title") or "우리의 추억"),
        narrative=narrative,
        epilogue=narrative or None,
        chapter_stories=chapter_stories,
        image_url=cover_image_url or get_result_signed_url(client, album, settings),
        cover_photo_id=UUID(cover_photo_id) if cover_photo_id else None,
        cover_image_url=cover_image_url,
        date=str(album.get("event_date") or ""),
        category=album.get("category"),
        template_type=album.get("template_type"),
        media=media,
        photos=photos,
        photo_count=len(photo_records),
        photo_limit=int(album.get("photo_limit") or 30),
        pending_items=pending_items[:30],
        living_append_pages=living_append_pages,
        edition_previous=_public_previous_edition(album, edition),
        edition_is_latest=edition is None,
        og_title=str(album.get("title") or "우리의 추억"),
        og_description=(narrative[:120] or "함께 만든 추억 앨범"),
        reaction_counts=reaction_counts(client, album_id),
    )


@router.post("/public/shares/{token}/contribute")
async def start_public_contribution(
    token: str,
    body: dict[str, str] | None = None,
    authenticated_user_id: str | None = Depends(optional_authenticated_user),
) -> dict[str, str | None]:
    """Create or restore a contributor session from an active share link."""
    _rate_limit(f"contribute:{token}", _GUEST_LIMIT)
    client = get_supabase_client()
    share = get_active_share(client, token)
    album = get_album_record(client, str(share["album_id"]))
    if not album:
        raise HTTPException(status_code=404, detail="Album was not found.")
    # The link's kind — not a frontend URL guess — decides whether contribution is allowed.
    if str(share.get("kind") or "contribute") == "view":
        raise HTTPException(status_code=403, detail="이 링크는 감상용이에요. 사진과 기억은 함께 만들기 초대 링크에서 남길 수 있어요.")
    if album.get("collaboration_status") == "closed":
        raise HTTPException(status_code=403, detail="This album is no longer accepting contributions.")
    # A signed-in visitor must be restored through their account, never silently
    # converted into a new anonymous contributor for the same invitation.
    guest_id = None if authenticated_user_id else ((body or {}).get("guest_id") or new_guest_id())
    display_name = str((body or {}).get("display_name") or "").strip()
    if not display_name:
        raise HTTPException(status_code=400, detail="추억을 남긴 분의 이름을 입력해 주세요.")
    contributor = join_as_contributor(
        client,
        album,
        None,
        display_name=display_name,
        relationship=None,
        guest_id=guest_id,
        user_id=authenticated_user_id,
    )
    log_event(client, "public_contribution_started", album_id=str(album["id"]), share_link_id=str(share["id"]))
    return {
        "album_id": str(album["id"]),
        "contributor_id": str(contributor["id"]),
        "guest_id": str(contributor.get("guest_id")) if contributor.get("guest_id") else None,
        "display_name": str(contributor.get("display_name") or display_name),
    }


@router.post("/public/shares/{token}/reactions", status_code=status.HTTP_204_NO_CONTENT)
async def submit_reaction(token: str, body: ShareReactionRequest) -> Response:
    client = get_supabase_client()
    share = get_active_share(client, token)
    # Reactions attach to the album; any active share link (view or contribute) may react.
    add_reaction(client, str(share["album_id"]), str(share["id"]), body.reaction, body.session_key)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
