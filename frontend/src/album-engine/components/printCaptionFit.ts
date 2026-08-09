import { buildPhotoCaptionSegments } from "./photoCaptionSegments";
import type { MemorySegmentData } from "../types";

/**
 * 인쇄에서 캡션을 자르지 않기 위한 자리 계산 (I-4g · SCREEN_SPEC §9).
 *
 * 화면은 사진을 크게 보이려고 캡션을 두 줄에서 자른다(§6). **인쇄는 자를 이유가 없다** —
 * 캡션은 인쇄까지 가는 유일한 사용자 글이라, 문장이 중간에 끊기면 그 사람이 남긴 말이
 * 반쪽만 남는다. 그래서 인쇄에서는 줄 수 제한을 없앤다.
 *
 * 대신 캡션이 길어지면 프레임이 세로로 길어져 쪽을 넘길 수 있다. 넘치게 두지 않는다(I-4c):
 * **늘어난 캡션 높이만큼 사진 상한을 낮춘다.** 늘어난 만큼 그대로 빼므로 프레임 전체 높이는
 * 변하지 않는다 — 잘리는 것보다 사진이 조금 작은 편이 낫다(I-4g).
 *
 * ★ 브라우저에서 재지 않는다(I-QUEUE 규칙 6). 아래는 전부 A4 기하와 이미 정해진 값에서
 *   나온 산수다. 실제보다 **줄 수를 적게 보지 않도록** 폭을 가장 좁게 잡는다 —
 *   적게 보면 넘치고, 많이 보면 사진이 조금 작아질 뿐이다.
 */

const MM_PER_PX = 25.4 / 96;

/** 캡션 글자 크기·줄간격 — PrintPages.css 의 `--print-caption` · `--print-leading-body`. */
export const PRINT_CAPTION_FONT_PX = 15;
export const PRINT_CAPTION_LEADING = 1.6;

/** 캡션 한 줄 높이 (15px × 1.6 = 24px ≈ 6.35mm). */
export const PRINT_CAPTION_LINE_MM = PRINT_CAPTION_FONT_PX * PRINT_CAPTION_LEADING * MM_PER_PX;

/**
 * 지금의 사진 상한이 이미 잡아 둔 캡션 줄 수 (PrintPages.css 의 "캡션 두 줄 약 12.7mm").
 * 두 줄까지는 자리가 있으므로 상한을 낮추지 않는다.
 */
export const PRINT_CAPTION_BUDGET_LINES = 2;

/**
 * 캡션 폭을 이보다 넓게 보지 않는다.
 * 프레임 폭은 사진 폭이고, 사진의 짧은 변은 60mm 아래로 내려가지 않는다
 * (`PRINT_MIN_PHOTO_SHORT_SIDE_MM`, I-4b-5). 가장 좁은 경우로 잡아야 줄 수를 적게 보지 않는다.
 */
export const PRINT_CAPTION_WIDTH_MM = 60;

/** 한글 글자는 1em 이지만 `word-break: keep-all` 이라 줄 끝이 남는다. 92%만 찬다고 본다. */
export const PRINT_CAPTION_FILL = 0.92;

/** 작성자가 둘 이상이면 이름 칸(2.75rem)과 사이(0.65rem)만큼 글 폭이 줄어든다. */
export const PRINT_CAPTION_AUTHOR_MM = (44 + 10.4) * MM_PER_PX;

/** 작성자 줄 사이 간격 (PhotoMemoryLines.css 의 10px). */
export const PRINT_CAPTION_SEGMENT_GAP_MM = 10 * MM_PER_PX;

/**
 * 이보다 긴 캡션이면 **그 사진만 제 쪽으로** 보낸다 (I-4g · 4c 의 "사진을 나눈다"와 같은 방식).
 * 한 쪽을 같이 쓰는 다른 사진들까지 같이 작아지는 것을 막는다.
 */
export const PRINT_CAPTION_OWN_PAGE_LINES = 8;

/**
 * 사진 상한에서 뺄 수 있는 최대치. 더 빼면 사진이 사라진다.
 * 한 쪽 한 장 + 이야기일 때의 상한(165mm)에서 25mm 는 남긴다.
 */
export const PRINT_CAPTION_EXTRA_MAX_MM = 140;

/** 그 폭에 한 줄로 들어가는 글자 수. */
export function printCaptionCharsPerLine(widthMm: number): number {
  const widthPx = widthMm / MM_PER_PX;
  return Math.max(1, Math.floor((widthPx * PRINT_CAPTION_FILL) / PRINT_CAPTION_FONT_PX));
}

function segmentLineCount(segments: MemorySegmentData[]): number {
  const multi = segments.length > 1;
  const width = PRINT_CAPTION_WIDTH_MM - (multi ? PRINT_CAPTION_AUTHOR_MM : 0);
  const perLine = printCaptionCharsPerLine(width);
  return segments.reduce((total, segment) => total + Math.max(1, Math.ceil(segment.text.length / perLine)), 0);
}

type CaptionPhoto = Parameters<typeof buildPhotoCaptionSegments>[0];

/** 그 사진의 캡션이 인쇄에서 차지하는 줄 수. 캡션이 없으면 0. */
export function printCaptionLines(photo: CaptionPhoto): number {
  const segments = buildPhotoCaptionSegments(photo);
  return segments ? segmentLineCount(segments) : 0;
}

/** ★ 한 쪽의 사진 상한에서 빼야 할 높이 — 그 쪽에서 캡션이 가장 긴 사진이 정한다. */
export function printCaptionExtraMm(photos: CaptionPhoto[]): number {
  let extra = 0;
  for (const photo of photos) {
    const segments = buildPhotoCaptionSegments(photo);
    if (!segments) continue;
    const lines = segmentLineCount(segments);
    const mm =
      Math.max(0, lines - PRINT_CAPTION_BUDGET_LINES) * PRINT_CAPTION_LINE_MM +
      Math.max(0, segments.length - 1) * PRINT_CAPTION_SEGMENT_GAP_MM;
    if (mm > extra) extra = mm;
  }
  return Math.min(extra, PRINT_CAPTION_EXTRA_MAX_MM);
}

/** 아주 긴 캡션 — 그 사진만 제 쪽으로 보낸다. */
export function printCaptionNeedsOwnPage(photo: CaptionPhoto): boolean {
  return printCaptionLines(photo) > PRINT_CAPTION_OWN_PAGE_LINES;
}
