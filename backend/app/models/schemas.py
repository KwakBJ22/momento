from datetime import datetime
from typing import Any, Literal
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
    media: list["AlbumMediaSummary"] = Field(default_factory=list)


class NarrativeUpdate(BaseModel):
    narrative: str = Field(min_length=1, max_length=800)


class StoryInputUpdate(BaseModel):
    value: str = Field(default="", max_length=300)


class StoryInputResponse(BaseModel):
    key: Literal["memory_hint", "people", "highlight"]
    value: str


class StoryRegenerateResponse(BaseModel):
    narrative: str


class ShareLinkCreateRequest(BaseModel):
    expires_at: datetime | None = None


class ShareLinkResponse(BaseModel):
    id: UUID
    status: str
    expires_at: datetime | None
    view_count: int
    created_at: datetime
    deactivated_at: datetime | None = None
    share_url: str | None = None


class PublicMediaItem(BaseModel):
    media_type: str
    mime_type: str
    processing_status: str
    original_filename: str | None = None


class PublicShareAlbumResponse(BaseModel):
    title: str
    narrative: str
    image_url: str
    media: list[PublicMediaItem]
    og_title: str
    og_description: str


class GuestMemoryRequest(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    memory: str = Field(min_length=1, max_length=300)
    website: str = Field(default="", max_length=200)


class GuestMemoryResponse(BaseModel):
    claim_token: str


class GuestMemoryClaimRequest(BaseModel):
    claim_token: str = Field(min_length=20, max_length=200)


class ShareReactionRequest(BaseModel):
    reaction: Literal["remember", "warm", "smile"]
    session_key: str = Field(min_length=16, max_length=200)


class GuestAlbumUploadResponse(AlbumUploadResponse):
    guest_token: str


class GuestAlbumClaimRequest(BaseModel):
    guest_token: str = Field(min_length=20, max_length=200)


class GuestAnalyticsEventRequest(BaseModel):
    event_name: Literal["landing_viewed", "primary_cta_clicked", "preview_viewed", "save_cta_clicked", "login_started", "enrichment_started"]


class AuthBootstrapResponse(BaseModel):
    profile_id: UUID
    family_id: UUID


class AlbumPhotoUrlResponse(BaseModel):
    id: UUID
    sort_order: int
    comment: str | None = None
    original_url: str
    thumbnail_url: str


class AlbumPhotoUrlsResponse(BaseModel):
    photos: list[AlbumPhotoUrlResponse]


class PhotoCommentUpdate(BaseModel):
    comment: str | None = Field(default=None, max_length=300)


class PhotoCommentResponse(BaseModel):
    id: UUID
    comment: str | None = None


class AlbumMediaSummary(BaseModel):
    id: UUID
    media_type: Literal["image", "gif", "video", "audio", "document"]
    mime_type: str
    original_filename: str | None
    file_size: int
    width: int | None
    height: int | None
    duration_seconds: float | None
    page_count: int | None
    sort_order: int
    processing_status: Literal["pending", "processing", "ready", "failed"]
    metadata: dict[str, Any] = Field(default_factory=dict)


class AlbumMediaUploadResponse(AlbumMediaSummary):
    pass


class AlbumMediaUrlResponse(AlbumMediaSummary):
    original_url: str
    preview_url: str | None
    thumbnail_url: str | None


class AlbumMediaUrlsResponse(BaseModel):
    media: list[AlbumMediaUrlResponse]


FamilyRole = Literal["owner", "admin", "member", "viewer"]
InvitableFamilyRole = Literal["admin", "member", "viewer"]
AlbumMemberRole = Literal["owner", "editor", "contributor", "viewer"]
InvitationStatus = Literal["pending", "accepted", "revoked", "expired"]


class FamilySummaryResponse(BaseModel):
    family_id: UUID
    name: str
    role: FamilyRole


class FamilyMemberResponse(BaseModel):
    id: UUID
    profile_id: UUID
    display_name: str
    role: FamilyRole
    joined_at: datetime | None
    invited_by: UUID | None


class FamilyMembersListResponse(BaseModel):
    members: list[FamilyMemberResponse]


class FamilyInvitationResponse(BaseModel):
    id: UUID
    invitee_email: str
    role: InvitableFamilyRole
    status: InvitationStatus
    expires_at: datetime
    accepted_at: datetime | None
    revoked_at: datetime | None
    created_at: datetime
    invite_url: str | None = None


class FamilyInvitationsListResponse(BaseModel):
    invitations: list[FamilyInvitationResponse]


class CreateFamilyInvitationRequest(BaseModel):
    invitee_email: str = Field(min_length=3, max_length=320)
    role: InvitableFamilyRole = "member"


class CreateFamilyInvitationResponse(BaseModel):
    invitation: FamilyInvitationResponse
    invite_url: str
    invite_token: str


class AcceptFamilyInvitationRequest(BaseModel):
    token: str = Field(min_length=16, max_length=256)


class AcceptFamilyInvitationResponse(BaseModel):
    family_id: UUID


class UpdateFamilyMemberRoleRequest(BaseModel):
    role: InvitableFamilyRole


class AlbumMemberResponse(BaseModel):
    id: UUID
    profile_id: UUID
    display_name: str
    role: AlbumMemberRole
    invited_by: UUID | None
    created_at: datetime


class AlbumMembersListResponse(BaseModel):
    members: list[AlbumMemberResponse]


class UpsertAlbumMemberRequest(BaseModel):
    profile_id: UUID
    role: AlbumMemberRole = "viewer"


class UpdateAlbumMemberRoleRequest(BaseModel):
    role: AlbumMemberRole


AnswerType = Literal["text", "voice"]
QuestionStatus = Literal["active", "archived"]


class GenerateQuestionsRequest(BaseModel):
    media_id: UUID | None = None
    force: bool = False


class GenerateQuestionsResponse(BaseModel):
    generated_media_ids: list[UUID]
    skipped_media_ids: list[UUID]
    question_count: int


class MemoryAnswerResponse(BaseModel):
    id: UUID
    question_id: UUID
    profile_id: UUID
    display_name: str
    answer: str
    answer_type: AnswerType
    voice_url: str | None
    created_at: datetime
    updated_at: datetime


class MemoryQuestionResponse(BaseModel):
    id: UUID
    album_id: UUID
    media_id: UUID
    question: str
    sort_order: int
    status: QuestionStatus
    created_at: datetime
    thumbnail_url: str | None = None
    answers: list[MemoryAnswerResponse] = Field(default_factory=list)


class MemoryQuestionsListResponse(BaseModel):
    questions: list[MemoryQuestionResponse]
    can_regenerate: bool
    can_analyze_media: bool


class AnalyzeMediaRequest(BaseModel):
    media_id: UUID | None = None


class AnalyzeMediaResponse(BaseModel):
    analyzed_media_ids: list[UUID]
    skipped_media_ids: list[UUID]


class UpsertMemoryAnswerRequest(BaseModel):
    answer: str = Field(max_length=2000)
    answer_type: AnswerType = "text"
    voice_url: str | None = None


class UpdateMemoryAnswerRequest(BaseModel):
    answer: str = Field(min_length=1, max_length=2000)
    answer_type: AnswerType | None = None
    voice_url: str | None = None


AlbumDetailResponse.model_rebuild()
