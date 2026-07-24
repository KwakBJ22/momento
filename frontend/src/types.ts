export type AlbumCategory = "family" | "friend" | "couple" | "colleague" | "pet" | "travel" | "other";
export type MeetingType = "family" | "friend" | "work" | "university";
export type TemplateType = "A" | "B" | "C";
export type AlbumTemplateType = "warm" | "joyful" | "special";

export const ALBUM_CATEGORY_OPTIONS: Array<{ value: AlbumCategory; label: string }> = [
  { value: "family", label: "가족" },
  { value: "friend", label: "친구" },
  { value: "couple", label: "연인" },
  { value: "colleague", label: "동료" },
  { value: "pet", label: "반려동물" },
  { value: "travel", label: "여행" },
  { value: "other", label: "기타" },
];

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
  couple: "둘만의 특별한 기억",
  colleague: "함께 만든 소중한 시간",
  pet: "곁에 있어 준 친구와의 기억",
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
  edition_previous?: number | null;
  edition_is_latest?: boolean;
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
  comment: string | null;
  /** 다중 작성자 메모 (Memory Merge) */
  comments?: Array<{ author?: string | null; text: string }> | null;
  author_label?: string | null;
  original_url: string;
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

export interface GuestAlbumResult extends AlbumResult {
  guest_token: string;
}

export interface PublicShareAlbum {
  album_id: string;
  title: string;
  narrative: string;
  epilogue?: string | null;
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
  media: Array<{ media_type: MediaType; mime_type: string; processing_status: MediaProcessingStatus; original_filename: string | null }>;
  og_title: string;
  og_description: string;
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
  previewUrl: string;
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
