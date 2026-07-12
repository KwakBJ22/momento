from datetime import date as date_cls
from datetime import datetime, timezone
from typing import Any, get_args
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status

from app.config import Settings, get_settings
from app.models.schemas import (
    AlbumDetailResponse,
    AlbumUploadResponse,
    MeetingType,
    NarrativeUpdate,
    TemplateType,
)
from app.services.image_service import (
    bytes_to_images,
    generate_album,
    image_to_png_bytes,
)
from app.services.openai_service import generate_narrative, parse_stories_json
from app.services.supabase import (
    create_album_id,
    delete_album_record,
    get_album_record,
    get_public_url,
    get_supabase_client,
    save_album_record,
    update_album_narrative,
    upload_photo,
    upload_result_image,
    validate_image,
)
from app.services.auth import require_authenticated_user

router = APIRouter(prefix="/api", tags=["album"])

_VALID_MEETING_TYPES = set(get_args(MeetingType))
_VALID_TEMPLATES = set(get_args(TemplateType))


@router.post("/upload-album", response_model=AlbumUploadResponse)
async def upload_album(
    photos: list[UploadFile] = File(..., description="최대 10장의 사진"),
    stories: str = Form(..., description='JSON 배열: [{"order":0,"user":"","text":"..."}, ...]'),
    meeting_type: str = Form("friend", description="family/friend/work/university"),
    template: str = Form("B", description="앨범 템플릿 A(타임라인)/B(콜라주)/C(스토리북)"),
    title: str = Form("우리의 모임", description="모임 제목"),
    date: str = Form("", description="모임 날짜 (YYYY-MM-DD)"),
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> AlbumUploadResponse:
    settings = get_settings()

    if not photos:
        raise HTTPException(status_code=400, detail="최소 1장의 사진이 필요합니다.")
    if len(photos) > settings.max_photos:
        raise HTTPException(status_code=400, detail=f"사진은 최대 {settings.max_photos}장까지 업로드할 수 있습니다.")
    if meeting_type not in _VALID_MEETING_TYPES:
        raise HTTPException(status_code=400, detail="유효하지 않은 모임 유형입니다.")

    template = (template or "B").upper()
    if template not in _VALID_TEMPLATES:
        raise HTTPException(status_code=400, detail="유효하지 않은 템플릿입니다. (A/B/C)")

    title = title.strip() or "우리의 모임"
    event_date = date.strip() or date_cls.today().isoformat()

    story_items = parse_stories_json(stories)
    if len(story_items) != len(photos):
        raise HTTPException(status_code=400, detail="사진 수와 스토리 수가 일치해야 합니다.")

    orders = [item["order"] for item in story_items]
    if len(set(orders)) != len(orders):
        raise HTTPException(status_code=400, detail="story order 값이 중복되었습니다.")
    if sorted(orders) != list(range(len(photos))):
        raise HTTPException(status_code=400, detail="story order는 0부터 연속된 정수여야 합니다.")
    for item in story_items:
        if not item["text"]:
            raise HTTPException(status_code=400, detail="모든 사진에 설명을 입력해주세요.")

    client = get_supabase_client(settings)
    album_id = create_album_id()

    items_by_order: dict[int, dict[str, Any]] = {int(item["order"]): item for item in story_items}
    photo_paths: list[str] = []
    ordered_bytes: list[bytes] = []

    for index, photo in enumerate(photos):
        content = validate_image(photo, settings)
        content_type = photo.content_type or "image/jpeg"
        path = upload_photo(client, album_id, index, content, content_type, settings)
        photo_paths.append(path)
        items_by_order[index]["_path"] = path
        ordered_bytes.append(content)

    ordered_stories = [items_by_order[i] for i in range(len(photos))]

    narrative = await generate_narrative(story_items, meeting_type, title, settings)

    images = bytes_to_images(ordered_bytes)
    # 내러티브("우리의 이야기")는 그리드에 굽지 않고 별도 반환한다.
    # 프론트에서 사용자가 편집 후 저장 시 이미지에 합성한다.
    album_img = generate_album(
        template,
        photos=images,
        stories=ordered_stories,
        title=title,
        date=event_date,
        narrative=None,
    )
    result_bytes = image_to_png_bytes(album_img)
    result_path = upload_result_image(client, album_id, result_bytes, settings)
    image_url = get_public_url(client, result_path, settings)

    photo_meta = [
        {"order": item["order"], "user": item["user"], "text": item["text"], "path": item["_path"]}
        for item in ordered_stories
    ]

    save_album_record(
        client,
        album_id=album_id,
        owner_id=authenticated_user_id,
        meeting_type=meeting_type,
        template=template,
        title=title,
        event_date=event_date,
        narrative=narrative,
        photo_paths=photo_paths,
        photo_meta=photo_meta,
        result_path=result_path,
    )

    share_url = f"{settings.frontend_base_url.rstrip('/')}/album/{album_id}"

    return AlbumUploadResponse(
        album_id=UUID(album_id),
        meeting_type=meeting_type,  # type: ignore[arg-type]
        template=template,  # type: ignore[arg-type]
        title=title,
        date=event_date,
        narrative=narrative,
        image_url=image_url,
        share_url=share_url,
        created_at=datetime.now(timezone.utc),
    )


def _record_to_detail(record: dict[str, Any], settings: Settings, client: Any) -> AlbumDetailResponse:
    album_id = str(record["id"])
    image_url = get_public_url(client, record["result_path"], settings) if record.get("result_path") else ""
    return AlbumDetailResponse(
        album_id=UUID(album_id),
        meeting_type=record.get("meeting_type", "friend"),
        template=record.get("template", "B"),
        title=record.get("title", "우리의 모임"),
        date=record.get("event_date", ""),
        narrative=record.get("narrative", ""),
        image_url=image_url,
        share_url=f"{settings.frontend_base_url.rstrip('/')}/album/{album_id}",
        created_at=record["created_at"],
    )


@router.get("/albums/{album_id}", response_model=AlbumDetailResponse)
async def get_album(album_id: str) -> AlbumDetailResponse:
    settings = get_settings()
    client = get_supabase_client(settings)
    record = get_album_record(client, album_id)
    if not record:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    return _record_to_detail(record, settings, client)


@router.patch("/albums/{album_id}", response_model=AlbumDetailResponse)
async def patch_album(
    album_id: str,
    body: NarrativeUpdate,
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> AlbumDetailResponse:
    settings = get_settings()
    client = get_supabase_client(settings)
    record = get_album_record(client, album_id)
    if not record:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    if str(record.get("owner_id") or "") != authenticated_user_id:
        raise HTTPException(status_code=403, detail="You do not have permission to edit this album.")

    updated = update_album_narrative(client, album_id, body.narrative.strip())
    return _record_to_detail(updated or {**record, "narrative": body.narrative.strip()}, settings, client)


@router.delete("/albums/{album_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_album(
    album_id: str,
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> Response:
    settings = get_settings()
    client = get_supabase_client(settings)
    record = get_album_record(client, album_id)
    if not record:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    if str(record.get("owner_id") or "") != authenticated_user_id:
        raise HTTPException(status_code=403, detail="You do not have permission to delete this album.")

    delete_album_record(client, album_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
