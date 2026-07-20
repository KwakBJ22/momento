/**
 * 사용자 사진 메모 → Polaroid Caption / MemoryCaption / MemoryBlock 라우팅.
 * AI 생성 없음. 빈 메모는 null.
 */

export function normalizeMemoryText(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

export function hasMemoryCaption(value: string | null | undefined): boolean {
  return Boolean(normalizeMemoryText(value));
}

/** 동일 문장 여부 (Story / Caption 중복 판별) */
export function isSameMemoryText(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeMemoryText(a);
  const right = normalizeMemoryText(b);
  if (!left || !right) return false;
  return left === right;
}

/** Story가 메모와 같거나 메모 문장을 포함하면 중복으로 본다. */
export function storyContainsMemory(
  storyBody: string | null | undefined,
  memory: string | null | undefined,
): boolean {
  const story = normalizeMemoryText(storyBody);
  const memo = normalizeMemoryText(memory);
  if (!story || !memo) return false;
  return story === memo || story.includes(memo);
}

/** 메모 길이 기반 표현 방식 */
export type MemoryPresentation = "polaroidCaption" | "memoryCaption" | "memoryBlock" | null;

export function resolveMemoryPresentation(
  raw: string | null | undefined,
  options: { suppressTexts?: string[]; storyBody?: string | null } = {},
): MemoryPresentation {
  const text = normalizeMemoryText(raw);
  if (!text) return null;

  if ((options.suppressTexts ?? []).some((item) => isSameMemoryText(item, text))) {
    return null;
  }
  if (options.storyBody && storyContainsMemory(options.storyBody, text)) {
    return null;
  }

  const len = text.length;
  if (len <= 20) return "polaroidCaption";
  if (len <= 80) return "memoryCaption";
  return "memoryBlock";
}

/** @deprecated length bands for CSS — prefer resolveMemoryPresentation */
export type MemoryCaptionLength = "short" | "medium" | "long";

export function memoryCaptionLength(text: string): MemoryCaptionLength {
  const len = text.length;
  if (len <= 20) return "short";
  if (len <= 80) return "medium";
  return "long";
}

export function isSuppressedMemory(
  raw: string | null | undefined,
  options: { suppressTexts?: string[]; storyBody?: string | null } = {},
): boolean {
  const text = normalizeMemoryText(raw);
  if (!text) return true;
  if ((options.suppressTexts ?? []).some((item) => isSameMemoryText(item, text))) return true;
  if (options.storyBody && storyContainsMemory(options.storyBody, text)) return true;
  return false;
}

/** 20자 이하 Polaroid Caption */
export function preparePolaroidCaption(
  raw: string | null | undefined,
  options: { suppressTexts?: string[]; storyBody?: string | null } = {},
): string | null {
  if (resolveMemoryPresentation(raw, options) !== "polaroidCaption") return null;
  return normalizeMemoryText(raw);
}

/**
 * 21~80자 MemoryCaption.
 * (레거시 short 모드는 20자 폴라로이드 대역과 맞춤)
 */
export function prepareMemoryCaption(
  raw: string | null | undefined,
  options: { mode?: "default" | "short"; suppressTexts?: string[]; storyBody?: string | null } = {},
): string | null {
  const text = normalizeMemoryText(raw);
  if (!text) return null;
  if (isSuppressedMemory(text, options)) return null;

  if (options.mode === "short") {
    // Polaroid Caption 대역과 동일 (≤20)
    if (text.length > 20) return null;
    return text;
  }

  if (resolveMemoryPresentation(text, options) !== "memoryCaption") return null;
  return text;
}

/** MemoryBlock 본문 (81자+) */
export function prepareMemoryBlockText(
  raw: string | null | undefined,
  options: { suppressTexts?: string[]; storyBody?: string | null } = {},
): string | null {
  if (resolveMemoryPresentation(raw, options) !== "memoryBlock") return null;
  return normalizeMemoryText(raw);
}

/** 블록 사진들에서 MemoryCaption용 메모만 순서대로 수집 */
export function collectMemoryCaptions(
  photos: Array<{ comment?: string | null }>,
  options: { mode?: "default" | "short"; suppressTexts?: string[]; storyBody?: string | null } = {},
): string[] {
  const result: string[] = [];
  for (const photo of photos) {
    const prepared =
      options.mode === "short"
        ? preparePolaroidCaption(photo.comment, options)
        : prepareMemoryCaption(photo.comment, options);
    if (prepared) result.push(prepared);
  }
  return result;
}
