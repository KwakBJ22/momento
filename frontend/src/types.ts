export type MeetingType = "family" | "friend" | "work" | "university";
export type TemplateType = "A" | "B" | "C";
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
  template: TemplateType;
  title: string;
  date: string;
  narrative: string;
  image_url: string;
  share_url: string;
  created_at: string;
  media: AlbumMediaSummary[];
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

export interface GuestAlbumResult extends AlbumResult {
  guest_token: string;
}

export interface PublicShareAlbum {
  title: string;
  narrative: string;
  image_url: string;
  media: Array<{ media_type: MediaType; mime_type: string; processing_status: MediaProcessingStatus; original_filename: string | null }>;
  og_title: string;
  og_description: string;
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
