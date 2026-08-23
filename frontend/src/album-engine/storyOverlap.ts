import { normalizeMemoryText } from "./memoryCaption";

/**
 * 문장 끝을 표시할 때 쓰는 글자 — 사용자가 칠 수 없는 제어문자다.
 * 혹시 글에 들어 있으면 먼저 지운다(그것으로 문장을 쪼갤 수는 없게).
 */
const SENTENCE_BREAK = "\u0000";

/**
 * 문장 단위 분리 (한국어/영문 마침표·줄바꿈)
 *
 * 🔴 예전에는 뒤돌아보기(`(?<=...)`)로 잘랐다. 그것은 **iOS 16.4 부터** 되는 문법이라
 *    그 아래 아이폰에서는 이 파일을 읽는 순간 문법 오류가 났고, `album-engine/index.ts`
 *    가 이 파일을 내보내므로 **앨범 엔진이 통째로 죽었다**(화면 전체가 멈췄다).
 *    우리 사용자는 기기를 오래 쓰는 층이라 3~4년 된 아이폰이 흔하다.
 *
 * ★ 끝 부호를 **남기면서** 자르는 것이 핵심이다. 그래서 부호 뒤에 표시를 하나 넣고
 *   그 표시로 자른다 — 부호는 앞 문장에 남는다. 결과는 예전과 **글자 하나까지 같다**
 *   (검사가 옛 정규식과 맞대어 본다).
 * ★ `다. / 요. / 죠. / 네.` 를 따로 적지 않는다. 그 갈래는 전부 `.` 로 끝나서 부호
 *   목록에 이미 들어 있었다 — 예전에도 하는 일이 없던 가지다.
 * ★ 새 라이브러리를 넣지 않는다.
 */
export function splitSentences(text: string): string[] {
  return normalizeMemoryText(text)
    .split(SENTENCE_BREAK).join("")
    .replace(/([.!?。！？])(\s+)/g, `$1${SENTENCE_BREAK}`)
    .split(new RegExp(`${SENTENCE_BREAK}|\\n+`))
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
