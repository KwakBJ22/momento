from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from time import monotonic
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response, status

from app.config import get_settings
from app.models.schemas import (
    DEFAULT_ALBUM_PHOTO_CAPACITY,
    GuestbookCreateRequest, GuestbookDeleteRequest, GuestbookItem,
    PublicContributionItem, PublicMediaItem,
    PublicShareAlbumResponse, ShareLinkCreateRequest, ShareLinkResponse, ShareReactionRequest, ShareViewerContributor,
    AlbumPhotoUrlResponse,
)
from app.services.authorization import require_album_edit_settings
from app.services.auth import optional_authenticated_user, require_authenticated_user
from app.services.membership import get_album_access
from app.services.bookmark_service import add_bookmark, is_bookmarked
from app.services.visitor_key import resolve_visitor_key
from app.services.share_service import (
    add_guestbook_entry, add_reaction, contribution_block_reason, create_share_link, deactivate_share_link,
    delete_own_guestbook_entry, get_active_share, increment_view, list_guestbook_entries,
    list_share_links, log_event, reaction_counts,
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
from app.services.collaboration_service import album_document_photo_ids, list_contributors, list_photo_memories, pending_contribution_rules, resolve_contributor_names, unpack_edition_snapshot
from app.services.collaboration_service import count_active_contributors, join_as_contributor, new_guest_id
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
def create_album_share_link(album_id: str, body: ShareLinkCreateRequest, authenticated_user_id: str = Depends(require_authenticated_user)) -> ShareLinkResponse:
    client = get_supabase_client()
    album = get_album_record(client, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    require_album_edit_settings(get_album_access(client, album, authenticated_user_id))
    if body.expires_at and body.expires_at <= datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="만료일은 미래여야 합니다.")
    row, token = create_share_link(client, album_id, authenticated_user_id, body.expires_at, body.kind)
    settings = get_settings()
    log_event(client, "share_link_created", album_id=album_id, share_link_id=row["id"])
    return _share_response(row, f"{settings.frontend_base_url.rstrip('/')}/s/{token}")


@router.get("/albums/{album_id}/share-links", response_model=list[ShareLinkResponse])
def get_album_share_links(album_id: str, authenticated_user_id: str = Depends(require_authenticated_user)) -> list[ShareLinkResponse]:
    client = get_supabase_client()
    album = get_album_record(client, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    require_album_edit_settings(get_album_access(client, album, authenticated_user_id))
    return [_share_response(row) for row in list_share_links(client, album_id)]


@router.post("/albums/{album_id}/share-links/{share_id}/deactivate", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_album_share_link(album_id: str, share_id: str, authenticated_user_id: str = Depends(require_authenticated_user)) -> Response:
    client = get_supabase_client()
    album = get_album_record(client, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    require_album_edit_settings(get_album_access(client, album, authenticated_user_id))
    deactivate_share_link(client, album_id, share_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/public/shares/{token}", response_model=PublicShareAlbumResponse)
def get_public_share(
    token: str,
    request: Request,
    edition: int | None = None,
    x_woorialbum_visitor: str | None = Header(default=None),
    user_id: str | None = Depends(optional_authenticated_user),
) -> PublicShareAlbumResponse:
    _rate_limit(f"view:{token}", _PUBLIC_LIMIT)
    client = get_supabase_client()
    share = get_active_share(client, token)
    album = get_album_record(client, str(share["album_id"]))
    if not album:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    increment_view(client, str(share["id"]))
    # 방문자를 사람 단위로 센다(§1) — 로그인했으면 계정으로, 아니면 브라우저의 무작위
    # 토큰으로 키를 만든다. 판정은 visitor_key 한 곳에 있다.
    log_event(
        client, "public_album_viewed", album_id=str(album["id"]), share_link_id=str(share["id"]),
        metadata={"source": "share"}, visitor_key=resolve_visitor_key(user_id, x_woorialbum_visitor),
    )
    settings = get_settings()
    media = [PublicMediaItem(media_type=row["media_type"], mime_type=row["mime_type"], processing_status=row["processing_status"], original_filename=row.get("original_filename")) for row in get_album_media_records(client, str(album["id"]))]
    narrative = str(album.get("epilogue") or album.get("narrative") or "").strip()
    album_id = str(album["id"])
    photo_records = get_album_photo_records(client, album_id)
    memories = list_photo_memories(client, album_id)
    contributors = list_contributors(client, album_id)
    contributor_names = {
        str(row["id"]): _public_author_name(row.get("display_name"))
        for row in contributors
    }
    # ★ 판정은 collaboration_service 한 곳에 있다. 앨범 화면(album.py)도 **같은 자**를
    #   쓴다 — 규칙이 두 벌이면 언젠가 갈린다(OPEN_ITEMS §2-1 이 그렇게 났다).
    pending = pending_contribution_rules(album, contributors)

    pending_photo_records = [photo for photo in photo_records if pending.is_pending_photo(photo)] if edition is None else []
    shared_photo_records = [photo for photo in photo_records if not pending.is_pending_photo(photo)]
    # 사진이 그려지는 자리 — 이 사진에 달린 한마디는 사진 밑에 그대로 나온다(K-24).
    rendered_photo_ids = {str(photo["id"]) for photo in shared_photo_records}
    # ★ K-24: 한마디는 `아직 반영 안 된 참여` 로 치지 않는다.
    #   사진은 주최자가 반영해야 앨범에 들어간다(그래서 위 `is_pending_photo` 는 그대로다).
    #   그런데 한마디까지 같은 잣대로 걸러 내는 바람에, 공유 화면에서는 참여자가 쓴 글이
    #   사진 밑에서 사라지고 주최자가 쓴 것만 남았다. 사람이 남긴 글을 임의로 고르지 않는다.
    #   사진이 아직 안 그려지는 한마디만 `새로 더해진` 자리에 남는다 — 그래야 어디에도
    #   안 보이는 글이 생기지 않고, 같은 글이 두 곳에 겹치지도 않는다.
    pending_memories = [
        memory for memory in memories
        if pending.is_pending_memory(memory) and str(memory.get("photo_id") or "") not in rendered_photo_ids
    ] if edition is None else []
    current_document, selected_append_pages = _public_edition_document_and_pages(album, edition)
    document_photo_ids = album_document_photo_ids(current_document)
    visible_photo_records = [
        photo for photo in shared_photo_records
        if not document_photo_ids or str(photo["id"]) in document_photo_ids
    ]
    chapter_stories = visible_date_stories(album.get("chapter_stories"), visible_photo_records)

    all_memories_by_photo: dict[str, list[dict]] = {}
    for mem in memories:
        all_memories_by_photo.setdefault(str(mem.get("photo_id") or ""), []).append(mem)

    # 참여자의 **지금** 이름 (list_contributors 가 profiles 에서 이미 채워 둔 값 — §1).
    contributor_display = {
        str(row["id"]): str(row.get("display_name") or "").strip() for row in contributors
    }

    def memory_author(memory: dict[str, object]) -> str | None:
        """한마디에 붙는 이름 — 못 풀어도 **글은 남긴다**. 이름만 비운다(K-17 과 같은 방식).

        저장된 이름이 먼저다(쓸 때의 이름). 비어 있으면 지금 참여자 이름으로 채우고,
        그것도 없으면 None 이다. `익명` 같은 말을 지어내 붙이지 않는다 — 이름 자리가
        아예 없는 것과, 누군가 `익명`이라고 이름을 지은 것은 다르다.
        """
        name = str(memory.get("author_name") or "").strip() or contributor_display.get(
            str(memory.get("contributor_id") or ""), ""
        )
        return None if name in _LEGACY_ANONYMOUS_NAMES else name

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
            caption=str(photo.get("caption") or "").strip() or None,
            comments=[
                {"author": memory_author(m), "text": str(m.get("comment") or "")}
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

    memory_by_id = {str(memory["id"]): memory for memory in memories}
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
                "author_name": memory_author(memory) or "",
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
                caption=str(photo.get("caption") or "").strip() or None,
            )
        )
    for memory in pending_memories:
        author_name = memory_author(memory) or ""
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

    # ★ 자동 참여를 하지 않는다(§1) — 링크를 열었다고 참여자로 만들지 않는다.
    # 다만 **이미** 참여자인 사람은 다시 묻지 않는다. 기존 행이 있으면 그대로 내려준다.
    # 행을 만들지 않는다: 여기서는 읽기만 한다.
    viewer_contributor = None
    if user_id:
        existing = (
            client.table("album_contributors")
            .select("id, user_id, display_name, guest_id")
            .eq("album_id", album_id)
            .eq("user_id", user_id)
            .eq("status", "active")
            .limit(1)
            .execute()
            .data
            or []
        )
        if existing:
            # 이름은 profiles 의 지금 값이다(D-2) — 저장된 스냅샷을 쓰지 않는다.
            row = resolve_contributor_names(client, existing)[0]
            viewer_contributor = ShareViewerContributor(
                contributor_id=UUID(str(row["id"])),
                display_name=str(row.get("display_name") or "참여자"),
                guest_id=UUID(str(row["guest_id"])) if row.get("guest_id") else None,
            )

    return PublicShareAlbumResponse(
        viewer_bookmarked=bool(user_id) and is_bookmarked(client, str(user_id), album_id),
        viewer_contributor=viewer_contributor,
        # PDF 저장이 버전을 맞춰 보낼 수 있게 현재 버전을 알려준다.
        album_version=int(album.get("album_version") or 0),
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
        photo_limit=int(album.get("photo_limit") or DEFAULT_ALBUM_PHOTO_CAPACITY),
        pending_items=pending_items[:30],
        living_append_pages=living_append_pages,
        edition_previous=_public_previous_edition(album, edition),
        edition_is_latest=edition is None,
        og_title=str(album.get("title") or "우리의 추억"),
        og_description=(narrative[:120] or "함께 만든 추억 앨범"),
        # 함께한 사람 수 — 주최자를 포함한다(§1). 세는 식은 count_active_contributors 한 곳.
        contributor_count=count_active_contributors(client, album_id),
        # 프런트는 링크 종류를 알지 않는다. "무엇을 할 수 있는가"만 본다(SCREEN_SPEC §1).
        can_contribute=contribution_block_reason(share, album) is None,
        reaction_counts=reaction_counts(client, album_id),
        guestbook=[GuestbookItem(**entry) for entry in list_guestbook_entries(client, album_id)],
    )


@router.post("/public/shares/{token}/contribute")
def start_public_contribution(
    token: str,
    # dict[str, Any], not dict[str, str]: the client legitimately sends
    # {"guest_id": null, ...} for signed-in visitors, and a null value must not
    # fail request validation with a 422 that masks the real state.
    body: dict[str, Any] | None = None,
    authenticated_user_id: str | None = Depends(optional_authenticated_user),
) -> dict[str, str | None]:
    """Create or restore a contributor session from an active share link."""
    _rate_limit(f"contribute:{token}", _GUEST_LIMIT)
    client = get_supabase_client()
    share = get_active_share(client, token)
    album = get_album_record(client, str(share["album_id"]))
    if not album:
        raise HTTPException(status_code=404, detail="Album was not found.")
    # The album owner can always add to their own album — the view/closed gates are
    # about outside participants, not the owner adding via their own screen.
    is_owner = bool(authenticated_user_id) and authenticated_user_id in {
        str(album.get("created_by") or ""), str(album.get("owner_id") or "")
    }
    if not is_owner:
        # 링크 종류·참여 종료 판정은 contribution_block_reason 한 곳에서만 한다 —
        # 공유 조회 응답의 can_contribute 도 같은 함수를 쓴다(SCREEN_SPEC §1).
        blocked = contribution_block_reason(share, album)
        if blocked:
            raise HTTPException(status_code=403, detail=blocked)
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


@router.put("/public/shares/{token}/bookmark", status_code=status.HTTP_204_NO_CONTENT)
def bookmark_shared_album(
    token: str,
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> Response:
    """구경하던 앨범을 `담아둔 앨범` 에 넣는다 (K-7b · SCREEN_SPEC §1).

    ★ **담아두기는 구경꾼의 행동이다**(§1). 예전에는 `PUT /albums/{id}/bookmark` 하나뿐이었고
    그 자리가 `require_album_read`(멤버 요구)를 걸고 있어서, 구경꾼은 로그인해도 **403** 이었다.
    실측(2026-08-09): 로그인 성공한 기기에서 세 번 눌러 세 번 다 403,
    `album_bookmarks` 0건. 화면은 "로그인이 안 됐나 보다" 하고 카드를 그대로 뒀고
    사용자는 또 눌렀다 — 무한 반복이었다.

    ★ **서버는 "구경꾼인지" 까지 따지지 않는다.** 자기 목록에 자기가 담는 일이라 남에게
    해가 없다. 누구에게 이 버튼을 보일지는 화면이 §1 대로 정한다 — 판정을 서버에도 두면
    같은 판단이 두 곳이 된다(§1).

    ★ **로그인은 필요하다.** 어디에 담을지가 계정이다.
    ★ 링크가 죽었으면 `get_active_share` 가 J-9 의 세 갈래 문구로 막는다. 새로 만들지 않는다.
    ★ 담을 때 쓴 **링크를 함께 저장한다.** 구경꾼은 `/album/{id}` 로 못 열기 때문이다.
    """
    client = get_supabase_client()
    share = get_active_share(client, token)
    add_bookmark(client, authenticated_user_id, str(share["album_id"]), share_token=token)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/public/shares/{token}/reactions", status_code=status.HTTP_204_NO_CONTENT)
def submit_reaction(token: str, body: ShareReactionRequest) -> Response:
    client = get_supabase_client()
    share = get_active_share(client, token)
    # Reactions attach to the album; any active share link (view or contribute) may react.
    add_reaction(client, str(share["album_id"]), str(share["id"]), body.reaction, body.session_key)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/public/shares/{token}/guestbook", response_model=GuestbookItem, status_code=status.HTTP_201_CREATED)
def submit_guestbook_entry(token: str, body: GuestbookCreateRequest) -> GuestbookItem:
    """Leave an album guestbook message. Any active share link (view or contribute) may write."""
    _rate_limit(f"guestbook:{token}", _GUEST_LIMIT)
    client = get_supabase_client()
    share = get_active_share(client, token)
    entry = add_guestbook_entry(
        client,
        str(share["album_id"]),
        body.author_name,
        body.message,
        body.session_key,
        contributor_id=str(body.contributor_id) if body.contributor_id else None,
    )
    return GuestbookItem(
        id=entry["id"],
        author_name=str(entry.get("author_name") or ""),
        message=str(entry.get("message") or ""),
        created_at=entry.get("created_at"),
    )


@router.post("/public/shares/{token}/guestbook/{entry_id}/delete", status_code=status.HTTP_204_NO_CONTENT)
def delete_guestbook_entry(token: str, entry_id: str, body: GuestbookDeleteRequest) -> Response:
    """Soft-delete one's own guestbook entry (session-hash ownership)."""
    client = get_supabase_client()
    share = get_active_share(client, token)
    delete_own_guestbook_entry(client, str(share["album_id"]), entry_id, body.session_key)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
