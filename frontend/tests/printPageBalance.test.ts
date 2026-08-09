import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";

/**
 * 🔴 사진이 프레임을 뚫고 나와 서로 겹치고 날짜 머리글까지 덮었다 (I-4c · SCREEN_SPEC §9).
 *
 * 4b 의 두 지시가 철회됐다. 그 지시를 구현한 결과가 이렇게 됐다:
 *
 *   4b-4 "같은 줄의 아래끝을 맞춘다" → 프레임을 격자 칸 높이까지 늘렸다.
 *        가로 사진 아래에 흰 카드만 절반 남아 **빈 액자**가 됐고, 칸이 사진보다
 *        작은 쪽에서는 사진이 프레임을 **뚫고 나왔다**.
 *   4b-3 "쪽의 세로 가운데에 둔다" → 날짜 머리글까지 같이 내려가 쪽 중간에서 시작했다.
 *   4b-5 "이야기를 다음 쪽으로" → 글 세 줄만 있는 쪽이 생겼다.
 *
 * ★ 새 규칙
 *   · 프레임은 **사진 크기**다. 절대 늘리지 않는다. 사진이 프레임 밖으로 나가지 않는다.
 *   · 같은 줄의 사진은 **위끝**을 맞춘다(아래끝은 비율대로 달라도 된다).
 *   · 본문 쪽은 **위에서부터** 채운다. 가운데 정렬은 표지·브랜드 쪽에만.
 *   · 날짜 머리글은 언제나 쪽 맨 위.
 *   · 글만 있는 쪽을 만들지 않는다 — 자리가 모자라면 **사진을 나눈다**.
 */

registerCssStub();
setupDom("https://test.local/");

const printCss = readFileSync(new URL("../src/album-engine/components/PrintPages.css", import.meta.url), "utf8");
const printPages = readFileSync(new URL("../src/album-engine/components/PrintPages.tsx", import.meta.url), "utf8");

function rule(selector: string): string {
  const at = printCss.indexOf(`${selector} {`);
  assert.notEqual(at, -1, `규칙이 없다: ${selector}`);
  return printCss.slice(at, printCss.indexOf("}", at));
}

// --- 프레임은 사진 크기다 ---

test("★ 프레임을 격자 칸 높이까지 늘리지 않는다 — 빈 액자도, 뚫고 나오는 사진도 없다", () => {
  const grid = rule(".album-renderer--print .print-page__photos");
  // 칸에 stretch 되면 프레임이 늘어나고(빈 액자), 칸이 사진보다 작으면 사진이 넘친다.
  assert.match(grid, /align-items: start/);
  assert.equal(/align-items: stretch/.test(grid), false, "늘리면 4c 의 결함이 그대로 돌아온다");
  // 줄 높이도 내용이 정한다 — 1fr 로 나누면 칸이 사진보다 작아질 수 있다.
  assert.match(grid, /grid-auto-rows: auto/);
  assert.equal(/grid-template-rows:\s*1fr/.test(printCss), false, "1fr 줄은 프레임을 늘린다");
  // 프레임 자신도 줄 위끝에 붙는다.
  assert.match(rule(".album-renderer--print .print-frame"), /align-self: start/);
});

test("★ 같은 줄의 사진은 위끝을 맞춘다 (아래끝은 비율대로 달라도 된다)", () => {
  assert.match(rule(".album-renderer--print .print-page__photos"), /align-items: start/);
});

test("★ 프레임 폭이 사진 폭 + 여백이다 — 칸 폭을 따라가지 않는다 (I-4d-1)", () => {
  // 4b-3 의 "좌우 기준선은 하나"(justify-items: stretch)는 4d 에서 철회됐다 —
  // 프레임이 칸을 채우면 세로만 붙고 가로로는 빈 액자가 된다.
  assert.match(rule(".album-renderer--print .print-page__photos"), /justify-items: center/);
  const frame = rule(".album-renderer--print .print-frame");
  assert.match(frame, /width: fit-content/);
  assert.match(frame, /padding: 4mm/);
  // 캡션이 프레임 폭을 정하면 긴 캡션 한 줄이 프레임을 쪽 폭까지 늘린다.
  const caption = rule(".album-renderer--print .print-frame__caption");
  assert.match(caption, /width: 0/);
  assert.match(caption, /min-width: 100%/);
});

test("★ 사진은 나란히 놓는다 — 세로로 쌓지 않는다 (I-4d-2)", () => {
  const columns = (count: number) => {
    const at = printCss.indexOf(`.print-page[data-photo-count="${count}"] .print-page__photos`);
    assert.notEqual(at, -1, `${count}장 칸 규칙이 없다`);
    const body = printCss.slice(at, printCss.indexOf("}", at));
    const match = body.match(/grid-template-columns:\s*([^;]+);/);
    return match ? match[1].trim() : printCss.slice(at, printCss.indexOf("}", printCss.indexOf("grid-template-columns", at))).match(/grid-template-columns:\s*([^;]+)/)![1].trim();
  };
  assert.equal(columns(1), "1fr");
  for (const count of [2, 3, 4]) assert.equal(columns(count), "1fr 1fr", `${count}장이 세로로 쌓인다`);
  // 3장은 위에 둘, 아래 한 장을 가운데.
  assert.match(printCss, /\[data-photo-count="3"\] \.print-frame:last-child \{\s*grid-column: 1 \/ -1;/);
});

test("캡션은 사진 바로 아래 3mm 그대로다", () => {
  const frame = rule(".album-renderer--print .print-frame");
  assert.match(frame, /justify-content: flex-start/);
  assert.match(frame, /gap: 3mm/);
  assert.match(frame, /padding: 4mm/);
  assert.match(rule(".album-renderer--print .print-frame__photo"), /flex: 0 1 auto/);
});

// --- 본문 쪽은 위에서부터 ---

test("★ 본문 쪽은 위에서부터 채운다 — 남는 여백은 아래에 남긴다", () => {
  assert.match(rule(".album-renderer--print .print-page"), /justify-content: flex-start/);
  // 끝 글 쪽도 같다.
  assert.match(rule(".album-renderer--print .print-closing"), /justify-content: flex-start/);
});

test("★ 날짜 머리글은 언제나 쪽 맨 위다", () => {
  assert.match(rule(".album-renderer--print .chapter-header--print-date"), /order: -1/);
  // 마크업에서도 머리글이 사진 앞이다.
  const headerAt = printPages.indexOf("<ChapterHeader");
  const photosAt = printPages.indexOf('className="print-page__photos"');
  assert.ok(headerAt > -1 && headerAt < photosAt);
});

test("가운데 정렬은 표지와 브랜드 쪽에만 남는다", () => {
  // ★ **쪽 단위 컨테이너**만 본다. 프레임 안에서 사진을 좌우 가운데 두는 것은 다른 얘기다.
  const PAGE_CONTAINERS = [".print-page", ".print-closing", ".album-cover", ".album-renderer__brand-page"];
  for (const block of printCss.replace(/\/\*[\s\S]*?\*\//g, "").split("}")) {
    const selector = block.split("{")[0].trim();
    if (!selector || !/justify-content: center/.test(block)) continue;
    const container = PAGE_CONTAINERS.find((name) => selector.endsWith(name));
    if (!container) continue;
    assert.ok(/album-cover|brand-page/.test(container), `본문 쪽이 가운데 정렬이다: ${selector}`);
  }
  // 본문 쪽과 끝 글 쪽은 위에서부터다.
  assert.match(rule(".album-renderer--print .print-page"), /justify-content: flex-start/);
  assert.match(rule(".album-renderer--print .print-closing"), /justify-content: flex-start/);
});

// --- 글만 있는 쪽을 만들지 않는다 ---

test("★ 날짜 이야기는 그 날 마지막 사진과 같은 쪽에 둔다 — 자리가 모자라면 사진을 나눈다", async () => {
  const { paginateChapterPhotos, STORY_PAGE_MAX_PHOTOS } = await import("../src/album-engine/components/PrintPages");
  const photos = (count: number) => Array.from({ length: count }, (_, index) => index + 1);
  // ★ I-4d-3 — 먼저 한 쪽에 넣어 본다. 두 칸 격자라 4장 + 이야기가 한 쪽에 들어간다.
  assert.equal(STORY_PAGE_MAX_PHOTOS, 4);
  assert.deepEqual(paginateChapterPhotos(photos(4), true), [[1, 2, 3, 4]]);
  assert.deepEqual(paginateChapterPhotos(photos(3), true), [[1, 2, 3]]);
  assert.deepEqual(paginateChapterPhotos(photos(2), true), [[1, 2]]);
  // 이야기가 없으면 당연히 그대로.
  assert.deepEqual(paginateChapterPhotos(photos(4), false), [[1, 2, 3, 4]]);
  // 나눠야 할 때의 모양은 4c 규칙 그대로다(상한을 낮춰 확인한다).
  assert.deepEqual(paginateChapterPhotos(photos(4), true, 2), [[1, 2], [3, 4]]);
  assert.deepEqual(paginateChapterPhotos(photos(3), true, 2), [[1, 2], [3]]);
  assert.deepEqual(paginateChapterPhotos(photos(7), true, 2), [[1, 2, 3, 4], [5, 6], [7]]);
});

test("★ 글만 있는 쪽을 만들지 않는다 (`우리의 이야기` 는 예외 — 원래 자기 쪽을 갖는다)", () => {
  // 이야기 전용 쪽을 그리던 코드가 없다.
  assert.equal(printPages.includes("print-page--story"), false);
  assert.equal(printPages.includes("storyGoesToOwnPage"), false);
  // 이야기는 언제나 그 날 마지막 **사진 쪽**에 붙는다.
  assert.match(printPages, /pageIndex === pages\.length - 1 && chapter\.storyBody \?/);
  // 앨범 끝 글은 그대로 자기 쪽이다.
  assert.match(printCss, /\.album-renderer--print \.print-closing \{/);
});

test("사진 짧은 변 60mm 하한은 그대로다", () => {
  assert.match(printPages, /export const PRINT_MIN_PHOTO_SHORT_SIDE_MM = 60;/);
});

test("한 쪽에 사진 5장 이상이 오지 않는다 (기존 계약 유지 — §9)", () => {
  assert.match(printPages, /export const PRINT_PHOTOS_PER_PAGE = 4;/);
  assert.match(printPages, /chunk\(photos, PRINT_PHOTOS_PER_PAGE\)/);
});

test("이 파일의 모든 규칙이 인쇄 아래에 있다 (화면에 새지 않는다)", () => {
  const rules = printCss.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const selector of rules.split("}").map((chunk) => chunk.split("{")[0].trim()).filter(Boolean)) {
    for (const one of selector.split(",").map((value) => value.trim()).filter(Boolean)) {
      assert.ok(one.startsWith(".album-renderer--print"), `인쇄 밖으로 새는 규칙: ${one}`);
    }
  }
});
