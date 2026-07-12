export type MeetingType = "family" | "friend" | "work" | "university";
export type TemplateType = "A" | "B" | "C";

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
