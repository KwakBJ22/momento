import type { MemorySegmentData } from "../types";

export type PhotoMemoryLayoutTier = "short" | "medium" | "long";

export interface PhotoMemoryDisplayLine {
  author: string | null;
  text: string;
  showAuthor: boolean;
}

function normalizeSegments(
  segments: MemorySegmentData[] | undefined,
  fallbackText: string | null | undefined,
): Array<{ author: string | null; text: string }> {
  const fromSegments =
    segments
      ?.map((segment) => ({
        author: segment.author?.trim() || null,
        text: segment.text.trim(),
      }))
      .filter((segment) => segment.text) ?? [];

  if (fromSegments.length) return fromSegments;

  const text = (fallbackText ?? "").trim();
  if (!text) return [];
  return [{ author: null, text }];
}

/** contributor 2명 이상일 때만 이름 표시, 연속 동일 작성자는 첫 줄만 */
export function buildPhotoMemoryDisplayLines(
  segments: MemorySegmentData[] | undefined,
  fallbackText?: string | null,
): PhotoMemoryDisplayLine[] {
  const items = normalizeSegments(segments, fallbackText);
  if (!items.length) return [];

  const contributors = new Set(items.map((item) => item.author).filter(Boolean) as string[]);
  const showAuthors = contributors.size >= 2;

  let lastAuthor: string | null = null;
  return items.map((item) => {
    const author = item.author ?? null;
    if (!showAuthors || !author) {
      return { author, text: item.text, showAuthor: false };
    }
    const displayAuthor = author !== lastAuthor;
    if (displayAuthor) lastAuthor = author;
    return { author, text: item.text, showAuthor: displayAuthor };
  });
}

export function photoMemoryLayoutTier(lines: PhotoMemoryDisplayLine[]): PhotoMemoryLayoutTier {
  const total = lines.reduce((sum, line) => sum + line.text.length, 0);
  const longest = lines.reduce((max, line) => Math.max(max, line.text.length), 0);
  const measure = Math.max(total, longest);
  if (measure <= 28) return "short";
  if (measure <= 72) return "medium";
  return "long";
}

export function photoMemoryHasAuthors(lines: PhotoMemoryDisplayLine[]): boolean {
  return lines.some((line) => line.showAuthor && line.author);
}
