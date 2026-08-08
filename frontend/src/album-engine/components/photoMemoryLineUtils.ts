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

/**
 * ★ 캡션에는 **작성자 이름을 넣지 않는다** (CLAUDE.md §6).
 *
 * 예전 규칙은 "작성자 1명 → 숨김 / 2명 이상 → 표시" 였다. 없앤다:
 *  - 캡션은 그 사진을 올린 사람의 말이라 이름이 없어도 누구 말인지 자연스럽다.
 *  - 사진마다 이름이 붙으면 인쇄물이 지저분해진다.
 *  - 누가 썼는지는 프레임 **밖** 한마디(코멘트)에서 보인다.
 * 웹·공유·PDF 가 모두 같다. 여러 사람이 함께 만들었다는 사실은 "우리의 이야기" 다음
 * "함께 만든 사람들" 한 줄이 담당한다.
 *
 * author 값 자체는 남긴다 — 데이터는 그대로 두고 **보여주지 않을** 뿐이다
 * (캡션 고치기 확인 문구가 이 이름을 쓴다).
 */
export function buildPhotoMemoryDisplayLines(
  segments: MemorySegmentData[] | undefined,
  fallbackText?: string | null,
): PhotoMemoryDisplayLine[] {
  return normalizeSegments(segments, fallbackText)
    .map((item) => ({ author: item.author ?? null, text: item.text, showAuthor: false }));
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
