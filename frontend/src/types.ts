export type MeetingType = "family" | "friend" | "work" | "university";
export type TemplateType = "A" | "B" | "C";
export type ProfileStatus = "active" | "suspended" | "deleted";
export type FamilyStatus = "active" | "archived" | "deleted";
export type FamilyRole = "owner" | "admin" | "member";
export type FamilyMemberStatus = "invited" | "active" | "left" | "removed";
export type AlbumStatus = "draft" | "processing" | "active" | "archived" | "deleted" | "failed";
export type AlbumVisibility = "private" | "family";

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

export interface FamilyMember {
  id: string;
  family_id: string;
  profile_id: string;
  role: FamilyRole;
  status: FamilyMemberStatus;
  invited_by: string | null;
  joined_at: string | null;
  left_at: string | null;
  created_at: string;
  updated_at: string;
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
