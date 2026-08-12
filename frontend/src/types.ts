export type AlbumCategory = "family" | "friend" | "couple" | "colleague" | "pet" | "travel" | "other";
export type MeetingType = "family" | "friend" | "work" | "university";
export type TemplateType = "A" | "B" | "C";
export type AlbumTemplateType = "warm" | "joyful" | "special";

/**
 * 앨범을 만들 때 고르는 분류 — **다섯 개**다 (I-7).
 *
 * `반려동물`을 뺐다. 사람들은 반려동물을 가족으로 여긴다. 따로 두면 "우리 강아지는
 * 가족이 아닌가" 하고 한 번 멈춘다.
 * `여행`을 뺐다. 나머지는 **누구와** 만든 앨범인지인데 여행만 **무엇을** 했는지다.
 * 기준이 섞여 있어 가족과 간 여행은 어디에 넣을지 알 수 없다.
 *
 * ★ **고르는 목록에서만 뺀다.** 이미 `pet` · `travel` 로 저장된 앨범은 그 사람의
 *   앨범이다. 값도, 문체·표지 규칙도 그대로 남는다 — `AlbumCategory` 타입과
 *   `CATEGORY_DEFAULT_TEMPLATE`, 백엔드의 `album_styles` · `story_service` 를
 *   건드리지 않는다. 빼면 기존 앨범을 읽다 막힌다.
 */
export const ALBUM_CATEGORY_OPTIONS: Array<{ value: AlbumCategory; label: string }> = [
  { value: "family", label: "가족" },
  { value: "friend", label: "친구" },
  { value: "couple", label: "연인" },
  { value: "colleague", label: "동료" },
  { value: "other", label: "기타" },
];

/**
 * 첫 화면에 들어왔을 때 이미 골라져 있는 종류 (PO 결정 · UI 정리 4단계 A7).
 *
 * 아무것도 안 골라져 있으면 `앨범 만들기` 가 처음부터 막혀 있어, 무엇을 해야 하는지
 * 모른 채로 멈춘다. 가장 많은 쓰임이 가족이라 그것을 기본으로 둔다.
 * ★ 사용자가 다른 칩을 고르면 그대로 바뀐다 — 기본값은 시작점일 뿐이다.
 */
export const DEFAULT_ALBUM_CATEGORY: AlbumCategory = "family";

/** Internal theme labels — not shown in UI; used when auto-saving template_type. */
export const ALBUM_TEMPLATE_OPTIONS: Array<{
  value: AlbumTemplateType;
  label: string;
  feature: string;
}> = [
  { value: "warm", label: "따뜻한 기록", feature: "큰 사진, 부드러운 여백, 차분한 이야기" },
  { value: "joyful", label: "즐거운 순간", feature: "여러 사진 중심, 경쾌한 구성, 생동감 있는 이야기" },
  { value: "special", label: "특별한 이야기", feature: "잡지형 여백, 강조 문장, 감성적인 이야기" },
];

export const CATEGORY_DEFAULT_TEMPLATE: Record<AlbumCategory, AlbumTemplateType> = {
  family: "warm",
  friend: "joyful",
  couple: "special",
  colleague: "joyful",
  pet: "warm",
  travel: "joyful",
  other: "warm",
};

export const TEMPLATE_TYPE_TO_LAYOUT: Record<AlbumTemplateType, TemplateType> = {
  warm: "A",
  joyful: "B",
  special: "C",
};

export const CATEGORY_COVER_LINES: Record<AlbumCategory, string> = {
  family: "가족이 함께한 따뜻한 하루",
  friend: "친구들과 웃었던 그 순간",
  couple: "둘만의 특별한 한마디",
  colleague: "함께 만든 소중한 시간",
  pet: "곁에 있어 준 친구와의 시간",
  travel: "다시 떠올리고 싶은 여행",
  other: "나만의 특별한 추억",
};

export function normalizeTemplateType(value: string | null | undefined): AlbumTemplateType {
  if (value === "warm" || value === "joyful" || value === "special") return value;
  return "warm";
}

export function recommendedTemplateType(category: AlbumCategory): AlbumTemplateType {
  return CATEGORY_DEFAULT_TEMPLATE[category] ?? "warm";
}

export function coverLineForCategory(category: string | null | undefined): string {
  if (category && category in CATEGORY_COVER_LINES) {
    return CATEGORY_COVER_LINES[category as AlbumCategory];
  }
  return CATEGORY_COVER_LINES.other;
}

export type ProfileStatus = "active" | "suspended" | "deleted";
export type FamilyStatus = "active" | "archived" | "deleted";
export type FamilyRole = "owner" | "admin" | "member" | "viewer";
export type InvitableFamilyRole = "admin" | "member" | "viewer";
export type AlbumMemberRole = "owner" | "editor" | "contributor" | "viewer";
export type InvitationStatus = "pending" | "accepted" | "revoked" | "expired";
export type FamilyMemberStatus = "invited" | "active" | "left" | "removed";
export type AlbumStatus = "draft" | "processing" | "active" | "archived" | "deleted" | "failed";
export type AlbumVisibility = "private" | "family";
export type MediaType = "image" | "gif" | "video" | "audio" | "document";
export type MediaProcessingStatus = "pending" | "processing" | "ready" | "failed";

/** Phase-1 database types. No family UI or API is connected yet. */
export interface Profile {
  id: string;
  display_name: string;
  avatar_path: string | null;
  locale: string;
  timezone: string;
  status: ProfileStatus;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface Family {
  id: string;
  name: string;
  slug: string | null;
  created_by: string;
  status: FamilyStatus;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface FamilySummary {
  family_id: string;
  name: string;
  role: FamilyRole;
}

export interface FamilyMemberItem {
  id: string;
  profile_id: string;
  display_name: string;
  role: FamilyRole;
  joined_at: string | null;
  invited_by: string | null;
}

export interface FamilyInvitationItem {
  id: string;
  invitee_email: string;
  role: InvitableFamilyRole;
  status: InvitationStatus;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
  invite_url?: string | null;
}

export interface AlbumMemberItem {
  id: string;
  profile_id: string;
  display_name: string;
  role: AlbumMemberRole;
  invited_by: string | null;
  created_at: string;
}

export interface AlbumResult {
  album_id: string;
  meeting_type: MeetingType;
  category?: AlbumCategory | string | null;
  template: TemplateType;
  template_type?: AlbumTemplateType | string | null;
  title: string;
  date: string;
  /** @deprecated mirrors epilogue for legacy clients */
  narrative: string;
  epilogue?: string | null;
  /** "함께 만든 사람" 한 줄에 쓸 이름들 — 세는 규칙과 같은 자리에서 온다(§1, 주최자 포함). */
  contributor_names?: string[];
  /** Date-keyed AI episode summaries, e.g. { "2017-08-13": "..." }. */
  chapter_stories?: Record<string, string> | null;
  image_url: string;
  cover_photo_id?: string | null;
  cover_image_url?: string | null;
  share_url: string;
  created_at: string;
  media: AlbumMediaSummary[];
  photos?: AlbumPhoto[];
  saved?: boolean;
  album_version?: number;
  living_append_pages?: LivingAppendPage[];
  current_edition?: {
    photo_count: number;
    memory_count: number;
    living_append_page_count: number;
  };
  edition_previous?: number | null;
  edition_is_latest?: boolean;
  can_edit?: boolean;
  can_contribute?: boolean;
  /** 더할 수 없을 때 **왜 그런지 한 줄**(J-8). 백엔드가 판정한다 — 프런트가 추측하지 않는다. */
  contribution_block_reason?: string | null;
  can_delete?: boolean;
  /** 참여자 화면(3a) 전용 — 소유자/무관 사용자는 null. owner_display_name 은
   *  서버의 이메일 앞부분 판정을 통과한 값만 온다. */
  owner_display_name?: string | null;
  viewer_participation?: {
    display_name?: string | null;
    relationship?: string | null;
    photo_count: number;
    memory_count: number;
    contributor_count: number;
  } | null;
}

export interface AlbumMediaSummary {
  id: string;
  media_type: MediaType;
  mime_type: string;
  original_filename: string | null;
  file_size: number;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  page_count: number | null;
  sort_order: number;
  processing_status: MediaProcessingStatus;
  metadata: Record<string, unknown>;
}

export interface AlbumPhoto {
  id: string;
  sort_order: number;
  /** ① 캡션 — 그 사진을 올린 사람이 쓰는 설명. PDF·인쇄물에 들어간다.
   *  (② 코멘트는 comments — photo_memories, 인쇄되지 않는다.) */
  caption: string | null;
  /** 이 사진의 캡션을 내가 쓸 수 있는가(백엔드 판정 — SCREEN_SPEC §7). */
  can_edit_caption?: boolean;
  /** 남이 올린 사진이면 그 사람 이름. 주최자가 남의 캡션을 열 때 한 번 묻는다. */
  caption_author_name?: string | null;
  /** 내가 올린 사진인가. can_edit_caption 과 다르다 — 주최자는 남의 사진 캡션도 고칠 수
   *  있어서 그 값으로는 "내 사진" 을 가릴 수 없다. 빈 캡션 안내가 이 값으로 센다(§9). */
  is_mine?: boolean;
  comments?: Array<{ author?: string | null; text: string }> | null;
  author_label?: string | null;
  original_url: string;
  display_url?: string | null;
  thumbnail_url: string;
  width?: number | null;
  height?: number | null;
  taken_at?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  location_name?: string | null;
  location_source?: "exif" | "user" | "ai_estimated" | "unknown" | null;
  orientation?: string | null;
}

export interface LivingAppendMemory {
  id: string;
  author_name?: string | null;
  content: string;
  created_at?: string | null;
}

export interface LivingAppendPage {
  id: string;
  type?: "append_page";
  created_at?: string | null;
  photos: AlbumPhoto[];
  memories: LivingAppendMemory[];
}

export interface PublicShareAlbum {
  album_id: string;
  /** 앨범의 현재 버전 — PDF 저장은 이 값이 맞아야 받아 준다(안 맞으면 409). */
  album_version?: number;
  /** 로그인한 사람이 이 앨범을 이미 담아 뒀는가(§1 9차). 비로그인이면 false. */
  viewer_bookmarked?: boolean;
  /** ★ 이미 이 앨범의 참여자인가 (§1). 링크를 열었다고 참여자가 되지 않는다 —
   *  서버가 기존 행이 있을 때만 내려준다. 화면은 이 값을 받아 쓸 뿐 만들지 않는다. */
  viewer_contributor?: { contributor_id: string; display_name: string; guest_id?: string | null } | null;
  /** 함께한 사람 수 — 더보기 시트 행(§5). */
  contributor_count?: number;
  /** 이 링크로 들어온 사람이 사진·코멘트를 남길 수 있는가. 백엔드가 내려주는 값이며
   *  프런트는 링크 종류를 알지 않는다(SCREEN_SPEC §1). 값이 없으면 보수적으로 구경꾼. */
  can_contribute?: boolean;
  /** 더할 수 없을 때 **왜 그런지 한 줄**(J-8). 백엔드가 판정한다 — 프런트가 추측하지 않는다. */
  contribution_block_reason?: string | null;
  title: string;
  narrative: string;
  epilogue?: string | null;
  /** "함께 만든 사람" 한 줄에 쓸 이름들 — 세는 규칙과 같은 자리에서 온다(§1, 주최자 포함). */
  contributor_names?: string[];
  chapter_stories?: Record<string, string> | null;
  image_url: string;
  cover_photo_id?: string | null;
  cover_image_url?: string | null;
  date?: string;
  category?: string | null;
  template_type?: string | null;
  photos?: AlbumPhoto[];
  photo_count?: number;
  photo_limit?: number;
  pending_items?: PublicContributionItem[];
  living_append_pages?: LivingAppendPage[];
  edition_previous?: number | null;
  edition_is_latest?: boolean;
  media: Array<{ media_type: MediaType; mime_type: string; processing_status: MediaProcessingStatus; original_filename: string | null }>;
  og_title: string;
  og_description: string;
  reaction_counts?: Record<string, number>;
  guestbook?: GuestbookItem[];
}

export interface GuestbookItem {
  id: string;
  author_name: string;
  message: string;
  created_at?: string | null;
}

export interface PublicContributionItem {
  id: string;
  type: "photo" | "memory";
  actor_name: string;
  author_name: string;
  created_at?: string | null;
  thumbnail_url?: string | null;
  comment?: string | null;
  content?: string | null;
}

/** Additive columns on public.albums; omitted by the current legacy API DTO. */
export interface AlbumOwnershipFields {
  family_id: string | null;
  created_by: string | null;
  event_at: string | null;
  status: AlbumStatus;
  visibility: AlbumVisibility;
  updated_at: string | null;
  deleted_at: string | null;
  legacy_migrated_at: string | null;
}

export interface PhotoItem {
  id: string;
  file: File;
  /** 이 사진의 미리보기 주소. **사진 한 장에 하나**다 — 다시 그릴 때 새로 만들지 않는다(K-10). */
  previewUrl: string;
  /** `previewUrl` 을 만든 원본 덩어리. 주소가 죽었을 때 **한 번만** 다시 만드는 데 쓴다(K-10). */
  previewSource: Blob;
  /** 이미 한 번 다시 만들었는가. 두 번째로 깨지면 회색 자리를 둔다(K-10). */
  previewRetried?: boolean;
  story: string;
  capturedAt: string | null;
}

export interface StoryPayload {
  order: number;
  user: string;
  text: string;
}

export type AnswerType = "text" | "voice";

export interface MemoryAnswer {
  id: string;
  question_id: string;
  profile_id: string;
  display_name: string;
  answer: string;
  answer_type: AnswerType;
  voice_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface MemoryQuestion {
  id: string;
  album_id: string;
  media_id: string;
  question: string;
  sort_order: number;
  status: "active" | "archived";
  created_at: string;
  thumbnail_url: string | null;
  answers: MemoryAnswer[];
}

/** 탈퇴 확인 화면이 보여줄 숫자 (K-17 · §5 27차). 세는 곳은 서버 한 곳이다. */
export interface WithdrawalSummary {
  owned_albums: number;
  owned_photos: number;
  other_album_photos: number;
}
