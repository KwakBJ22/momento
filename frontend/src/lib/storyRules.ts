import type { AlbumPhoto } from "../types";

export const MIN_DATE_STORY_PHOTO_COUNT = 5;
// A date whose photos carry no comment/caption has nothing to base a story on beyond
// the date itself, so it would produce a bland, unchangeable line. Require at least one
// commented photo on the date — the story is written from photos + captions + date
// (CLAUDE.md §6). Kept in sync with backend story_rules.MIN_DATE_STORY_COMMENT_COUNT.
export const MIN_DATE_STORY_COMMENT_COUNT = 1;

/** AlbumPhoto·EnginePhoto 공통으로 코멘트/캡션(메모) 존재 여부만 본다. */
type CommentablePhoto = {
  caption?: string | null;
  comments?: Array<{ text?: string | null }> | null;
};

function photoDateKey(photo: AlbumPhoto): string {
  const takenAt = String(photo.taken_at ?? "");
  return takenAt.length >= 10 ? takenAt.slice(0, 10) : "0";
}

export function photoHasComment(photo: CommentablePhoto): boolean {
  if (photo.caption && photo.caption.trim().length > 0) return true;
  return Array.isArray(photo.comments) && photo.comments.some((c) => (c?.text ?? "").trim().length > 0);
}

/** 챕터(그룹) 단위 노출 조건: 사진 ≥5장 AND 코멘트 있는 사진 ≥1장. */
export function isDateStoryEligible(photos: CommentablePhoto[]): boolean {
  if (photos.length < MIN_DATE_STORY_PHOTO_COUNT) return false;
  return photos.filter(photoHasComment).length >= MIN_DATE_STORY_COMMENT_COUNT;
}

export function visibleChapterStories(
  stories: Record<string, string> | null | undefined,
  photos: AlbumPhoto[],
): Record<string, string> {
  if (!stories || typeof stories !== "object") return {};
  const photoCounts = new Map<string, number>();
  const commentCounts = new Map<string, number>();
  for (const photo of photos) {
    const key = photoDateKey(photo);
    if (key === "0") continue;
    photoCounts.set(key, (photoCounts.get(key) ?? 0) + 1);
    if (photoHasComment(photo)) {
      commentCounts.set(key, (commentCounts.get(key) ?? 0) + 1);
    }
  }
  const eligible = new Set(
    [...photoCounts.entries()]
      .filter(
        ([key, count]) =>
          count >= MIN_DATE_STORY_PHOTO_COUNT &&
          (commentCounts.get(key) ?? 0) >= MIN_DATE_STORY_COMMENT_COUNT,
      )
      .map(([key]) => key),
  );
  return Object.fromEntries(
    Object.entries(stories).filter(
      ([key, value]) => eligible.has(key) && String(value).trim().length > 0,
    ),
  );
}
