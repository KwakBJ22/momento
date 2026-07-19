from __future__ import annotations

import logging
import time
from collections import defaultdict, deque
from datetime import date as date_cls, datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from postgrest.exceptions import APIError

from app.config import get_settings
from app.models.schemas import GuestAlbumClaimRequest, GuestAlbumUploadResponse, GuestAnalyticsEventRequest
from app.services.auth import require_authenticated_user
from app.services.guest_service import claim_guest_album, create_guest_session
from app.services.image_service import bytes_to_images, generate_album, image_to_png_bytes
from app.services.image_upload_service import process_upload
from app.services.membership import save_album_member
from app.services.openai_service import generate_narrative, parse_stories_json
from app.services.share_service import log_event
from app.services.supabase import (
    create_album_id, delete_album_record, delete_storage_paths, ensure_default_family,
    get_supabase_client, get_public_url, save_album_media_records, save_album_photo_records,
    save_album_record, upload_album_photo_assets, upload_result_image,
)

router = APIRouter(prefix="/api", tags=["guest-onboarding"])
logger = logging.getLogger(__name__)
_GUEST_UPLOADS: dict[str, deque[float]] = defaultdict(deque)
_WINDOW_SECONDS = 60
_MAX_UPLOADS_PER_WINDOW = 3


def _allow_guest_upload(request: Request) -> None:
    """Small in-process backstop; production should also enforce this at the edge."""
    key = request.client.host if request.client else "unknown"
    now = time.monotonic()
    attempts = _GUEST_UPLOADS[key]
    while attempts and attempts[0] <= now - _WINDOW_SECONDS:
        attempts.popleft()
    if len(attempts) >= _MAX_UPLOADS_PER_WINDOW:
        raise HTTPException(status_code=429, detail="잠시 후 다시 시도해주세요.")
    attempts.append(now)


def _safe_event(client: Any, event_name: str, album_id: str | None = None) -> None:
    try:
        log_event(client, event_name, album_id=album_id, metadata={"source": "guest_onboarding"})
    except Exception as exc:
        # Analytics must never block creation or recovery of a guest album.
        pass


@router.post("/guest-analytics", status_code=202)
async def track_guest_event(payload: GuestAnalyticsEventRequest) -> None:
    """Accept only an allowlisted event name; no identifiers or form content are retained."""
    _safe_event(get_supabase_client(get_settings()), payload.event_name)


@router.post("/guest/upload-album", response_model=GuestAlbumUploadResponse)
async def upload_guest_album(
    request: Request,
    photos: list[UploadFile] = File(...),
    stories: str = Form("[]"),
    meeting_type: str = Form("family"),
    template: str = Form("B"),
    title: str = Form("우리의 추억"),
    description: str = Form(""),
    website: str = Form(""),
) -> GuestAlbumUploadResponse:
    started_at = time.perf_counter()
    logger.info("Guest album upload started: photo_count=%s", len(photos))
    if website.strip():
        raise HTTPException(status_code=400, detail="요청을 처리할 수 없어요.")
    _allow_guest_upload(request)
    settings = get_settings()
    if not photos or len(photos) > settings.max_photos:
        raise HTTPException(status_code=400, detail=f"사진은 1~{settings.max_photos}장까지 올릴 수 있어요.")
    if meeting_type not in {"family", "friend", "work", "university"} or template.upper() not in {"A", "B", "C"}:
        raise HTTPException(status_code=400, detail="앨범 설정을 확인해주세요.")

    try:
        story_items = parse_stories_json(stories)
    except HTTPException:
        story_items = []
    if not story_items:
        story_items = [{"order": index, "user": "", "text": ""} for index in range(len(photos))]
    if len(story_items) != len(photos) or sorted(int(item.get("order", -1)) for item in story_items) != list(range(len(photos))):
        raise HTTPException(status_code=400, detail="사진 순서를 다시 확인해주세요.")
    for item in story_items:
        item["text"] = str(item.get("text", "")).strip()
        item["user"] = str(item.get("user", "")).strip()

    client = get_supabase_client(settings)
    _safe_event(client, "upload_started")
    album_id, guest_scope_id = create_album_id(), str(uuid4())
    title = title.strip() or "우리의 추억"
    event_date = date_cls.today().isoformat()
    uploaded_paths: list[str] = []
    result_path = ""
    album_saved = False
    try:
        processed_photos = [process_upload(photo, settings) for photo in photos]
        photo_records: list[dict[str, Any]] = []
        media_records: list[dict[str, Any]] = []
        photo_paths: list[str] = []
        ordered_bytes: list[bytes] = []
        for index, processed in enumerate(processed_photos):
            photo_id = str(uuid4())
            original_path, thumbnail_path = upload_album_photo_assets(client, guest_scope_id, album_id, photo_id, processed, settings)
            uploaded_paths.extend([original_path, thumbnail_path])
            photo_paths.append(original_path)
            story_items[index]["_path"] = original_path
            ordered_bytes.append(processed.display_bytes)
            photo_records.append({"id": photo_id, "album_id": album_id, "storage_bucket": settings.supabase_private_storage_bucket, "storage_path": original_path, "thumbnail_bucket": settings.supabase_private_storage_bucket, "thumbnail_path": thumbnail_path, "original_filename": photos[index].filename, "mime_type": processed.original_mime_type, "byte_size": len(processed.original_bytes), "checksum_sha256": processed.checksum_sha256, "sort_order": index, "caption": story_items[index]["text"], "legacy_author_label": story_items[index]["user"] or None, "status": "ready"})
            media_records.append({"id": photo_id, "album_id": album_id, "media_type": "gif" if processed.original_mime_type == "image/gif" else "image", "mime_type": processed.original_mime_type, "original_filename": photos[index].filename, "original_path": original_path, "thumbnail_path": thumbnail_path, "file_size": len(processed.original_bytes), "sort_order": index, "processing_status": "ready", "metadata": {"source": "guest_onboarding"}})
        narrative = await generate_narrative(story_items, meeting_type, title, settings, event_date=event_date, description=description.strip(), existing_answers="", media_records=media_records)
        image = generate_album(template.upper(), photos=bytes_to_images(ordered_bytes), stories=story_items, title=title, date=event_date, narrative=None)
        result_path = upload_result_image(client, album_id, image_to_png_bytes(image), settings)
        save_album_record(client, album_id, None, None, meeting_type, template.upper(), title, event_date, narrative, photo_paths, [{"order": item["order"], "user": item["user"], "text": item["text"], "path": item["_path"]} for item in story_items], result_path)
        album_saved = True
        save_album_photo_records(client, photo_records)
        save_album_media_records(client, media_records)
        token = create_guest_session(client, album_id)
    except Exception as exc:
        logger.exception("Guest album upload failed: album_id=%s photo_count=%s", album_id, len(photos))
        if album_saved:
            try:
                delete_album_record(client, album_id)
            except Exception:
                pass
        delete_storage_paths(client, settings.supabase_private_storage_bucket, uploaded_paths)
        if result_path:
            delete_storage_paths(client, settings.supabase_storage_bucket, [result_path])
        if isinstance(exc, HTTPException):
            raise
        if isinstance(exc, APIError) and getattr(exc, "code", None) == "PGRST205":
            raise HTTPException(
                status_code=503,
                detail="게스트 앨범 저장 준비가 아직 완료되지 않았어요. 데이터베이스 마이그레이션을 적용한 뒤 다시 시도해주세요.",
            ) from exc
        raise
    logger.info("Guest album upload completed: album_id=%s duration_seconds=%.2f", album_id, time.perf_counter() - started_at)
    _safe_event(client, "upload_completed", album_id)
    _safe_event(client, "guest_album_generated", album_id)
    return GuestAlbumUploadResponse(album_id=UUID(album_id), meeting_type=meeting_type, template=template.upper(), title=title, date=event_date, narrative=narrative, image_url=get_public_url(client, result_path, settings), share_url="", created_at=datetime.now(timezone.utc), guest_token=token)


@router.post("/guest-albums/claim")
async def claim_guest_album_after_login(
    payload: GuestAlbumClaimRequest,
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> dict[str, str]:
    settings = get_settings()
    client = get_supabase_client(settings)
    family_id = ensure_default_family(client, authenticated_user_id)
    album_id = claim_guest_album(client, payload.guest_token, authenticated_user_id, family_id)
    save_album_member(client, album_id, authenticated_user_id, "owner", authenticated_user_id)
    _safe_event(client, "guest_album_claimed", album_id)
    return {"album_id": album_id, "family_id": family_id}
