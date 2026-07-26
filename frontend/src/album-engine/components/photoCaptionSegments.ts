import type { MemorySegmentData } from "../types";

type CaptionSource = {
  id: string;
  comment?: string | null;
  comments?: Array<{ author?: string | null; text?: string | null }> | null;
  authorLabel?: string | null;
};

/** Keep the saved photo comment and participant memories separate, but visible together. */
export function buildPhotoCaptionSegments(photo: CaptionSource): MemorySegmentData[] | undefined {
  const segments: MemorySegmentData[] = [];
  const seen = new Set<string>();
  const add = (text: string | null | undefined, author?: string | null) => {
    const normalized = (text ?? "").trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    segments.push({ author: author?.trim() || null, text: normalized, photoId: photo.id });
  };

  // `comment` is the saved user photo comment. Do not substitute analysis text here.
  add(photo.comment, photo.authorLabel);
  for (const memory of photo.comments ?? []) add(memory.text, memory.author);

  return segments.length ? segments : undefined;
}
