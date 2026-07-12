from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

MeetingType = Literal["family", "friend", "work", "university"]

MEETING_TYPE_LABELS: dict[str, str] = {
    "family": "가족",
    "friend": "친구",
    "work": "직장인",
    "university": "대학생",
}


TemplateType = Literal["A", "B", "C"]


class PhotoStoryInput(BaseModel):
    """사진 한 장에 대한 설명(스토리)."""

    order: int = Field(ge=0, lt=10, description="업로드 슬롯 순서 (0부터 연속)")
    user: str = Field(default="", max_length=30, description="작성자 이름(선택)")
    text: str = Field(min_length=1, max_length=300, description="사진 설명 스토리")


class AlbumUploadResponse(BaseModel):
    album_id: UUID
    meeting_type: MeetingType
    template: TemplateType
    title: str
    date: str
    narrative: str
    image_url: str
    share_url: str
    created_at: datetime


class AlbumDetailResponse(BaseModel):
    """공유 링크(/album/{id}) 페이지용 앨범 상세."""

    album_id: UUID
    meeting_type: str
    template: str
    title: str
    date: str
    narrative: str
    image_url: str
    share_url: str
    created_at: datetime


class NarrativeUpdate(BaseModel):
    narrative: str = Field(min_length=1, max_length=800)


class AuthBootstrapResponse(BaseModel):
    profile_id: UUID
    family_id: UUID
