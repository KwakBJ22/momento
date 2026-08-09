import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";

/**
 * 표본을 열어 보고 남은 것 — 쪽 배치 (I-4b-2 ~ 4b-5 · SCREEN_SPEC §9).
 *
 *   4b-2  `우리의 이야기` 쪽이 아래 절반에 몰려 있다
 *   4b-3  사진이 적은 쪽의 공백이 어색하다 (위로 쏠림 · 좌우 기준선 안 맞음)
 *   4b-4  격자에서 사진 바닥선이 안 맞는다 — 인쇄는 정돈이다
 *   4b-5  사진이 너무 작아지면 쪽을 나눈다 (짧은 변 60mm)
 *
 * ★ 값은 큐가 준 것뿐이다. 재지 않는다(큐 규칙 6).
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

// --- 4b-2 ---

test("★ 끝 글 쪽이 쪽 가운데에 온다 — 브랜드 쪽과 같은 방식", () => {
  const closing = rule(".album-renderer--print .print-closing");
  const brand = printCss.split(".album-renderer--print .album-renderer__brand-page {")
    .map((chunk) => chunk.slice(0, chunk.indexOf("}")))
    .find((chunk) => chunk.includes("justify-content"));
  for (const property of ["justify-content: center", "align-items: center"]) {
    assert.match(closing, new RegExp(property), `끝 글 쪽에 없다: ${property}`);
    assert.match(String(brand), new RegExp(property), `브랜드 쪽에 없다: ${property}`);
  }
  // 안쪽 블록이 화면용 위쪽 여백을 갖고 있어 아래로 밀렸다 — 인쇄에서는 없앤다.
  assert.match(printCss, /\.print-closing > \* \{[\s\S]{0,60}margin-top: 0;/);
});

// --- 4b-3 ---

test("★ 사진 묶음을 쪽의 세로 가운데에 둔다 — 남는 여백은 위아래로 똑같이", () => {
  const page = rule(".album-renderer--print .print-page");
  assert.match(page, /justify-content: center/);
  // 사진 자리가 남는 높이를 전부 먹으면 한쪽으로 쏠린다.
  const photos = rule(".album-renderer--print .print-page__photos");
  assert.match(photos, /flex: 0 1 auto/);
  assert.equal(/flex: 1 1 auto/.test(photos), false, "예전처럼 늘어나면 다시 쏠린다");
});

test("★ 한 쪽 안에서 사진의 좌우 기준선이 하나다 (1장이든 2장이든)", () => {
  const photos = rule(".album-renderer--print .print-page__photos");
  // 프레임이 격자 칸을 꽉 채운다 — 칸 폭이 같으면 시작 위치도 같다.
  assert.match(photos, /justify-items: stretch/);
  assert.equal(/justify-items: center/.test(photos), false, "칸 안에서 프레임이 줄면 기준선이 흔들린다");
  // 사진 자체는 프레임 안에서 가운데 놓인다.
  assert.match(rule(".album-renderer--print .print-frame"), /align-items: center/);
});

// --- 4b-4 ---

test("★ 같은 줄의 프레임은 아래끝이 맞는다 — 인쇄는 정돈이다(§9)", () => {
  const photos = rule(".album-renderer--print .print-page__photos");
  assert.match(photos, /align-items: stretch/);
  assert.equal(/align-items: center/.test(photos), false, "칸마다 높이가 달라지면 바닥선이 어긋난다");
});

test("★ 그래도 캡션은 사진 바로 아래다 (4-4 를 되돌리지 않는다)", () => {
  const frame = rule(".album-renderer--print .print-frame");
  // 위에서부터 쌓는다 — 프레임이 늘어나도 남는 자리는 캡션 **아래**에 생긴다.
  assert.match(frame, /justify-content: flex-start/);
  assert.match(frame, /gap: 3mm/);
  // 사진 자리가 늘어나면 사진과 캡션 사이가 벌어진다(그것이 4-4 의 결함이었다).
  assert.match(rule(".album-renderer--print .print-frame__photo"), /flex: 0 1 auto/);
});

// --- 4b-5 ---

test("★ 사진의 짧은 변은 60mm 미만이 되지 않는다 — 값이 코드에 있다", () => {
  assert.match(printPages, /export const PRINT_MIN_PHOTO_SHORT_SIDE_MM = 60;/);
});

test("★ 사진이 많은 쪽에서는 날짜 이야기를 다음 쪽으로 넘긴다 (사진을 줄이지 않는다 — §6)", async () => {
  const { storyGoesToOwnPage } = await import("../src/album-engine/components/PrintPages");
  assert.equal(storyGoesToOwnPage(1), false);
  assert.equal(storyGoesToOwnPage(2), false);
  assert.equal(storyGoesToOwnPage(3), true);
  assert.equal(storyGoesToOwnPage(4), true);
  // 같은 판정을 두 곳(본문에 넣을지 · 상한을 낮출지)이 함께 쓴다.
  assert.match(printPages, /chapter\.storyBody && !storyGoesToOwnPage\(photos\.length\) \?/);
  assert.match(printPages, /data-has-story=\{[^}]*!storyGoesToOwnPage\(photos\.length\)[^}]*\}/);
  // 넘어간 이야기는 자기 쪽 하나를 갖는다(빈 쪽이 아니라 이야기 쪽이다).
  assert.match(printPages, /className="print-page print-page--story"/);
});

test("★ 3장 쪽 상한은 이야기 유무와 무관하게 95mm 하나다 (PO 값)", () => {
  assert.match(printCss, /\.print-page\[data-photo-count="3"\] \.print-frame__photo img \{ max-height: 95mm; \}/);
  // 이야기가 있는 3장 쪽을 위한 낮은 상한은 없앴다 — 이야기가 넘어가므로 필요 없다.
  assert.equal(/\[data-has-story\]\[data-photo-count="3"\]/.test(printCss), false);
});

test("한 쪽에 사진 5장 이상이 오지 않는다 (기존 계약 유지 — §9)", () => {
  assert.match(printPages, /export const PRINT_PHOTOS_PER_PAGE = 4;/);
});

test("이 파일의 모든 규칙이 인쇄 아래에 있다 (화면에 새지 않는다)", () => {
  const rules = printCss.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const selector of rules.split("}").map((chunk) => chunk.split("{")[0].trim()).filter(Boolean)) {
    for (const one of selector.split(",").map((value) => value.trim()).filter(Boolean)) {
      assert.ok(one.startsWith(".album-renderer--print"), `인쇄 밖으로 새는 규칙: ${one}`);
    }
  }
});
