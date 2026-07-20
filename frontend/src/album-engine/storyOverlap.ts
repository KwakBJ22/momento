import { normalizeMemoryText } from "./memoryCaption";

/** 문장 단위 분리 (한국어/영문 마침표·줄바꿈) */
export function splitSentences(text: string): string[] {
  return normalizeMemoryText(text)
    .split(/(?<=[.!?。！？]|다\.|요\.|죠\.|네\.)\s+|\n+/)
    .map((s) => normalizeMemoryText(s))
    .filter(Boolean);
}

/**
 * chapter story vs ending story 유사도.
 * 완전 동일하거나 문장 대부분이 겹치면 true.
 */
export function storiesAreOverlapping(
  a: string | null | undefined,
  b: string | null | undefined,
  options: { overlapRatio?: number } = {},
): boolean {
  const left = normalizeMemoryText(a);
  const right = normalizeMemoryText(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.includes(right) || right.includes(left)) {
    const shorter = left.length <= right.length ? left : right;
    const longer = left.length > right.length ? left : right;
    if (shorter.length / longer.length >= 0.7) return true;
  }

  const leftSentences = splitSentences(left);
  const rightSentences = splitSentences(right);
  if (!leftSentences.length || !rightSentences.length) return false;

  const rightSet = new Set(rightSentences);
  let shared = 0;
  for (const sentence of leftSentences) {
    if (rightSet.has(sentence)) {
      shared += 1;
      continue;
    }
    // soft match: one contains the other
    for (const other of rightSet) {
      if (sentence.includes(other) || other.includes(sentence)) {
        if (Math.min(sentence.length, other.length) / Math.max(sentence.length, other.length) >= 0.75) {
          shared += 1;
          break;
        }
      }
    }
  }
  const ratio = shared / Math.min(leftSentences.length, rightSentences.length);
  return ratio >= (options.overlapRatio ?? 0.6);
}

/**
 * rebuild(AI 없음) 경로: chapter story와 ending이 겹치면 ending을 숨긴다.
 * chapter가 비어 있으면 ending만 유지.
 */
export function pickNonDuplicateStories(chapterStory: string | null, endingStory: string | null): {
  chapterStory: string | null;
  endingStory: string | null;
  hideEnding: boolean;
} {
  const chapter = normalizeMemoryText(chapterStory) || null;
  const ending = normalizeMemoryText(endingStory) || null;
  if (!chapter && !ending) {
    return { chapterStory: null, endingStory: null, hideEnding: true };
  }
  if (!chapter) {
    return { chapterStory: null, endingStory: ending, hideEnding: false };
  }
  if (!ending) {
    return { chapterStory: chapter, endingStory: null, hideEnding: true };
  }
  if (storiesAreOverlapping(chapter, ending)) {
    // Prefer chapter story; hide ending duplicate
    return { chapterStory: chapter, endingStory: null, hideEnding: true };
  }
  return { chapterStory: chapter, endingStory: ending, hideEnding: false };
}
