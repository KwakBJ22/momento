import type { AlbumPhoto } from "../types";

const MIN_DATE_STORY_PHOTO_COUNT = 5;

function photoDateKey(photo: AlbumPhoto): string {
  const takenAt = String(photo.taken_at ?? "");
  return takenAt.length >= 10 ? takenAt.slice(0, 10) : "0";
}

export function visibleChapterStories(
  stories: Record<string, string> | null | undefined,
  photos: AlbumPhoto[],
): Record<string, string> {
  if (!stories || typeof stories !== "object") return {};
  const counts = new Map<string, number>();
  for (const photo of photos) {
    const key = photoDateKey(photo);
    if (key === "0") continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const eligible = new Set(
    [...counts.entries()]
      .filter(([, count]) => count >= MIN_DATE_STORY_PHOTO_COUNT)
      .map(([key]) => key),
  );
  return Object.fromEntries(
    Object.entries(stories).filter(
      ([key, value]) => eligible.has(key) && String(value).trim().length > 0,
    ),
  );
}
