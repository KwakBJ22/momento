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
  // ★ 2026-08-16 — 프레임의 카드 여백(4mm)을 걷어냈다. 종이에서는 카드가 아니라
  //   사진 자체가 놓인다(시안 §1). 폭이 사진을 따라간다는 규칙은 그대로다.
  assert.match(frame, /padding: 0/);
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
  // ★ 2026-08-19 — 시안 §4 에 5·6장(세 칸)이 더해졌다.
  for (const count of [5, 6]) assert.equal(columns(count), "repeat(3, 1fr)", `${count}장이 세 칸이 아니다`);
  // ★ 3장이 뒤집혔다. 예전에는 `위에 둘, 아래 한 장을 가운데` 였고, 시안은
  //   **왼쪽에 큰 하나 · 오른쪽에 작은 둘**이다. 첫 칸이 두 줄을 차지한다.
  assert.match(printCss, /\[data-photo-count="3"\] \.print-frame:first-child \{\s*grid-row: 1 \/ span 2;/);
});

// ★ 2026-08-19 — 3mm → 시안 §4 의 9px(2.8mm). 캡션이 사진에서 떨어져 `다음 사진
//   것처럼` 보였다(PO). 값은 `--pr-cap-gap` 토큰 하나가 갖는다.
test("캡션은 사진 바로 아래 시안 간격에 붙는다", () => {
  const frame = rule(".album-renderer--print .print-frame");
  assert.match(frame, /justify-content: flex-start/);
  assert.match(frame, /gap: var\(--pr-cap-gap\)/);
  // ★ 2026-08-16 — 카드 여백을 걷어냈다(위 주석과 같은 이유).
  assert.match(frame, /padding: 0/);
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
  // ★ 2026-08-19 — 앞 쪽들이 6장씩 담는다(4 → 6). 마지막 쪽이 이야기 상한(4장) 안에
  //   들어온다는 규칙은 그대로다.
  assert.deepEqual(paginateChapterPhotos(photos(7), true, 2), [[1, 2, 3, 4, 5, 6], [7]]);
});

// ★ **뒤집힘 (2026-08-19 · 시안 §3 `글만 있는 쪽`).** 예전 규칙은 `글만 있는 쪽을
//   만들지 않는다`(I-4d-3) 였다 — 이야기는 언제나 그 날 마지막 사진 쪽에 붙었다.
//   시안이 그 규칙을 바꾼다: **이야기가 길면** 지면 하나를 글에 내주고 사진은 다음
//   쪽으로 넘긴다. 짧은 이야기는 예전 그대로 사진 쪽에 붙는다(그쪽이 대부분이다 —
//   날짜 이야기는 3~6줄이다).
test("★ 이야기가 길 때만 글에 지면을 내준다 (짧으면 예전대로 사진 쪽에 붙는다)", async () => {
  const { storyNeedsOwnPage, STORY_OWN_PAGE_MIN_CHARS } = await import("../src/album-engine/components/PrintPages");
  // 값의 근거: 쪽 안 이야기 자리(--pr-story 50mm)에 크롬에서 282자가 들어갔다.
  assert.equal(STORY_OWN_PAGE_MIN_CHARS, 280);
  assert.equal(storyNeedsOwnPage("짧은 이야기"), false);
  assert.equal(storyNeedsOwnPage(null), false);
  assert.equal(storyNeedsOwnPage("가".repeat(280)), false);
  assert.equal(storyNeedsOwnPage("가".repeat(281)), true);

  // 짧은 이야기는 사진 쪽에 붙는다 — 그 갈래가 살아 있다.
  assert.match(printPages, /pageIndex === pages\.length - 1 && inlineStory && chapter\.storyBody \?/);
  // 긴 이야기는 제 쪽을 갖고, 사진 쪽은 이야기 자리를 비워 두지 않는다.
  assert.match(printPages, /print-page print-page--story/);
  // ★ 2026-08-19 — 여기에 갈래가 하나 더 붙었다: 펼침면(§5 · 사진 한 장짜리 날).
  //   이 검사가 지키려던 것은 `이야기가 제 쪽을 가져가면 사진 쪽에 또 붙지 않는다` 다.
  assert.match(printPages, /const inlineStory = Boolean\(chapter\.storyBody\) && !storyOwnPage && !spread;/);
  // 두 단으로 나눈다 — 한 단이면 글줄이 174mm 가 되어 안 읽힌다(시안 §4).
  assert.match(printCss, /\.print-page--story \.print-story__columns \{[\s\S]*?columns: 2;/);
  // 앨범 끝 글은 그대로 자기 쪽이다.
  assert.match(printCss, /\.album-renderer--print \.print-closing \{/);
});

test("사진 짧은 변 60mm 하한은 그대로다", () => {
  assert.match(printPages, /export const PRINT_MIN_PHOTO_SHORT_SIDE_MM = 60;/);
});

test("한 쪽에 사진 5장 이상이 오지 않는다 (기존 계약 유지 — §9)", async () => {
  assert.match(printPages, /export const PRINT_PHOTOS_PER_PAGE = 6;/);
  // ★ 글자가 아니라 **결과**를 본다 — 나누는 코드가 바뀌어도 계약은 그대로여야 한다.
  const { paginateChapterPhotos } = await import("../src/album-engine/components/PrintPages");
  for (const total of [1, 4, 5, 9, 13]) {
    const photos = Array.from({ length: total }, (_, index) => index);
    for (const hasStory of [false, true]) {
      for (const page of paginateChapterPhotos(photos, hasStory)) {
        assert.ok(page.length <= 6, `${total}장(이야기 ${hasStory}): 한 쪽에 ${page.length}장`);
      }
    }
  }
});

test("이 파일의 모든 규칙이 인쇄 아래에 있다 (화면에 새지 않는다)", () => {
  const rules = printCss.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const selector of rules.split("}").map((chunk) => chunk.split("{")[0].trim()).filter(Boolean)) {
    for (const one of selector.split(",").map((value) => value.trim()).filter(Boolean)) {
      assert.ok(one.startsWith(".album-renderer--print"), `인쇄 밖으로 새는 규칙: ${one}`);
    }
  }
});
