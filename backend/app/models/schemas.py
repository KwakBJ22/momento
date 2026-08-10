from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.categories import CATEGORY_LABELS

# 앨범 총 수용량 — albums.photo_limit 의 폴백·기본값 (PO 결정 B: 30 → 100).
# "한 번에 올리는 상한"(settings.max_photos=30, 앨범 생성 1회 업로드)과는 별개다:
# 30장은 업로드 성공률·40MB 가드 때문에 유지하고, 앨범이 담는 총량만 100이다.
# DB DEFAULT 와 같이 움직인다: supabase/migrations/20260805…_album_photo_limit_100.sql
DEFAULT_ALBUM_PHOTO_CAPACITY = 100

MeetingType = Literal["family", "friend", "work", "university"]

MEETING_TYPE_LABELS: dict[str, str] = {
    "family": "가족",
    "friend": "친구",
    "work": "직장인",
    "university": "대학생",
    **CATEGORY_LABELS,
}


TemplateType = Literal["A", "B", "C"]


class PhotoStoryInput(BaseModel):
    """사진 한 장에 대한 설명(스토리)."""

    order: int = Field(ge=0, lt=30, description="업로드 슬롯 순서 (0부터 연속)")
    user: str = Field(default="", max_length=30, description="작성자 이름(선택)")
    text: str = Field(min_length=1, max_length=300, description="사진 설명 스토리")


class AlbumPhotoCommentItem(BaseModel):
    author: str | None = None
    text: str


class AlbumPhotoUrlResponse(BaseModel):
    id: UUID
    sort_order: int
    # 텍스트 3계층: caption = 사진 설명(album_photos.caption, PDF에 인쇄된다),
    # comments = 코멘트(photo_memories, 인쇄되지 않는다). 이름이 곧 계층이다.
    caption: str | None = None
    comments: list[AlbumPhotoCommentItem] | None = None
    original_url: str
    display_url: str | None = None
    thumbnail_url: str
    width: int | None = None
    height: int | None = None
    taken_at: datetime | None = None
    latitude: float | None = None
    longitude: float | None = None
    location_name: str | None = None
    location_source: Literal["exif", "user", "ai_estimated", "unknown"] | None = None
    orientation: str | None = None
    # SCREEN_SPEC §7 — 캡션은 인쇄되는 유일한 글이다. 이 사진의 캡션을 내가 쓸 수 있는가를
    # 백엔드가 판정해 내려준다(프런트가 추측하지 않는다 — CLAUDE.md §10).
    can_edit_caption: bool = False
    # 남이 올린 사진일 때 그 사람의 이름. 주최자가 남의 캡션을 열 때 한 번 묻는 문구에 쓴다.
    # 내가 올린 사진이면 None 이라 확인 단계가 뜨지 않는다.
    caption_author_name: str | None = None
    # 내가 올린 사진인가. can_edit_caption 과 다르다 — 주최자는 남의 사진 캡션도 고칠 수
    # 있어서 그 값만으로는 "내 사진" 을 가릴 수 없다. 빈 캡션 안내가 이 값으로 센다(§9).
    is_mine: bool = False


class AlbumPhotoLocationUpdate(BaseModel):
    location_name: str | None = Field(default=None, max_length=120)
    latitude: float | None = None
    longitude: float | None = None
    location_source: Literal["exif", "user", "ai_estimated", "unknown"] = "user"


class AlbumCoverPhotoUpdate(BaseModel):
    photo_id: UUID | None = None


class AlbumCoverPhotoResponse(BaseModel):
    cover_photo_id: UUID | None = None
    cover_image_url: str | None = None


class AlbumUploadResponse(BaseModel):
    album_id: UUID
    meeting_type: MeetingType
    category: str | None = None
    template: TemplateType
    template_type: str | None = None
    title: str
    date: str
    narrative: str
    epilogue: str | None = None
    chapter_stories: dict[str, str] = Field(default_factory=dict)
    image_url: str
    cover_photo_id: UUID | None = None
    cover_image_url: str | None = None
    share_url: str
    created_at: datetime
    saved: bool = True
    photos: list[AlbumPhotoUrlResponse] = Field(default_factory=list)
    generation_job_id: UUID | None = None
    generation_status: Literal["pending", "processing", "completed", "failed"] | None = None
    progress: int | None = Field(default=None, ge=0, le=100)
    # Present only for albums created without login: the raw guest-session token
    # the browser stores to access/edit and later claim this album. Null for
    # logged-in creators.
    guest_token: str | None = None


class GuestAlbumClaimRequest(BaseModel):
    guest_token: str = Field(min_length=1)


class AlbumGenerationStatusResponse(BaseModel):
    album_id: UUID
    generation_job_id: UUID
    status: Literal["pending", "processing", "completed", "failed"]
    progress: int = Field(ge=0, le=100)
    current_step: str
    ready: bool
    error_code: str | None = None


class AlbumGenerationPreviewItem(BaseModel):
    photo_id: UUID
    url: str | None = None


class AlbumGenerationPreviewResponse(BaseModel):
    previews: list[AlbumGenerationPreviewItem] = Field(default_factory=list)


class CurrentEditionSummary(BaseModel):
    photo_count: int = 0
    memory_count: int = 0
    living_append_page_count: int = 0


class ViewerParticipation(BaseModel):
    """이 앨범에서 '나'(참여자)의 기록 — whoami 띠와 '내가 더한 것' 숫자의 근거."""

    display_name: str | None = None
    relationship: str | None = None
    photo_count: int = 0
    memory_count: int = 0
    # 앨범 전체의 활동 중 참여자 수 — 참여자 화면 메타("함께한 사람 N명")와
    # 더보기 시트 행에 쓴다(참여자는 협업 상태 API 권한이 없을 수 있어 여기 실어 보낸다).
    contributor_count: int = 0


class AlbumDetailResponse(BaseModel):
    """공유 링크(/album/{id}) 페이지용 앨범 상세."""

    album_id: UUID
    meeting_type: str
    category: str | None = None
    template: str
    template_type: str | None = None
    title: str
    date: str
    narrative: str
    epilogue: str | None = None
    chapter_stories: dict[str, str] = Field(default_factory=dict)
    image_url: str
    cover_photo_id: UUID | None = None
    cover_image_url: str | None = None
    share_url: str
    created_at: datetime
    media: list["AlbumMediaSummary"] = Field(default_factory=list)
    saved: bool = True
    album_version: int = 0
    living_append_pages: list[dict[str, Any]] = Field(default_factory=list)
    current_edition: CurrentEditionSummary = Field(default_factory=CurrentEditionSummary)
    edition_previous: int | None = None
    edition_is_latest: bool = False
    # UI capability flags are derived from the authenticated server-side access
    # check; clients must never infer edit rights from a local album id.
    # (프런트는 이 값으로 버튼만 감춘다 — 실제 차단은 각 API의 백엔드 검사가 한다.)
    can_edit: bool = False
    can_contribute: bool = False
    can_delete: bool = False
    # 더할 수 없을 때 **왜 그런지 한 줄**. 버튼만 사라지면 고장으로 보인다(J-8 · §11).
    # 링크 경로(/s/)와 같은 함수가 만든다 — 판정은 한 곳이다(§1).
    contribution_block_reason: str | None = None
    # 참여자 화면(3a) 전용 additive 필드. 소유자/무관 사용자는 항상 None.
    # owner_display_name 은 usable_owner_display_name 판정을 통과한 값만 —
    # 이메일 앞부분(kbjkwak 류)은 서버가 걸러 None 을 보낸다.
    owner_display_name: str | None = None
    viewer_participation: ViewerParticipation | None = None
    # "함께 만든 사람" 한 줄 — "우리의 이야기" 다음에 **인쇄된다**(CLAUDE.md §6).
    # 세는 규칙과 같은 자리에서 모은다(§1 — 주최자 포함, status='active').
    # 역할과 무관하게 모두에게 내려간다: 본문이라 주최자·참여자·구경꾼·PDF 가 같이 본다.
    contributor_names: list[str] = Field(default_factory=list)


class LivingAppendPagesResponse(BaseModel):
    living_append_pages: list[dict[str, Any]] = Field(default_factory=list)


class MyAlbumListItem(BaseModel):
    album_id: UUID
    title: str
    created_at: datetime
    updated_at: datetime | None = None
    image_url: str
    cover_photo_id: UUID | None = None
    cover_image_url: str | None = None
    photo_count: int = 0
    new_memory_count: int = 0
    is_latest_edition: bool = True
    status: str = "active"
    #: 담아둔 앨범을 **열 때 쓸 구경용 링크**(K-7b). 담아둔 칸에서만 채워진다.
    #: 구경꾼은 멤버가 아니라 `/album/{id}` 로 열면 403 이다 — `/s/{token}` 으로 연다.
    share_token: str | None = None


class MyAlbumsResponse(BaseModel):
    albums: list[MyAlbumListItem] = Field(default_factory=list)
    # Albums the user was invited to and contributed to (not owned). Additive: existing
    # clients that read only `albums` keep working.
    participating: list[MyAlbumListItem] = Field(default_factory=list)
    # 담아둔 앨범(§1 9차) — 구경하다가 계정에 담아 둔 것. 권한이 아니라 목록일 뿐이다.
    # 위 두 칸에 이미 있는 앨범은 여기서 뺀다(같은 앨범이 두 칸에 뜨지 않는다).
    bookmarked: list[MyAlbumListItem] = Field(default_factory=list)


class AlbumPdfUrlResponse(BaseModel):
    url: str | None = None
    album_version: int
    cached: bool = False


class NarrativeUpdate(BaseModel):
    """Deprecated: updates epilogue (우리의 이야기). Prefer EpilogueUpdate."""

    narrative: str = Field(default="", max_length=800)


class EpilogueUpdate(BaseModel):
    epilogue: str = Field(default="", max_length=800)


class AlbumTitleUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=120)


class ChapterStoryUpdate(BaseModel):
    # date is the YYYY-MM-DD chapter_stories key. Empty story removes that date's story.
    date: str = Field(min_length=1, max_length=32)
    story: str = Field(default="", max_length=800)


class StoryInputUpdate(BaseModel):
    value: str = Field(default="", max_length=300)


class StoryInputResponse(BaseModel):
    key: Literal["memory_hint", "people", "highlight"]
    value: str


class StoryRegenerateResponse(BaseModel):
    narrative: str


class EpilogueGenerateResponse(BaseModel):
    epilogue: str
    chapter_stories: dict[str, str] = Field(default_factory=dict)
    warning: str | None = None
    rejected: bool = False


class ShareLinkCreateRequest(BaseModel):
    expires_at: datetime | None = None
    # 링크 종류(SCREEN_SPEC §1). 기본은 기존 동작 그대로 contribute — 지정하지 않는
    # 기존 호출자의 계약이 바뀌지 않는다. "구경하라고 보내기"만 view 를 보낸다.
    kind: Literal["view", "contribute"] = "contribute"


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


class PublicContributionItem(BaseModel):
    id: str
    type: Literal["photo", "memory"]
    actor_name: str
    author_name: str
    created_at: datetime | None = None
    thumbnail_url: str | None = None
    comment: str | None = None
    content: str | None = None


class GuestbookItem(BaseModel):
    id: UUID
    author_name: str
    message: str
    created_at: datetime | None = None


class PublicShareAlbumResponse(BaseModel):
    album_id: UUID
    title: str
    narrative: str
    epilogue: str | None = None
    chapter_stories: dict[str, str] = Field(default_factory=dict)
    image_url: str
    cover_photo_id: UUID | None = None
    cover_image_url: str | None = None
    date: str = ""
    category: str | None = None
    template_type: str | None = None
    media: list[PublicMediaItem]
    photos: list[AlbumPhotoUrlResponse] = Field(default_factory=list)
    photo_count: int = 0
    photo_limit: int = DEFAULT_ALBUM_PHOTO_CAPACITY
    pending_items: list[PublicContributionItem] = Field(default_factory=list)
    living_append_pages: list[dict[str, Any]] = Field(default_factory=list)
    edition_previous: int | None = None
    edition_is_latest: bool = True
    # ★ PDF 저장(PUT /albums/{id}/pdf)은 이 값이 앨범의 현재 버전과 같아야 받아 준다.
    # 공유 화면은 이 값을 몰라 0 을 보냈고, 그래서 저장이 **늘 409** 로 막혔다 —
    # 저장이 안 되니 인앱 브라우저에 넘길 주소도 없어 "파일 저장이 막혀 있어요" 가 떴다.
    album_version: int = 0
    og_title: str
    og_description: str
    # Anonymous per-album aggregate, e.g. {"love": 3, "moved": 1, "smile": 0}.
    reaction_counts: dict[str, int] = Field(default_factory=dict)
    guestbook: list[GuestbookItem] = Field(default_factory=list)
    # 함께한 사람 수 — 공유 화면의 더보기 시트 행(§5). 이미 조회한 참여자 목록에서 센다.
    contributor_count: int = 0
    # 이 링크로 들어온 사람이 사진·코멘트를 남길 수 있는가(참여자) 없는가(구경꾼).
    # 백엔드 판정(contribution_block_reason)과 같은 값이다 — 화면이 따로 추측하지 않는다.
    can_contribute: bool = True
    # 로그인한 사람이 이 앨범을 **이미 담아 뒀는가**(§1 9차). 담기는 켜고 끄는 것이라
    # 화면이 지금 상태를 알아야 한다. 비로그인이면 항상 False 다.
    viewer_bookmarked: bool = False
    # ★ 로그인한 사람이 **이미** 이 앨범의 참여자인가 (SCREEN_SPEC §1).
    # 참여는 언제나 사용자가 이름을 적고 시작한다 — 링크를 열었다고 참여자가 되지 않는다.
    # 다만 이미 참여자인 사람은 다시 묻지 않는다. 그 판정을 화면이 추측하지 않도록
    # 서버가 기존 album_contributors 행을 그대로 내려준다(행을 만들지 않는다).
    viewer_contributor: "ShareViewerContributor | None" = None


class ShareViewerContributor(BaseModel):
    contributor_id: UUID
    display_name: str
    guest_id: UUID | None = None


class ShareReactionRequest(BaseModel):
    reaction: Literal["love", "moved", "smile"]
    session_key: str = Field(min_length=16, max_length=200)


class GuestbookCreateRequest(BaseModel):
    author_name: str = Field(min_length=1, max_length=40)
    message: str = Field(min_length=1, max_length=200)
    session_key: str = Field(min_length=16, max_length=200)
    contributor_id: UUID | None = None


class GuestbookDeleteRequest(BaseModel):
    session_key: str = Field(min_length=16, max_length=200)


class AuthBootstrapRequest(BaseModel):
    # Guest contributor ids from the browser to attribute to this account on login.
    # Capped so a login never sends an unbounded payload.
    contributor_guest_ids: list[str] = Field(default_factory=list, max_length=50)


class AuthBootstrapResponse(BaseModel):
    profile_id: UUID
    family_id: UUID
    # Additive: lets the frontend warn before the create flow. Existing fields unchanged.
    album_count: int = 0
    max_albums: int = 0
    # Guest ids that were successfully attributed — the frontend flags these so they are
    # not re-sent on the next bootstrap.
    claimed_guest_ids: list[str] = Field(default_factory=list)


class ProfileContactRequest(BaseModel):
    """이용자가 직접 입력한 연락처(선택). 둘 다 없어도 되고, 빈 값이면 지운다."""

    phone: str | None = Field(default=None, max_length=32)
    email: str | None = Field(default=None, max_length=254)


class WithdrawalSummaryResponse(BaseModel):
    """탈퇴하면 무엇이 얼마나 사라지는지 (K-17 · SCREEN_SPEC §5 27차).

    ★ 화면은 이 숫자를 **보여주기만** 한다. 지울 때 이 값을 되돌려 받지 않는다 —
      프런트가 보내는 숫자를 믿지 않는다(§10).
    """

    owned_albums: int = 0
    owned_photos: int = 0
    other_album_photos: int = 0


class ProfileContactResponse(BaseModel):
    """★ **본인에게는 원본이 내려간다.** 가리는 일은 화면이 한다.
    평소 표시는 여전히 010-****-5678 / ab***@example.com 이지만, `수정` 을 누르면
    그 원본이 칸에 들어간다 — 뒷자리 하나 고치려고 11자리를 다시 치지 않는다.
    본인 확인 전용 값이며, 로그인한 본인에게만 내려가는 응답이다."""

    phone: str | None = None
    email: str | None = None


class AlbumPhotoUrlsResponse(BaseModel):
    photos: list[AlbumPhotoUrlResponse]


class PhotoCaptionUpdate(BaseModel):
    """캡션(①) 저장 요청 — album_photos.caption. 코멘트(photo_memories)와 다르다."""

    caption: str | None = Field(default=None, max_length=300)


class PhotoCaptionResponse(BaseModel):
    id: UUID
    caption: str | None = None
    #: 캡션을 저장하면 앨범 버전이 **올라간다**(supabase.update_album_photo_comment).
    #: 그 값을 돌려주지 않으면 화면이 낡은 버전을 들고 있다가 PDF 업로드에서 409 를
    #: 맞는다 — 다른 세 경로(제목·이야기·우리의 이야기)는 앨범 전체를 돌려주므로
    #: 이 하나만 빠져 있었다(K-6).
    album_version: int = 0


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


# --- Collaborative album MVP ---

CollaborationStatus = Literal["draft", "collecting", "ready", "published", "closed"]
ContributorRelationship = Literal["가족", "친구", "연인", "지인", "기타"]


class CollaborationInviteStartResponse(BaseModel):
    invite_url: str
    invite_token: str
    expires_at: datetime | None = None
    collaboration_status: CollaborationStatus


class CollaborationJoinRequest(BaseModel):
    display_name: str = Field(min_length=1, max_length=40)
    relationship: ContributorRelationship | None = None
    guest_id: UUID | None = None


class CollaborationJoinResponse(BaseModel):
    album_id: UUID
    contributor_id: UUID
    guest_id: UUID | None = None
    display_name: str
    relationship: str | None = None
    role: str


class CollaborationContributorResponse(BaseModel):
    id: UUID
    display_name: str
    relationship: str | None = None
    role: str
    joined_at: datetime | None = None


class PhotoMemoryResponse(BaseModel):
    id: UUID
    photo_id: UUID
    author_name: str
    relationship: str | None = None
    comment: str
    contributor_id: UUID
    created_at: datetime | None = None
    updated_at: datetime | None = None
    mine: bool = False


class PhotoMemoryCreateRequest(BaseModel):
    comment: str = Field(min_length=1, max_length=500)
    guest_id: UUID | None = None
    contributor_id: UUID | None = None


class PhotoMemoryUpdateRequest(BaseModel):
    comment: str = Field(min_length=1, max_length=500)
    guest_id: UUID | None = None
    contributor_id: UUID | None = None


class CollaborationRebuildRequest(BaseModel):
    album_json: dict[str, Any] | None = None
    regenerate_story: bool = False
    force: bool = False


class CollaborationRebuildResponse(BaseModel):
    album_version: int
    dirty: bool
    last_built_at: datetime | None = None
    album_json: dict[str, Any] | None = None


class CollaborationParticipationSummary(BaseModel):
    participants: list[dict[str, Any]] = Field(default_factory=list)
    new_photo_count: int = 0
    new_memory_count: int = 0
    new_contribution_count: int = 0
    recommended_mode: str = "append_page"


class CollaborationStatusResponse(BaseModel):
    album_id: UUID
    can_edit_settings: bool = False
    collaboration_enabled: bool
    collaboration_status: CollaborationStatus
    dirty: bool
    album_version: int
    last_built_at: datetime | None = None
    published_at: datetime | None = None
    photo_count: int
    photo_limit: int
    contributor_count: int
    contributor_limit: int
    memory_count: int
    # Sum of view_count across all of the album's share links (owner only, 0 otherwise).
    visitor_count: int = 0
    invite_active: bool
    invite_url: str | None = None
    contributors: list[CollaborationContributorResponse] = Field(default_factory=list)
    album_json: dict[str, Any] | None = None
    participation: CollaborationParticipationSummary | None = None


# --- Admin console ---


class AdminMetricCard(BaseModel):
    label: str
    value: str


class AdminTrendPoint(BaseModel):
    date: str
    value: int


class AdminOpsDashboardResponse(BaseModel):
    today: dict[str, int]
    totals: dict[str, int]
    trends: dict[str, list[AdminTrendPoint]]
    blocked: list[dict[str, Any]] = Field(default_factory=list)
    data_health: dict[str, Any] = Field(default_factory=dict)


class AdminGrowthDashboardResponse(BaseModel):
    living_album: dict[str, float]
    collaboration: dict[str, float]
    viral: dict[str, Any]
    retention: dict[str, float]
    content: dict[str, int]


class AdminInvestorDashboardResponse(BaseModel):
    headline_metrics: list[AdminMetricCard]
    growth: AdminGrowthDashboardResponse


class AdminFunnelStage(BaseModel):
    key: str
    label: str
    count: int
    conversion_from_previous: float | None = None


class AdminViralFunnelResponse(BaseModel):
    stages: list[AdminFunnelStage]


class AdminAlbumListItem(BaseModel):
    album_id: str
    title: str
    owner_id: str | None = None
    owner_name: str | None = None
    owner_email: str | None = None
    cover_image_url: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    photo_count: int = 0
    memory_count: int = 0
    participant_count: int = 0
    share_count: int = 0
    page_count: int = 0
    edition_count: int = 0
    is_living: bool = False


class AdminAlbumSearchResponse(BaseModel):
    albums: list[AdminAlbumListItem]
    query: str = ""
    limit: int
    offset: int


class AdminTimelineItem(BaseModel):
    at: datetime | str | None = None
    kind: str
    label: str
    metadata: dict[str, Any] = Field(default_factory=dict)


class AdminAlbumDetailResponse(BaseModel):
    album_id: str
    title: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    owner_id: str | None = None
    owner_name: str | None = None
    owner_email: str | None = None
    cover_image_url: str | None = None
    photo_count: int = 0
    memory_count: int = 0
    participant_count: int = 0
    share_count: int = 0
    page_count: int = 0
    edition_count: int = 0
    is_living: bool = False
    lifetime_days: float = 0
    contributors: list[dict[str, Any]] = Field(default_factory=list)
    shares: list[dict[str, Any]] = Field(default_factory=list)
    timeline: list[AdminTimelineItem] = Field(default_factory=list)
    view_url: str


class AdminUserListItem(BaseModel):
    user_id: str
    email: str | None = None
    display_name: str | None = None
    created_at: datetime | None = None
    last_seen_at: datetime | None = None
    album_count: int = 0
    participation_count: int = 0
    share_count: int = 0


class AdminUserSearchResponse(BaseModel):
    users: list[AdminUserListItem]
    query: str = ""
    limit: int
    offset: int


class AdminUserAlbumsResponse(BaseModel):
    user_id: str
    albums: list[AdminAlbumListItem]


class AdminEventItem(BaseModel):
    id: str | None = None
    event_name: str
    label: str
    album_id: str | None = None
    share_link_id: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime | None = None


class AdminEventLogResponse(BaseModel):
    events: list[AdminEventItem]


class AdminErrorBucket(BaseModel):
    event_name: str
    count: int
    last_occurred_at: datetime | None = None


class AdminErrorDashboardResponse(BaseModel):
    errors: list[AdminErrorBucket]
    recent: list[dict[str, Any]] = Field(default_factory=list)


class AdminCostDashboardResponse(BaseModel):
    gpt_calls: int
    vision_calls: int
    pdf_generations: int
    storage_bytes: int
    api_calls: int
    operations: dict[str, int] = Field(default_factory=dict)


class AdminAccessResponse(BaseModel):
    ok: bool = True
    user_id: str


class JoinPreviewResponse(BaseModel):
    album_id: UUID
    title: str
    owner_name: str | None = None
    cover_image_url: str | None = None
    contributor_count: int
    photo_count: int
    photo_limit: int
    collaboration_status: CollaborationStatus
    # True when the requester is signed in AND already the owner/member of this album.
    # The client uses it to send an owner/member to the album instead of the join form
    # (a person opening their own invite link should land on their album).
    viewer_is_member: bool = False


AlbumDetailResponse.model_rebuild()
